"""AI启动器 — AI 人格启动器（Python 宿主 + WebView2 界面）。

管理本机常驻的这条链路：
    DSH 模型转发(18899) → QQ 客户端 → SnowLuma(5099) → OneBot WS(3001)
    → Cortico 控制台(7788) → 免费池守护(upstream-guard)

界面用 HTML/CSS/JS 写，Python 只负责窗口、托盘、进程与端口探测。
JS 侧通过 pywebview.api.<方法名>(...) 调用下面 Api 类的公开方法。
"""
from __future__ import annotations

import collections
import json
import os
import pathlib
import socket
import subprocess
import sys
import threading
import time
import urllib.request
import webbrowser

import coreclr_env  # noqa: F401  — 必须在 import webview 之前导入
import webview

ROOT = pathlib.Path(__file__).parent
BRAND = json.loads((ROOT / "brand" / "brand.json").read_text(encoding="utf-8"))

APP_NAME = BRAND["title"]
WINDOW_TITLE = BRAND["window_title"]
APP_VERSION = BRAND["version"]
_START = time.time()

DEPLOY = "mybot"
CONSOLE_URL = "http://127.0.0.1:7788/"
SNOW_WEBUI = "http://127.0.0.1:5099/"

CREATE_NO_WINDOW = 0x08000000
DETACHED_PROCESS = 0x00000008
_FLAGS = CREATE_NO_WINDOW | DETACHED_PROCESS


# --------------------------------------------------------------------------- #
# 路径解析：源码运行 vs 打包成 exe
# --------------------------------------------------------------------------- #
def _has_chain(d: pathlib.Path) -> bool:
    """这一层是不是栈根（同时有 SnowLuma 和 cortico-qq）。"""
    try:
        return (d / "cortico-qq").is_dir() and (d / "SnowLuma").is_dir()
    except OSError:
        return False


def _resolve_base() -> pathlib.Path:
    """找到栈根目录（装有 SnowLuma / cortico-qq 的那层）。

    查找顺序：
      1. launcher.config.json 里的 "base"（显式指定，最优先）
      2. 从源码目录 / exe 所在目录一路往上找同时含 SnowLuma + cortico-qq 的目录
         （打包后 exe 在 <pkg>\\launcher\\dist\\AI启动器\\ 里，往上找同样能命中）
    """
    for cand_cfg in (ROOT / "launcher.config.json", ROOT.parent / "launcher.config.json"):
        if cand_cfg.is_file():
            try:
                base = json.loads(cand_cfg.read_text(encoding="utf-8")).get("base")
                if base and pathlib.Path(base).is_dir():
                    return pathlib.Path(base)
            except Exception:
                pass

    # 源码运行：ROOT 就是 <pkg>\launcher
    if _has_chain(ROOT.parent):
        return ROOT.parent

    # 打包运行：从 exe 所在目录（one-folder 布局下是 <exe目录>\_internal）往上找
    starts = [ROOT]
    if getattr(sys, "frozen", False):
        starts.insert(0, pathlib.Path(sys.executable).resolve().parent)
    for start in starts:
        for cand in [start, *start.parents]:
            if _has_chain(cand):
                return cand
    return ROOT.parent


def _find_pkg() -> pathlib.Path:
    """找到 corti-soul 仓库根（含 guard/upstream-guard.mjs 的那层）。

    源码运行时 ROOT 就是 <pkg>\\launcher；打包运行时 exe 在
    <pkg>\\launcher\\dist\\AI启动器\\ 里，往上找同样能命中。
    """
    for cand in [ROOT, *ROOT.parents]:
        if (cand / "guard" / "upstream-guard.mjs").is_file():
            return cand
    return ROOT.parent


BASE = _resolve_base()
PKG = _find_pkg()
SNOW = BASE / "SnowLuma"
CORTICO = BASE / "cortico-qq"
RUNS = CORTICO / "deployments" / DEPLOY / "data" / "runs"
DEPLOY_ENV = CORTICO / "deployments" / DEPLOY / ".env"
GUARD_DIR = PKG / "guard"
GUARD_SCRIPT = GUARD_DIR / "upstream-guard.mjs"
GUARD_CFG = GUARD_DIR / "upstream-guard.json"
GUARD_STATE = GUARD_DIR / "upstream-guard-state.json"


# --------------------------------------------------------------------------- #
# 探测小工具
# --------------------------------------------------------------------------- #
def port_open(port: int, timeout: float = 0.18) -> bool:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        s.settimeout(timeout)
        return s.connect_ex(("127.0.0.1", port)) == 0


def image_running(image: str) -> bool:
    """tasklist 实测 ~60ms，够快，直接查。"""
    try:
        out = subprocess.run(
            ["tasklist", "/NH", "/FI", f"IMAGENAME eq {image}"],
            capture_output=True, text=True, timeout=6,
            creationflags=CREATE_NO_WINDOW,
        ).stdout
    except Exception:
        return False
    return image.lower() in (out or "").lower()


_guard_cache = {"ts": 0.0, "up": False}


def guard_running() -> bool:
    """upstream-guard 是 node 脚本，没有端口，只能看命令行（结果缓存 5 秒）。"""
    now = time.time()
    if now - _guard_cache["ts"] < 5.0:
        return _guard_cache["up"]
    up = False
    try:
        # 只认「命令行以 upstream-guard.mjs 结尾」的进程。
        # 早先用 -like '*upstream-guard*' 会误报：别的进程（比如正在跑这条
        # 探测命令的 DSH 包装进程）命令行里也会出现这个字符串，于是守护
        # 被误判成"已在运行"而永远不被拉起。
        ps = (
            "(Get-CimInstance Win32_Process -Filter \"Name='node.exe'\" | "
            "Where-Object { $_.CommandLine -match 'upstream-guard\\.mjs\"?\\s*$' } | "
            "Measure-Object).Count"
        )
        out = subprocess.run(
            ["powershell", "-NoProfile", "-NonInteractive", "-Command", ps],
            capture_output=True, text=True, timeout=12,
            creationflags=CREATE_NO_WINDOW,
        ).stdout
        up = (out or "").strip().isdigit() and int(out.strip()) > 0
    except Exception:
        up = False
    _guard_cache.update(ts=now, up=up)
    return up


def active_provider() -> str | None:
    """问 Cortico 控制台当前挂的是哪个端点（免鉴权，几十毫秒）。"""
    try:
        with urllib.request.urlopen(
            "http://127.0.0.1:7788/api/providers", timeout=2.5
        ) as resp:
            return json.loads(resp.read().decode("utf-8")).get("active")
    except Exception:
        return None


def find_node() -> str | None:
    cands = [
        pathlib.Path(r"C:\Program Files\nodejs\node.exe"),
        pathlib.Path(os.environ.get("ProgramFiles", r"C:\Program Files")) / "nodejs" / "node.exe",
        SNOW / "node.exe",
    ]
    for c in cands:
        if c.is_file():
            return str(c)
    return None


def find_qq() -> str | None:
    cands = [
        pathlib.Path(os.environ.get("ProgramFiles(x86)", r"C:\Program Files (x86)"))
        / "Tencent" / "QQNT" / "QQ.exe",
        pathlib.Path(os.environ.get("ProgramFiles", r"C:\Program Files"))
        / "Tencent" / "QQNT" / "QQ.exe",
        pathlib.Path(os.environ.get("LocalAppData", "")) / "Tencent" / "QQNT" / "QQ.exe",
    ]
    for c in cands:
        if c.is_file():
            return str(c)
    return None


def deploy_env() -> dict:
    """把 deployments/mybot/.env 注入子进程环境。

    扩展包 StickerStore 只读 process.env（不走框架的 .env 解析），
    所以必须在拉起 Cortico 时贴上这些键，否则表情包标注永远降级。
    """
    env = {}
    try:
        for raw in DEPLOY_ENV.read_text(encoding="utf-8").splitlines():
            line = raw.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            k, v = line.split("=", 1)
            env[k.strip()] = v.strip().strip('"').strip("'")
    except Exception:
        pass
    return env


def read_json(path: pathlib.Path) -> dict:
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return {}


def list_services() -> list[dict]:
    return [
        {"id": "dsh", "name": "DSH 模型转发", "detail": "18899 · 大脑入口", "kind": "port", "arg": 18899},
        {"id": "qq", "name": "QQ 客户端", "detail": "QQNT", "kind": "proc", "arg": "QQ.exe"},
        {"id": "snow", "name": "SnowLuma", "detail": "5099 · WebUI / Hook", "kind": "port", "arg": 5099},
        {"id": "onebot", "name": "OneBot WS", "detail": "3001 · QQ 消息通道", "kind": "port", "arg": 3001},
        {"id": "cortico", "name": "Cortico 控制台", "detail": "7788 · 人格本体", "kind": "port", "arg": 7788},
        {"id": "guard", "name": "免费池守护", "detail": "upstream-guard", "kind": "guard", "arg": None},
    ]


def probe_all() -> list[dict]:
    svcs = list_services()
    results: dict[str, bool] = {}
    lock = threading.Lock()

    def work(svc: dict) -> None:
        if svc["kind"] == "port":
            up = port_open(svc["arg"])
        elif svc["kind"] == "proc":
            up = image_running(svc["arg"])
        else:
            up = guard_running()
        with lock:
            results[svc["id"]] = up

    threads = [threading.Thread(target=work, args=(s,), daemon=True) for s in svcs]
    for t in threads:
        t.start()
    for t in threads:
        t.join(timeout=6)
    for s in svcs:
        s["up"] = bool(results.get(s["id"], False))
    return svcs


# --------------------------------------------------------------------------- #
# 最近活动：读最新一轮 run 的 log.jsonl 尾巴
# --------------------------------------------------------------------------- #
_act = {"key": None, "ts": 0.0, "items": [], "run": None}


def recent_activity(limit: int = 14) -> tuple[list[dict], dict | None]:
    now = time.time()
    if now - _act["ts"] < 3.0:
        return _act["items"], _act["run"]
    items: list[dict] = []
    run_info = None
    try:
        if RUNS.is_dir():
            newest = max(
                (p for p in RUNS.iterdir() if p.is_dir()),
                key=lambda p: p.stat().st_mtime,
                default=None,
            )
            if newest is not None:
                meta = read_json(newest / "run.json")
                run_info = {
                    "id": newest.name,
                    "startedAt": str(meta.get("startedAt", ""))[:19].replace("T", " "),
                    "bot": meta.get("bot", ""),
                    "provider": meta.get("activeProvider", ""),
                    "worlds": len(meta.get("worlds", []) or []),
                }
                log = newest / "log.jsonl"
                if log.is_file():
                    raw = log.read_bytes()
                    if len(raw) > 262144:
                        raw = raw[-262144:]
                        raw = raw.split(b"\n", 1)[-1]
                    for line in raw.decode("utf-8", "replace").splitlines():
                        line = line.strip()
                        if not line:
                            continue
                        try:
                            rec = json.loads(line)
                        except Exception:
                            continue
                        if rec.get("level") == "debug":
                            continue
                        items.append({
                            "ts": str(rec.get("ts", ""))[11:19],
                            "level": str(rec.get("level", "info")),
                            "area": str(rec.get("area", "")),
                            "msg": str(rec.get("msg", "")),
                        })
                    items = items[-limit:]
    except Exception:
        items = []
    _act.update(key=str(run_info and run_info.get("id")), ts=now, items=items, run=run_info)
    return items, run_info


# --------------------------------------------------------------------------- #
# Api：每个公开方法都能被 JS 用 pywebview.api.<name>() 调
# --------------------------------------------------------------------------- #
class Api:
    def __init__(self) -> None:
        # 注意：必须以下划线开头。pywebview 会把 js_api 上所有公开属性递归展开成
        # window.pywebview.api.*，若把 Window / pystray.Icon 这类对象挂成公开属性，
        # 它会顺着 .native.AccessibilityObject.Bounds.Empty.Empty... 递归到栈溢出
        # （日志里那条 "Error while processing window.native.AccessibilityObject..."）。
        self._window: webview.Window | None = None
        self._tray = None
        self._logs: collections.deque = collections.deque(maxlen=300)
        self.busy = False
        self._quitting = False
        self._log("启动器就绪。")

    # ---- 基础设施 ---------------------------------------------------------- #
    def attach(self, window) -> None:
        self._window = window

    def _log(self, msg: str) -> None:
        self._logs.append(f"[{time.strftime('%H:%M:%S')}] {msg}")

    # ---- 窗口控制 ---------------------------------------------------------- #
    def hide_window(self) -> dict:
        if self._window:
            self._window.hide()
        return {"ok": True}

    def show_window(self) -> dict:
        if self._window:
            self._window.show()
        return {"ok": True}

    def minimize_window(self) -> dict:
        if self._window:
            self._window.minimize()
        return {"ok": True}

    def quit_app(self) -> dict:
        self._log("退出启动器（后台服务继续运行）。")
        self._quitting = True
        if self._tray is not None:
            try:
                self._tray.stop()
            except Exception:
                pass
        if self._window is not None:
            try:
                self._window.destroy()
            except Exception:
                os._exit(0)
        return {"ok": True}

    def on_closing(self) -> bool:
        """点右上角 ✕ 时收进托盘，而不是退出。返回 False 表示取消关闭。"""
        if self._quitting:
            return True
        if self.state_snapshot().get("tray"):
            try:
                if self._window:
                    self._window.hide()
            except Exception:
                pass
            return False
        return True

    def state_snapshot(self) -> dict:
        return {"tray": self._tray is not None}

    def open_console(self) -> dict:
        webbrowser.open(CONSOLE_URL)
        self._log("已在浏览器打开控制台。")
        return {"ok": True}

    def open_snowluma(self) -> dict:
        webbrowser.open(SNOW_WEBUI)
        return {"ok": True}

    # ---- 状态 -------------------------------------------------------------- #
    def get_status(self) -> dict:
        svcs = probe_all()
        guard_state = read_json(GUARD_STATE)
        guard_cfg = read_json(GUARD_CFG)
        items, run = recent_activity()
        provider = {
            "active": guard_state.get("current", ""),
            "primary": guard_cfg.get("primary", ""),
            "fallback": guard_cfg.get("fallback", ""),
            "switches": guard_state.get("fallbackSwitches", 0),
            "maxSwitches": guard_cfg.get("maxFallbackSwitchesPerDay", 12),
            "probeEvery": guard_cfg.get("probeIntervalSec", 60),
        }
        active = active_provider()
        if active:
            provider["active"] = str(active)

        return {
            "ts": time.strftime("%H:%M:%S"),
            "version": APP_VERSION,
            "uptime": f"{round(time.time() - _START)}s",
            "serviceCount": len(svcs),
            "services": svcs,
            "allUp": all(s["up"] for s in svcs),
            "core": all(s["up"] for s in svcs if s["id"] in {"dsh", "snow", "onebot", "cortico"}),
            "provider": provider,
            "activity": items,
            "run": run,
            "busy": self.busy,
            "log": list(self._logs)[-60:],
            "base": str(BASE),
        }

    # ---- 启动全部 ---------------------------------------------------------- #
    def start_all(self) -> dict:
        if self.busy:
            return {"ok": False, "msg": "正在启动中，请稍候"}
        threading.Thread(target=self._start_all, daemon=True).start()
        return {"ok": True}

    def _start_all(self) -> None:
        self.busy = True
        try:
            node = find_node()

            # ① DSH 模型转发
            if port_open(18899):
                self._log("DSH 模型转发在线。")
            else:
                self._log("警告：DSH 模型转发 (18899) 不在线，Bot 暂时没有大脑。")

            # ② QQ 客户端
            if image_running("QQ.exe"):
                self._log("QQ 客户端已在运行。")
            else:
                qq = find_qq()
                if qq:
                    try:
                        os.startfile(qq)  # noqa: S606
                        self._log("已拉起 QQ 客户端。")
                        time.sleep(6)
                    except Exception as e:
                        self._log(f"拉起 QQ 失败：{e}")
                else:
                    self._log("没找到 QQ.exe，请手动打开 QQ。")

            if not node:
                self._log("没找到 node.exe，后续步骤无法继续。")
                return

            # ③ SnowLuma
            if port_open(5099):
                self._log("SnowLuma 已在运行。")
            else:
                env = dict(os.environ)
                env["SNOWLUMA_ONEBOT_HTTP_PORT"] = "3005"
                try:
                    subprocess.Popen(
                        [node, "index.mjs"], cwd=str(SNOW), env=env,
                        creationflags=_FLAGS, close_fds=True,
                        stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL,
                        stderr=subprocess.DEVNULL,
                    )
                    self._log("已拉起 SnowLuma，等待 WebUI …")
                except Exception as e:
                    self._log(f"拉起 SnowLuma 失败：{e}")
                if wait_port(5099, 60, "SnowLuma WebUI", self._log):
                    self._log("SnowLuma 就绪。")

            # ④ OneBot WS
            if port_open(3001):
                self._log("OneBot WS 已就绪。")
            else:
                if wait_port(3001, 90, "OneBot WS", self._log):
                    self._log("OneBot WS 就绪。")
                else:
                    self._log(
                        "OneBot WS 未就绪：确认 SnowLuma/config/runtime.json 里 hookAutoLoad=true，"
                        "或在 http://127.0.0.1:5099/ 手动接入。Cortico 仍会照常启动。"
                    )

            # ⑤ Cortico
            if port_open(7788):
                self._log("Cortico 已在运行。")
            else:
                env = dict(os.environ)
                env["CORTICO_START_PAUSED"] = "0"
                env.update(deploy_env())
                try:
                    subprocess.Popen(
                        [node, os.path.join("bin", "cortico.mjs"), DEPLOY],
                        cwd=str(CORTICO), env=env,
                        creationflags=_FLAGS, close_fds=True,
                        stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL,
                        stderr=subprocess.DEVNULL,
                    )
                    self._log("已拉起 Cortico，等待控制台 …")
                except Exception as e:
                    self._log(f"拉起 Cortico 失败：{e}")
                if wait_port(7788, 90, "Cortico 控制台", self._log):
                    self._log("Cortico 就绪。")

            # ⑥ 免费池守护
            if guard_running():
                self._log("免费池守护已在运行。")
            else:
                try:
                    subprocess.Popen(
                        [node, str(GUARD_SCRIPT)], cwd=str(GUARD_DIR),
                        creationflags=_FLAGS, close_fds=True,
                        stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL,
                        stderr=subprocess.DEVNULL,
                    )
                    self._log("已拉起免费池守护。")
                except Exception as e:
                    self._log(f"拉起免费池守护失败：{e}")

            time.sleep(0.6)
            if all(s["up"] for s in probe_all()):
                self._log("全部就绪，可以聊了。")
            else:
                self._log("有组件未就绪，见上方提示。")
        finally:
            self.busy = False


def wait_port(port: int, seconds: int, what: str, log) -> bool:
    deadline = time.time() + seconds
    while time.time() < deadline:
        if port_open(port):
            return True
        time.sleep(1)
    log(f"{what} 等待超时（{seconds}s）。")
    return False


# --------------------------------------------------------------------------- #
# 托盘
# --------------------------------------------------------------------------- #
def build_tray(api: Api):
    try:
        import pystray
        from PIL import Image
    except Exception:
        api._log("托盘不可用（缺 pystray / Pillow），关闭窗口即退出。")
        return None

    try:
        image = Image.open(ROOT / "brand" / "icon.png")
    except Exception:
        return None

    def on_show(icon, item):
        api.show_window()

    def on_start(icon, item):
        api.start_all()

    def on_console(icon, item):
        api.open_console()

    def on_quit(icon, item):
        api.quit_app()

    menu = pystray.Menu(
        pystray.MenuItem("显示窗口", on_show, default=True),
        pystray.MenuItem("启动全部", on_start),
        pystray.MenuItem("打开 Cortico 控制台", on_console),
        pystray.Menu.SEPARATOR,
        pystray.MenuItem("退出启动器", on_quit),
    )
    icon = pystray.Icon("AI启动器", image, "AI 人格启动器", menu)
    return icon


# --------------------------------------------------------------------------- #
# 入口
# --------------------------------------------------------------------------- #
def main() -> None:
    # 只有直接点中这些元素才拖窗，避免按钮被当成拖拽把手。
    webview.settings["DRAG_REGION_SELECTOR"] = ".drag"
    webview.settings["DRAG_REGION_DIRECT_TARGET_ONLY"] = True

    html = (ROOT / "ui" / "index.html").read_text(encoding="utf-8")
    api = Api()
    window = webview.create_window(
        WINDOW_TITLE,
        html=html,
        js_api=api,
        width=960,
        height=660,
        min_size=(860, 600),
        frameless=True,
        easy_drag=True,
        shadow=True,
        resizable=False,
        text_select=True,
        background_color="#0B0E14",
    )
    api.attach(window)
    window.events.closing += api.on_closing

    def on_started(*_a) -> None:
        tray = build_tray(api)
        if tray is not None:
            api._tray = tray
            try:
                tray.run_detached()
                api._log("已收进托盘，关窗不退出。")
            except Exception as e:
                api._tray = None
                api._log(f"托盘启动失败：{e}")
        threading.Thread(target=api.start_all, daemon=True).start()

    webview.start(on_started, debug=False, icon=str(ROOT / "brand" / "icon.ico"))


if __name__ == "__main__":
    main()
