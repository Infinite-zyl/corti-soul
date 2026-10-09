# ============================================================
# AI 人格启动器 —— 按序拉起 QQ → SnowLuma → Cortico，并做健康检查。
# DSH 不由本脚本管理（请自行设置开机自启），这里只探测它的状态。
# 幂等：组件已在运行时跳过，不会重复启动。可反复双击运行。
# ============================================================

$ErrorActionPreference = 'SilentlyContinue'
$ProgressPreference = 'SilentlyContinue'

# 栈根：放置 SnowLuma / cortico-qq 等组件的目录。本仓库作为它的子目录存在，
# 故默认上溯两级；可用环境变量 STACK_ROOT 覆盖（CORTICO_ROOT 单独覆盖 cortico-qq）。
$ROOT    = if ($env:STACK_ROOT) { $env:STACK_ROOT } else { Split-Path (Split-Path $PSScriptRoot -Parent) -Parent }
$SNOW    = Join-Path $ROOT 'SnowLuma'
$CORTICO = if ($env:CORTICO_ROOT) { $env:CORTICO_ROOT } else { Join-Path $ROOT 'cortico-qq' }
$DEPLOY  = 'mybot'

$QQ_CANDIDATES = @(
    "${env:ProgramFiles(x86)}\Tencent\QQNT\QQ.exe",
    "$env:ProgramFiles\Tencent\QQNT\QQ.exe",
    "$env:LOCALAPPDATA\Tencent\QQNT\QQ.exe"
)

function Test-Port([int]$port) {
    return [bool](Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue)
}

function Wait-Port([int]$port, [int]$timeoutSec, [string]$name) {
    $deadline = (Get-Date).AddSeconds($timeoutSec)
    while ((Get-Date) -lt $deadline) {
        if (Test-Port $port) {
            Write-Host "  [OK] $name (端口 $port)" -ForegroundColor Green
            return $true
        }
        Start-Sleep -Seconds 1
    }
    Write-Host "  [失败] $name 等待 ${timeoutSec}s 仍未就绪 (端口 $port)" -ForegroundColor Red
    return $false
}

function Test-QQProcess {
    return [bool](Get-Process -Name QQ -ErrorAction SilentlyContinue)
}

function Test-CorticoProcess {
    return [bool](Get-CimInstance Win32_Process -Filter "Name='node.exe'" -ErrorAction SilentlyContinue |
        Where-Object { $_.CommandLine -match 'cortico\.mjs' })
}

Write-Host ""
Write-Host "=== AI 人格启动器 ===" -ForegroundColor Cyan
Write-Host ""

# ---------- 1) DSH（只探测，不启动） ----------
if (Test-Port 18899) {
    Write-Host "  [OK] DSH 模型转发 (18899)" -ForegroundColor Green
} else {
    Write-Host "  [警告] DSH 模型转发 (18899) 不在线 —— Bot 暂时没有大脑。" -ForegroundColor Yellow
    Write-Host "         请确认 DSH 已启动或已设置开机自启。" -ForegroundColor Yellow
}

# ---------- 2) QQ ----------
if (Test-QQProcess) {
    Write-Host "  [OK] QQ 已在运行" -ForegroundColor Green
} else {
    $qq = $QQ_CANDIDATES | Where-Object { Test-Path $_ } | Select-Object -First 1
    if (-not $qq) {
        Write-Host "  [失败] 未找到 QQ.exe，请确认 QQ 已安装。" -ForegroundColor Red
    } else {
        Write-Host "  正在启动 QQ ..." -ForegroundColor Cyan
        Start-Process -FilePath $qq
        Start-Sleep -Seconds 3
        if (Test-QQProcess) { Write-Host "  [OK] QQ 进程已启动" -ForegroundColor Green }
        else { Write-Host "  [警告] QQ 进程尚未出现，请留意 QQ 窗口（可能需要确认登录）。" -ForegroundColor Yellow }
    }
}

# ---------- 3) SnowLuma ----------
if (Test-Port 5099) {
    Write-Host "  [OK] SnowLuma 已在运行 (WebUI 5099)" -ForegroundColor Green
} else {
    Write-Host "  正在启动 SnowLuma ..." -ForegroundColor Cyan
    Start-Process -FilePath (Join-Path $SNOW 'launcher.bat') -WorkingDirectory $SNOW -WindowStyle Minimized
    Wait-Port 5099 60 'SnowLuma WebUI' | Out-Null
}

# OneBot 就绪 = SnowLuma 已注入 QQ 并开始监听。Cortico 的 QQ World 连的就是它。
$onebotOk = Wait-Port 3001 90 'OneBot WS (SnowLuma 已注入 QQ)'
if (-not $onebotOk) {
    Write-Host "  [提示] OneBot 未就绪的常见原因：QQ 需要扫码/点确认登录，或 SnowLuma 注入未完成。" -ForegroundColor Yellow
    Write-Host "         处理完登录后再次运行本启动器即可（幂等，不会重复启动）。" -ForegroundColor Yellow
}

# ---------- 4) Cortico ----------
if (Test-Port 7788) {
    Write-Host "  [OK] Cortico 已在运行 (7788)" -ForegroundColor Green
} elseif (Test-CorticoProcess) {
    Write-Host "  Cortico 进程已存在，等待控制台端口 ..." -ForegroundColor Cyan
    Wait-Port 7788 60 'Cortico 控制台' | Out-Null
} else {
    Write-Host "  正在启动 Cortico (部署: $DEPLOY) ..." -ForegroundColor Cyan
    # bin/cortico.mjs 受监管启动默认 CORTICO_START_PAUSED=1（事件积压不投递）；
    # 无人值守场景显式置 0，否则启动后必须进控制台点「继续」才回话。
    $env:CORTICO_START_PAUSED = '0'
    Start-Process -FilePath 'node' -ArgumentList 'bin\cortico.mjs', $DEPLOY -WorkingDirectory $CORTICO -WindowStyle Minimized
    Wait-Port 7788 60 'Cortico 控制台' | Out-Null
}

# ---------- 汇总 ----------
Write-Host ""
Write-Host "=== 状态汇总 ===" -ForegroundColor Cyan
$status = @(
    @{ Name = 'DSH 模型转发 (18899)';    Up = (Test-Port 18899) },
    @{ Name = 'QQ 进程';                Up = (Test-QQProcess) },
    @{ Name = 'SnowLuma WebUI (5099)';  Up = (Test-Port 5099) },
    @{ Name = 'OneBot WS (3001)';       Up = (Test-Port 3001) },
    @{ Name = 'Cortico 控制台 (7788)';   Up = (Test-Port 7788) }
)
$allUp = $true
foreach ($s in $status) {
    if ($s.Up) {
        Write-Host ("  [OK]   " + $s.Name) -ForegroundColor Green
    } else {
        $allUp = $false
        Write-Host ("  [离线] " + $s.Name) -ForegroundColor Red
    }
}

Write-Host ""
if ($allUp) {
    Write-Host "全部就绪。手机 QQ 直接发消息即可对话。" -ForegroundColor Green
    Write-Host "控制台: http://127.0.0.1:7788/    SnowLuma: http://127.0.0.1:5099/" -ForegroundColor Cyan
    exit 0
} else {
    Write-Host "有组件未就绪 —— 见上方提示；本窗口保持打开便于排查。" -ForegroundColor Yellow
    exit 1
}
