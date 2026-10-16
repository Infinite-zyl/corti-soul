"""corti-soul 启动器 — 人格启动器（Python 宿主 + WebView2 界面）。

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
from model_routing import ModelRouting
from game_controls import GameControls
from ui_assets import load_ui

import coreclr_env  # noqa: F401  — 必须在 import webview 之前导入
import webview
from webview.window import FixPoint

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
         （打包后 exe 在 <pkg>\\launcher\\dist\\corti-soul启动器\\ 里，往上找同样能命中）
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
    <pkg>\\launcher\\dist\\corti-soul启动器\\ 里，往上找同样能命中。
    """
    for cand in [ROOT, *ROOT.parents]:
        if (cand / "guard" / "upstream-guard.mjs").is_file():
            return cand
    return ROOT.parent


BASE = _resolve_base()
PKG = _find_pkg()
SNOW = BASE / "SnowLuma"
from runtime_paths import active_runtime
CORTICO = active_runtime(PKG, BASE)
RUNS = CORTICO / "deployments" / DEPLOY / "data" / "runs"
DEPLOY_ENV = CORTICO / "deployments" / DEPLOY / ".env"
GUARD_DIR = PKG / "guard"
GUARD_SCRIPT = GUARD_DIR / "upstream-guard.mjs"
GUARD_CFG = GUARD_DIR / "upstream-guard.json"
GUARD_STATE = GUARD_DIR / "upstream-guard-state.json"
# 托管服务的 stdout/stderr 落这里（按服务分文件）。启动器自己的日志窗口只留一行摘要，
# 排查失败原因要看这些文件。
LOG_DIR = PKG / "launcher" / "logs"


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


def guard_pids() -> list[int]:
    """Return only Node processes running this exact guard script."""
    ps = (
        "$ErrorActionPreference='SilentlyContinue'; "
        "Get-CimInstance Win32_Process -Filter \"Name='node.exe'\" | "
        "Where-Object { $_.CommandLine -match '(?i)(^|[\\\\/\" ])upstream-guard\\.mjs([\" ]|$)' } | "
        "ForEach-Object { $_.ProcessId }"
    )
    try:
        out = subprocess.run(
            ["powershell", "-NoProfile", "-NonInteractive", "-Command", ps],
            capture_output=True, text=True, timeout=12,
            creationflags=CREATE_NO_WINDOW,
        ).stdout
        return [int(line.strip()) for line in (out or "").splitlines() if line.strip().isdigit()]
    except Exception:
        return []


def pids_for_port(port: int) -> list[int]:
    """Find listener PIDs without relying on an optional Python package."""
    try:
        out = subprocess.run(
            ["netstat", "-ano", "-p", "tcp"], capture_output=True,
            text=True, timeout=6, creationflags=CREATE_NO_WINDOW,
        ).stdout
    except Exception:
        return []
    found = set()
    suffix = f":{port}"
    for line in (out or "").splitlines():
        fields = line.split()
        if len(fields) < 5 or fields[-2].upper() != "LISTENING":
            continue
        if fields[1].rsplit(":", 1)[-1] != str(port):
            continue
        if fields[1].endswith(suffix) and fields[-1].isdigit():
            found.add(int(fields[-1]))
    return sorted(found)


def stop_process_tree(pids: list[int]) -> tuple[list[int], list[str]]:
    stopped, errors = [], []
    for pid in sorted(set(pids)):
        if pid <= 0 or pid == os.getpid():
            continue
        try:
            result = subprocess.run(
                ["taskkill", "/PID", str(pid), "/T", "/F"],
                capture_output=True, text=True, timeout=10,
                creationflags=CREATE_NO_WINDOW,
            )
            if result.returncode == 0:
                stopped.append(pid)
            elif "not found" not in (result.stdout + result.stderr).lower():
                errors.append((result.stderr or result.stdout or f"PID {pid} 无法停止").strip())
        except Exception as e:
            errors.append(str(e))
    return stopped, errors


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
    from gateway_health import gateway_health
    return [
        gateway_health(CORTICO, DEPLOY),
        {"id": "qq", "name": "QQ 客户端", "detail": "QQNT", "kind": "proc", "arg": "QQ.exe"},
        {"id": "snow", "name": "SnowLuma", "detail": "5099 · WebUI / Hook", "kind": "port", "arg": 5099},
        {"id": "onebot", "name": "OneBot WS", "detail": "3001 · QQ 消息通道", "kind": "port", "arg": 3001},
        {"id": "cortico", "name": "Cortico 控制台", "detail": "7788 · 人格本体", "kind": "port", "arg": 7788},
        {"id": "guard", "name": "免费池守护", "detail": "upstream-guard", "kind": "guard", "arg": None},
    ]


def probe_all() -> list[dict]:
    svcs = list_services()
    results: dict[str, bool | None] = {}
    lock = threading.Lock()

    def work(svc: dict) -> None:
        if svc["kind"] == "gateway":
            up = svc['up']
        elif svc["kind"] == "port":
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
        s["up"] = results.get(s["id"], False)
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
        self._launched_pids: dict[str, set[int]] = collections.defaultdict(set)
        self._process_lock = threading.RLock()
        self._service_actions: dict[str, str] = {}
        self._action_lock = threading.Lock()
        self.busy = False
        self._quitting = False
        self._shutdown_done = False
        self._model_routing = ModelRouting(GUARD_DIR / 'routing-mode.json', CONSOLE_URL,
                                           lambda: self.stop_service('guard'), lambda: self.start_service('guard'))
        self._log("启动器就绪。")
        self._games = GameControls(PKG, CONSOLE_URL, self._log, cortico_root=CORTICO)

    # ---- 基础设施 ---------------------------------------------------------- #
    def attach(self, window) -> None:
        self._window = window

    def _log(self, msg: str) -> None:
        self._logs.append(f"[{time.strftime('%H:%M:%S')}] {msg}")

    def _service_log_path(self, service_id: str) -> pathlib.Path:
        """托管服务的输出落到这里，按服务分文件。"""
        return LOG_DIR / f"{service_id}.log"

    def _launch(self, service_id: str, args: list[str], *, cwd: pathlib.Path, env: dict) -> subprocess.Popen:
        with self._process_lock:
            if self._quitting:
                raise RuntimeError("启动器正在退出")
            LOG_DIR.mkdir(parents=True, exist_ok=True)
            # 输出直接重定向到文件，不走管道：进程是 DETACHED 的，启动器退出后还要继续跑，
            # 管道会随启动器一起关掉，之后再往 stdout 写就会拿到 EPIPE。
            log = open(self._service_log_path(service_id), "ab", buffering=0)
            try:
                log.write(f"\n===== {time.strftime('%Y-%m-%d %H:%M:%S')} 启动 {service_id} =====\n".encode("utf-8"))
                proc = subprocess.Popen(
                    args, cwd=str(cwd), env=env, creationflags=_FLAGS, close_fds=True,
                    stdin=subprocess.DEVNULL, stdout=log, stderr=subprocess.STDOUT,
                )
            finally:
                log.close()
            self._launched_pids[service_id].add(proc.pid)
            self._log(f"{service_id} 的输出写到 {self._service_log_path(service_id)}")
            return proc

    def _service_log_tail(self, service_id: str, lines: int = 6, width: int = 600) -> str:
        """服务日志的最后几行，用在失败提示里，省得让人自己去找文件。"""
        try:
            text = self._service_log_path(service_id).read_text(encoding="utf-8", errors="replace")
        except OSError:
            return ""
        tail = [ln.strip() for ln in text.splitlines() if ln.strip()][-lines:]
        return "；".join(tail)[-width:] if tail else ""

    # ---- 窗口控制 ---------------------------------------------------------- #
    def hide_window(self) -> dict:
        if self._window:
            self._window.hide()
        return {"ok": True}

    def show_window(self) -> dict:
        if self._window:
            self._window.show()
            try:
                self._window.evaluate_js(
                    "document.body.classList.remove('window-minimizing');"
                    "document.body.classList.add('window-restoring');"
                    "setTimeout(() => document.body.classList.remove('window-restoring'), 220);"
                )
            except Exception:
                pass
        return {"ok": True}

    def minimize_window(self) -> dict:
        if self._window:
            self._window.minimize()
        return {"ok": True}

    def resize_window(self, width: int, height: int, edge: str) -> dict:
        if not self._window:
            return {"ok": False}
        width, height = max(860, int(width)), max(600, int(height))
        fix = FixPoint.NORTH | FixPoint.WEST
        if "w" in edge:
            fix = (fix & ~FixPoint.WEST) | FixPoint.EAST
        if "n" in edge:
            fix = (fix & ~FixPoint.NORTH) | FixPoint.SOUTH
        self._window.resize(width, height, fix)
        return {"ok": True}

    def quit_app(self) -> dict:
        if not self._quitting:
            self._quitting = True
            self._log("正在退出并停止 SnowLuma / OneBot WS / Cortico / 免费池守护 …")
            self._stop_stack_services()
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
        """关闭窗口等同于退出；收进托盘使用单独的隐藏按钮。"""
        if not self._quitting:
            self._quitting = True
            self._log("窗口关闭，正在停止托管服务 …")
            self._stop_stack_services()
            if self._tray is not None:
                try:
                    self._tray.stop()
                except Exception:
                    pass
        return True

    def state_snapshot(self) -> dict:
        return {"tray": self._tray is not None}

    def _stop_stack_services(self) -> None:
        """Stop the four chain services the launcher owns on explicit exit."""
        self._games.close()
        with self._process_lock:
            if self._shutdown_done:
                return
            self._shutdown_done = True
            pids = set()
            for port in (5099, 3001, 7788):
                pids.update(pids_for_port(port))
            pids.update(guard_pids())
            for service_id in ("snow", "onebot", "cortico", "guard"):
                pids.update(self._launched_pids.get(service_id, set()))
        stopped, errors = stop_process_tree(list(pids))
        _guard_cache.update(ts=0.0, up=False)
        if stopped:
            self._log(f"已停止托管服务进程：{', '.join(map(str, stopped))}。")
        else:
            self._log("托管服务已离线，无需停止。")
        for error in errors:
            self._log(f"停止服务失败：{error[:160]}")

    def _action_targets(self, service_id: str) -> list[str]:
        return ["snow", "onebot"] if service_id in {"snow", "onebot"} else [service_id]

    def _begin_service_action(self, service_id: str, action: str) -> tuple[bool, list[str]]:
        targets = self._action_targets(service_id)
        with self._action_lock:
            if any(self._service_actions.get(target) for target in targets):
                return False, targets
            for target in targets:
                self._service_actions[target] = action
        return True, targets

    def _end_service_action(self, targets: list[str]) -> None:
        with self._action_lock:
            for target in targets:
                self._service_actions.pop(target, None)

    def stop_service(self, service_id: str) -> dict:
        if service_id not in {"snow", "onebot", "cortico", "guard"}:
            return {"ok": False, "msg": "此服务不支持在启动器内停止。"}
        acquired, targets = self._begin_service_action(service_id, "stopping")
        if not acquired:
            return {"ok": False, "msg": "该服务正在处理中，请稍候。"}
        try:
            return self._stop_service_impl(service_id)
        finally:
            self._end_service_action(targets)

    def start_service(self, service_id: str) -> dict:
        if service_id not in {"snow", "onebot", "cortico", "guard"}:
            return {"ok": False, "msg": "此服务不支持在启动器内启动。"}
        if self._quitting:
            return {"ok": False, "msg": "启动器正在退出。"}
        acquired, targets = self._begin_service_action(service_id, "starting")
        if not acquired:
            return {"ok": False, "msg": "该服务正在处理中，请稍候。"}
        try:
            return self._start_service_impl(service_id)
        finally:
            self._end_service_action(targets)

    def _stop_service_impl(self, service_id: str) -> dict:
        """Stop the process behind one visible service; shared listeners are reported."""
        service = next((s for s in list_services() if s["id"] == service_id), None)
        if service is None:
            return {"ok": False, "msg": "未知服务。"}
        if service["kind"] == "guard":
            pids = guard_pids() + list(self._launched_pids.get(service_id, set()))
        elif service["kind"] == "proc":
            try:
                result = subprocess.run(
                    ["taskkill", "/IM", service["arg"], "/T", "/F"],
                    capture_output=True, text=True, timeout=10,
                    creationflags=CREATE_NO_WINDOW,
                )
                _guard_cache.update(ts=0.0, up=False)
                if result.returncode == 0:
                    msg = f"已停止 {service['name']}。"
                    self._log(msg)
                    return {"ok": True, "msg": msg, "stopped": [service_id]}
                if "not found" in (result.stdout + result.stderr).lower():
                    return {"ok": True, "msg": f"{service['name']} 已离线。", "stopped": []}
                return {"ok": False, "msg": (result.stderr or result.stdout or "停止失败").strip()}
            except Exception as e:
                return {"ok": False, "msg": f"停止 {service['name']} 失败：{e}"}
        else:
            pids = pids_for_port(service["arg"]) + list(self._launched_pids.get(service_id, set()))

        if not pids:
            return {"ok": True, "msg": f"{service['name']} 已离线。", "stopped": []}
        affected = [
            s for s in list_services()
            if s["kind"] == "port" and set(pids_for_port(s["arg"])) & set(pids)
        ]
        stopped, errors = stop_process_tree(pids)
        if service["id"] == "guard":
            _guard_cache.update(ts=0.0, up=False)
        stopped_ids = [s["id"] for s in affected] or [service_id]
        error_msg = errors[0][:160] if errors else ""
        if stopped:
            names = [s["name"] for s in affected] or [service["name"]]
            msg = f"已停止 {'、'.join(names)}。"
            self._log(msg)
        else:
            msg = f"正在确认 {service['name']} 已停止。"
        verify_ids = set(stopped_ids) | {service_id}
        deadline = time.time() + 6
        while time.time() < deadline and any(self._service_is_up(sid) for sid in verify_ids):
            time.sleep(0.12)
        still_up = [sid for sid in verify_ids if self._service_is_up(sid)]
        if still_up:
            suffix = f"；{error_msg}" if error_msg else ""
            msg = f"停止请求未完成，服务仍在线（{', '.join(still_up)}）{suffix}。"
            self._log(msg)
            return {"ok": False, "msg": msg, "stopped": []}
        if not stopped:
            msg = f"{service['name']} 已确认停止。"
            self._log(msg)
        return {"ok": True, "msg": msg, "stopped": stopped_ids}

    def _service_is_up(self, service_id: str) -> bool:
        if service_id == "snow":
            return port_open(5099)
        if service_id == "onebot":
            return port_open(3001)
        if service_id == "cortico":
            return port_open(7788)
        if service_id == "guard":
            _guard_cache["ts"] = 0.0
            return guard_running()
        return False

    def _start_service_impl(self, service_id: str) -> dict:
        if service_id in {"snow", "onebot"}:
            if service_id == "onebot" and port_open(3001):
                return {"ok": True, "msg": "OneBot WS 已在线。"}
            if not port_open(5099):
                node = find_node()
                if not node:
                    return {"ok": False, "msg": "没找到 node.exe，无法启动 SnowLuma。"}
                env = dict(os.environ)
                env["SNOWLUMA_ONEBOT_HTTP_PORT"] = "3005"
                try:
                    self._launch("snow", [node, "index.mjs"], cwd=SNOW, env=env)
                except Exception as e:
                    return {"ok": False, "msg": f"启动 SnowLuma 失败：{e}"}
                if not wait_port(5099, 60, "SnowLuma WebUI", self._log, lambda: self._quitting):
                    return {"ok": False, "msg": "SnowLuma 启动超时。"}
            if service_id == "snow":
                return {"ok": True, "msg": "SnowLuma 已启动。"}
            if wait_port(3001, 15, "OneBot WS", self._log, lambda: self._quitting):
                return {"ok": True, "msg": "SnowLuma 和 OneBot WS 已就绪。"}
            webbrowser.open(SNOW_WEBUI)
            return {"ok": True, "msg": "SnowLuma 在线；请在其 WebUI 中重新接入 QQ，OneBot WS 才会启动。"}

        node = find_node()
        if not node:
            return {"ok": False, "msg": "没找到 node.exe，无法启动服务。"}
        if service_id == "cortico":
            if port_open(7788):
                return {"ok": True, "msg": "Cortico 控制台已在线。"}
            env = dict(os.environ)
            env["CORTICO_START_PAUSED"] = "0"
            env.update(deploy_env())
            try:
                self._launch("cortico", [node, os.path.join("bin", "cortico.mjs"), DEPLOY], cwd=CORTICO, env=env)
            except Exception as e:
                return {"ok": False, "msg": f"启动 Cortico 失败：{e}"}
            if wait_port(7788, 90, "Cortico 控制台", self._log, lambda: self._quitting):
                return {"ok": True, "msg": "Cortico 控制台已启动。"}
            tail = self._service_log_tail("cortico")
            return {"ok": False, "msg": f"Cortico 启动超时。{tail}" if tail else "Cortico 启动超时。"}

        if service_id == "guard":
            _guard_cache["ts"] = 0.0
            if guard_running():
                return {"ok": True, "msg": "免费池守护已在线。"}
            try:
                _guard_cache["ts"] = 0.0
                proc = self._launch("guard", [node, str(GUARD_SCRIPT)], cwd=GUARD_DIR, env=os.environ.copy())
            except Exception as e:
                return {"ok": False, "msg": f"启动免费池守护失败：{e}"}
            deadline = time.time() + 12
            while time.time() < deadline:
                if guard_pids():
                    _guard_cache.update(ts=time.time(), up=True)
                    return {"ok": True, "msg": "免费池守护已启动。"}
                if proc.poll() is not None:
                    return {"ok": False, "msg": "免费池守护启动后立即退出，请查看日志。"}
                time.sleep(0.4)
            return {"ok": False, "msg": "免费池守护启动超时。"}
        return {"ok": False, "msg": "未知服务。"}

    def open_console(self) -> dict:
        webbrowser.open(CONSOLE_URL)
        self._log("已在浏览器打开控制台。")
        return {"ok": True}

    def open_snowluma(self) -> dict:
        webbrowser.open(SNOW_WEBUI)
        return {"ok": True}

    # ---- 状态 -------------------------------------------------------------- #
    def get_model_options(self) -> dict:
        try:
            return self._model_routing.options()
        except Exception as error:
            return {'ok': False, 'msg': str(error), 'providers': []}

    def set_model_mode(self, mode: str, provider: str = '') -> dict:
        result = self._model_routing.apply(mode, provider)
        self._log(result['msg'])
        return result

    def get_games_status(self) -> dict:
        return self._games.snapshot()

    def game_action(self, game: str, lane: str, action: str) -> dict:
        return self._games.action(game, lane, action)

    def open_mobile_viewer(self) -> dict:
        return self._games.open_viewer()

    def open_game_settings(self, game: str) -> dict:
        return self._games.open_settings(game)

    def get_status(self) -> dict:
        svcs = probe_all()
        with self._action_lock:
            actions = dict(self._service_actions)
        for service in svcs:
            service["action"] = actions.get(service["id"], "")
        guard_state = read_json(GUARD_STATE)
        guard_cfg = read_json(GUARD_CFG)
        items, run = recent_activity()
        provider = {
            "routing": self._model_routing.state(),
            "active": guard_state.get("current", ""),
            "primary": guard_cfg.get("primary", ""),
            "fallback": guard_cfg.get("fallback", ""),
            "switches": guard_state.get("fallbackSwitches", 0),
            "maxSwitches": guard_cfg.get("maxFallbackSwitchesPerDay", 12),
            "probeEvery": guard_cfg.get("probeIntervalSec", 60),
        }
        active = active_provider()
        for service in svcs:
            service['paused'] = service['id'] == 'guard' and provider['routing']['mode'] == 'manual'
            if service['paused']:
                service['detail'] = '手动模式 · 自动切换已暂停'
        if active:
            provider["active"] = str(active)

        return {
            "ts": time.strftime("%H:%M:%S"),
            "version": APP_VERSION,
            "appName": APP_NAME,
            "uptime": f"{round(time.time() - _START)}s",
            "serviceCount": len(svcs),
            "services": svcs,
            "allUp": all(s["up"] or s.get('paused') for s in svcs),
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
        if self._quitting:
            return {"ok": False, "msg": "启动器正在退出。"}
        if self.busy:
            return {"ok": False, "msg": "正在启动中，请稍候"}
        threading.Thread(target=self._start_all, daemon=True).start()
        return {"ok": True}

    def _start_all(self) -> None:
        self.busy = True
        try:
            if self._quitting:
                return
            node = find_node()

            # ① DSH 模型转发
            from gateway_health import gateway_health
            gateway = gateway_health(CORTICO, DEPLOY)
            self._log(('模型转发：' if gateway['up'] is not False else '警告：模型转发入口不可连接：') + gateway['detail'])

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
            if self._quitting:
                return
            if port_open(5099):
                self._log("SnowLuma 已在运行。")
            else:
                env = dict(os.environ)
                env["SNOWLUMA_ONEBOT_HTTP_PORT"] = "3005"
                try:
                    self._launch("snow", [node, "index.mjs"], cwd=SNOW, env=env)
                    self._log("已拉起 SnowLuma，等待 WebUI …")
                except Exception as e:
                    self._log(f"拉起 SnowLuma 失败：{e}")
                if wait_port(5099, 60, "SnowLuma WebUI", self._log, lambda: self._quitting):
                    self._log("SnowLuma 就绪。")
                if self._quitting:
                    return

            # ④ OneBot WS
            if self._quitting:
                return
            if port_open(3001):
                self._log("OneBot WS 已就绪。")
            else:
                if wait_port(3001, 90, "OneBot WS", self._log, lambda: self._quitting):
                    self._log("OneBot WS 就绪。")
                else:
                    self._log(
                        "OneBot WS 未就绪：确认 SnowLuma/config/runtime.json 里 hookAutoLoad=true，"
                        "或在 http://127.0.0.1:5099/ 手动接入。Cortico 仍会照常启动。"
                    )

            # ⑤ Cortico
            if self._quitting:
                return
            if port_open(7788):
                self._log("Cortico 已在运行。")
            else:
                env = dict(os.environ)
                env["CORTICO_START_PAUSED"] = "0"
                env.update(deploy_env())
                try:
                    self._launch("cortico", [node, os.path.join("bin", "cortico.mjs"), DEPLOY], cwd=CORTICO, env=env)
                    self._log("已拉起 Cortico，等待控制台 …")
                except Exception as e:
                    self._log(f"拉起 Cortico 失败：{e}")
                if wait_port(7788, 90, "Cortico 控制台", self._log, lambda: self._quitting):
                    self._log("Cortico 就绪。")
                else:
                    tail = self._service_log_tail("cortico")
                    self._log(f"Cortico 没起来，日志末尾：{tail}" if tail else "Cortico 没起来，见 launcher/logs/cortico.log。")
                if self._quitting:
                    return

            # ⑥ 免费池守护
            if self._quitting:
                return
            if self._model_routing.state()['mode'] == 'manual':
                self._log('手动模式：免费池自动守护保持暂停。')
            elif guard_running():
                self._log("免费池守护已在运行。")
            else:
                try:
                    self._launch("guard", [node, str(GUARD_SCRIPT)], cwd=GUARD_DIR, env=os.environ.copy())
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


def wait_port(port: int, seconds: int, what: str, log, cancelled=lambda: False) -> bool:
    deadline = time.time() + seconds
    while time.time() < deadline:
        if cancelled():
            return False
        if port_open(port):
            return True
        time.sleep(0.25)
    if cancelled():
        return False
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
    icon = pystray.Icon("corti-soul", image, WINDOW_TITLE, menu)
    return icon


# --------------------------------------------------------------------------- #
# 入口
# --------------------------------------------------------------------------- #
def main() -> None:
    # 只有直接点中这些元素才拖窗，避免按钮被当成拖拽把手。
    webview.settings["DRAG_REGION_SELECTOR"] = ".titlebar, .titlebar .grow, .titlebar b, .titlebar .tag, .titlebar .orb"
    webview.settings["DRAG_REGION_DIRECT_TARGET_ONLY"] = True

    html = load_ui(ROOT / "ui")
    api = Api()
    window = webview.create_window(
        WINDOW_TITLE,
        html=html,
        js_api=api,
        width=960,
        height=660,
        min_size=(860, 600),
        frameless=True,
        easy_drag=False,
        shadow=True,
        resizable=True,
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
                api._log("托盘已就绪；⤓ 隐藏窗口继续运行，关闭窗口会停止托管服务。")
            except Exception as e:
                api._tray = None
                api._log(f"托盘启动失败：{e}")
        threading.Thread(target=api.start_all, daemon=True).start()

    webview.start(on_started, debug=False, icon=str(ROOT / "brand" / "icon.ico"))


if __name__ == "__main__":
    main()
