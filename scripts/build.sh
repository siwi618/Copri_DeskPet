#!/bin/bash
# 编译并打包 build/Copri.app。用法：scripts/build.sh [--run]
set -euo pipefail
cd "$(dirname "$0")/.."

APP=build/Copri.app
rm -rf "$APP"
mkdir -p "$APP/Contents/MacOS" "$APP/Contents/Resources"

swiftc -O -target arm64-apple-macos13.0 Sources/*.swift -o "$APP/Contents/MacOS/Copri"
cp Resources/Info.plist "$APP/Contents/"
if [ -f Resources/AppIcon.icns ]; then cp Resources/AppIcon.icns "$APP/Contents/Resources/"; fi
mkdir -p "$APP/Contents/Resources/web"
cp web/pet.html web/pet.css web/pet.js "$APP/Contents/Resources/web/"
# 桌面目录会给文件挂 Finder/provenance 扩展属性，codesign 会拒绝签名：
# 去掉扩展属性复制到临时目录签名，再复制回来
STAGE=$(mktemp -d)
ditto --norsrc --noextattr "$APP" "$STAGE/Copri.app"
codesign --force --deep -s - "$STAGE/Copri.app"
rm -rf "$APP"
ditto --norsrc --noextattr "$STAGE/Copri.app" "$APP"
rm -rf "$STAGE"
codesign --verify --deep "$APP"

echo "已生成 $APP"
if [ "${1:-}" = "--run" ]; then
  pkill -x Copri 2>/dev/null || true
  open "$APP"
fi
