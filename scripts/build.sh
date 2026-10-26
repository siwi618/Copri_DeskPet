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
xattr -cr "$APP"
codesign --force --deep -s - "$APP"

echo "已生成 $APP"
if [ "${1:-}" = "--run" ]; then
  pkill -x Copri 2>/dev/null || true
  open "$APP"
fi
