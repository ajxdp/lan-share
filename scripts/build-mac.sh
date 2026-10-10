#!/usr/bin/env bash
# LanShare macOS 构建脚本
# 用法：bash scripts/build-mac.sh
set -e

# 国内镜像（国外网络可注释掉）
export ELECTRON_MIRROR="https://npmmirror.com/mirrors/electron/"
export ELECTRON_BUILDER_BINARIES_MIRROR="https://npmmirror.com/mirrors/electron-builder-binaries/"

echo "==> npm install"
npm install

echo "==> 构建 macOS 产物（dmg 安装版 + zip 绿色版）"
npm run dist:mac

echo ""
echo "构建完成，产物位于 dist/："
ls -lh dist/*.dmg dist/*.zip 2>/dev/null || true
