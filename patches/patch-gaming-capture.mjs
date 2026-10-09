/**
 * 给 gaming 扩展的抓图逻辑加一层回退：PrintWindow 失败时改用屏幕像素（BitBlt）。
 *
 * 为什么要打这个补丁：
 *   PrintWindow 请求窗口自己重绘，只能拿到 GDI 绘制队列里的内容。异环（UE）、
 *   原神、守望先锋这类 GPU/DirectX 渲染的窗口，画面不进 GDI 队列，于是
 *   PrintWindow 返回失败，扩展报 CAPTURE_FAIL —— 表现就是"看一眼没看成"。
 *   桌面 DC 的 BitBlt 拷的是 DWM 合成后的屏幕像素，GPU 画面在里面。
 *
 * 代价：窗口被遮挡时抓到的是遮挡物，所以只在 PrintWindow 失败后才走这条路。
 *
 * 幂等：已打过就跳过。扩展升级覆盖后可重新运行本脚本。
 * 回滚：把同目录的 screen.ts.orig 覆盖回 screen.ts。
 */
import fs from 'node:fs';
import path from 'node:path';

// 目标目录：Cortico 检出下的 gaming 扩展源码。
// 默认取本仓库的兄弟目录 ../cortico-qq；可用环境变量 CORTICO_ROOT 覆盖。
const REPO_ROOT = path.resolve(import.meta.dirname, '..');
const CORTICO = path.resolve(process.env.CORTICO_ROOT ?? path.join(REPO_ROOT, '..', 'cortico-qq'));
const SRC = path.join(CORTICO, 'extensions', 'node_modules', 'cortico-world-gaming-alont1', 'src');


const FILE = path.join(SRC, 'screen.ts');
const BACKUP = FILE + '.orig';

// 先回滚到原始版本（若备份在），保证可重复执行
if (fs.existsSync(BACKUP)) {
  fs.copyFileSync(BACKUP, FILE);
  console.log('已从备份还原，准备重新打补丁。');
} else {
  fs.writeFileSync(BACKUP, fs.readFileSync(FILE, 'utf8'), 'utf8');
  console.log('已备份原文件 ->', path.basename(BACKUP));
}

let src = fs.readFileSync(FILE, 'utf8');
const before = src;

// 1) 只补缺失的两个 P/Invoke（DeleteDC 原脚本已有）
const anchor1 = `  [DllImport("gdi32.dll")] public static extern IntPtr CreateCompatibleDC(IntPtr dc);`;
if (!src.includes(anchor1)) { console.error('锚点1 未命中'); process.exit(1); }
src = src.replace(anchor1, anchor1 + `
  [DllImport("gdi32.dll")] public static extern IntPtr CreateDC(string drv, string dev, string port, IntPtr pd);
  [DllImport("gdi32.dll")] public static extern bool BitBlt(IntPtr dst, int dx, int dy, int w, int h, IntPtr src, int sx, int sy, int rop);`);

// 2) 补 GrabScreen 方法
const anchor2 = `    full.Dispose();
    return crop;
  }
}
'@`;
if (!src.includes(anchor2)) { console.error('锚点2 未命中'); process.exit(1); }
src = src.replace(anchor2, `    full.Dispose();
    return crop;
  }

  /// 从桌面 DC 直接拷贝窗口所在屏幕区域的像素。
  /// GPU/DirectX 窗口的内容不进 GDI 绘制队列，PrintWindow 拿不到；屏幕像素里有。
  public static Bitmap GrabScreen(IntPtr h, int maxWidth) {
    RECT r;
    if (!GetWindowRect(h, out r)) return null;
    int w = r.R - r.L, hh = r.B - r.T;
    if (w <= 0 || hh <= 0) return null;
    Bitmap bmp = new Bitmap(w, hh, PixelFormat.Format32bppArgb);
    using (Graphics g = Graphics.FromImage(bmp)) {
      IntPtr ddc = CreateDC("DISPLAY", null, null, IntPtr.Zero);
      IntPtr hdc = g.GetHdc();
      try { BitBlt(hdc, 0, 0, w, hh, ddc, r.L, r.T, 0x00CC0020); }
      finally { g.ReleaseHdc(hdc); DeleteDC(ddc); }
    }
    if (maxWidth > 0 && bmp.Width > maxWidth) {
      int nh = (int)Math.Round((double)bmp.Height * maxWidth / bmp.Width);
      Bitmap small = new Bitmap(maxWidth, nh);
      using (Graphics g = Graphics.FromImage(small)) {
        g.InterpolationMode = System.Drawing.Drawing2D.InterpolationMode.HighQualityBicubic;
        g.DrawImage(bmp, 0, 0, maxWidth, nh);
      }
      bmp.Dispose();
      bmp = small;
    }
    return bmp;
  }
}
'@`);

// 3) 失败回退
const anchor3 = `$bmp = [GamingCapture]::Capture($h)
if ($null -eq $bmp) { Write-Output 'CAPTURE_FAIL'; exit 1 }`;
if (!src.includes(anchor3)) { console.error('锚点3 未命中'); process.exit(1); }
src = src.replace(anchor3, `$bmp = [GamingCapture]::Capture($h)
$via = 'printwindow'
if ($null -eq $bmp) {
  $bmp = [GamingCapture]::GrabScreen($h, $MaxWidth)
  $via = 'screen'
}
if ($null -eq $bmp) { Write-Output 'CAPTURE_FAIL'; exit 1 }`);

// 4) 输出带 via 标记
const anchor4 = `Write-Output ("OK {0}x{1}" -f $bmp.Width, $bmp.Height)`;
if (!src.includes(anchor4)) { console.error('锚点4 未命中'); process.exit(1); }
src = src.replace(anchor4, `Write-Output ("OK {0}x{1} via {2}" -f $bmp.Width, $bmp.Height, $via)`);

fs.writeFileSync(FILE, src, 'utf8');
console.log('补丁已应用（差异', src.length - before.length, '字符）。');
