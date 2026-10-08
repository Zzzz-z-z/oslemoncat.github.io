# 一键推送：在本机普通终端（PowerShell）里运行即可，会弹出 GitHub 登录窗口。
#   pwsh -File scripts/push.ps1
#
# 前置：git config http.sslBackend openssl（脚本会自动检查）
#       —— 本机 git 走 schannel 时报 SEC_E_NO_CREDENTIALS，改用 openssl 即正常。

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root

if (-not (Test-Path '.git')) { throw "当前目录不是 git 仓库：$root" }

$backend = git config --local http.sslBackend
if ($backend -ne 'openssl') {
  Write-Host '设置 http.sslBackend=openssl（本机 schannel 无法握手 GitHub）'
  git config --local http.sslBackend openssl
}

$branch = (git rev-parse --abbrev-ref HEAD).Trim()
Write-Host "当前分支：$branch"
Write-Host '本地待推送提交：'
git --no-pager log --oneline -n 3

Write-Host "`n开始推送……（首次会要求登录 GitHub，可在浏览器窗口完成授权）"
git push origin $branch

if ($LASTEXITCODE -eq 0) {
  Write-Host "`n✅ 推送成功。" -ForegroundColor Green
  Write-Host '接下来：'
  Write-Host '  1. 打开 https://github.com/oslemoncat/oslemoncat.github.io/actions 看部署流程是否变绿'
  Write-Host '  2. 确认仓库 Settings → Pages → Source 为 "GitHub Actions"'
  Write-Host '  3. 访问 https://oslemoncat.github.io/'
} else {
  Write-Warning "推送失败（exit=$LASTEXITCODE）。若提示需要强制或存在分歧，请先执行：git pull --rebase origin $branch"
}
