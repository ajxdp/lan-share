# LanShare Windows 构建脚本
# 用法：powershell -ExecutionPolicy Bypass -File scripts/build-win.ps1
$ErrorActionPreference = "Stop"

# 国内镜像（国外网络可注释掉）
$env:ELECTRON_MIRROR = "https://npmmirror.com/mirrors/electron/"
$env:ELECTRON_BUILDER_BINARIES_MIRROR = "https://npmmirror.com/mirrors/electron-builder-binaries/"

Write-Host "==> npm install" -ForegroundColor Cyan
npm install

Write-Host "==> 构建 Windows 产物（NSIS 安装版 + zip 绿色版）" -ForegroundColor Cyan
npm run dist:win

Write-Host ""
Write-Host "构建完成，产物位于 dist/：" -ForegroundColor Green
Get-ChildItem dist -File | Where-Object { $_.Extension -in ".exe", ".zip" } | ForEach-Object {
    Write-Host ("  {0}  ({1:N1} MB)" -f $_.Name, ($_.Length / 1MB))
}
