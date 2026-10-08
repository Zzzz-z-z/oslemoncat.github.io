# 本地视觉自检：依次给关键路由截图，输出到 .preview/ 目录。
# 用法（在项目根目录）：
#   pwsh -File scripts/verify-layout.ps1
#
# 说明：DSH 沙箱会拦截 Edge/Chrome 的副进程（mojo 命名管道被拒），
#      因此这个脚本需要在普通终端里运行，不能隔着沙箱跑。

param(
  [int]$Port = 8123,
  [string]$Browser = '',
  [int]$Width = 1440,
  [int]$Height = 1000
)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$outDir = Join-Path $root '.preview'
New-Item -ItemType Directory -Force -Path $outDir | Out-Null

if (-not $Browser) {
  $candidates = @(
    "$env:ProgramFiles\Microsoft\Edge\Application\msedge.exe",
    "${env:ProgramFiles(x86)}\Microsoft\Edge\Application\msedge.exe",
    "$env:ProgramFiles\Google\Chrome\Application\chrome.exe",
    "${env:ProgramFiles(x86)}\Google\Chrome\Application\chrome.exe",
    "$env:LOCALAPPDATA\Google\Chrome\Application\chrome.exe"
  )
  $Browser = $candidates | Where-Object { Test-Path $_ } | Select-Object -First 1
}
if (-not $Browser) { throw '找不到 Edge 或 Chrome，可用 -Browser 指定完整路径。' }

# 启动静态服务器（优先 python，退化到 Windows 的 py 启动器）
$python = (Get-Command python -ErrorAction SilentlyContinue).Source
if (-not $python) { $python = (Get-Command py -ErrorAction SilentlyContinue).Source }
if (-not $python) { throw '找不到 python / py，无法启动本地静态服务器。' }
$server = Start-Process -FilePath $python -ArgumentList '-m', 'http.server', $Port, '--bind', '127.0.0.1' `
  -WorkingDirectory $root -PassThru -WindowStyle Hidden
Start-Sleep -Seconds 2

$routes = [ordered]@{
  'home'         = '#/'
  'modules'      = '#/modules'
  'articles'     = '#/articles'
  'article-math' = '#/article/apostol-sequence-limit'
  'article-la'   = '#/article/linear-algebra-vectors-and-planes'
  'about'        = '#/about'
  'dark-home'    = '#/'
}

try {
  foreach ($name in $routes.Keys) {
    $file = Join-Path $outDir "$name.png"
    $url = "http://127.0.0.1:$Port/$($routes[$name])"
    $args = @(
      '--headless=new', '--disable-gpu', '--hide-scrollbars',
      '--no-first-run', '--no-default-browser-check',
      "--user-data-dir=$(Join-Path $outDir "profile-$name")",
      "--window-size=$Width,$Height",
      '--virtual-time-budget=9000',
      "--screenshot=$file", $url
    )
    if ($name -eq 'dark-home') { $args = @('--force-dark-mode') + $args }
    & $Browser @args 2>$null | Out-Null
    if (Test-Path $file) { Write-Host "ok   $name -> $file" } else { Write-Warning "失败 $name" }
  }
}
finally {
  Stop-Process -Id $server.Id -Force -ErrorAction SilentlyContinue
}

Write-Host "`n截图已在 $outDir，请逐张检查布局、公式与暗色模式。"
