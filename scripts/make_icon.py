# 把 Playwright 截下的 scripts/icon.html（512x512）做成圆角 AppIcon.icns。
# 用法：python3 scripts/make_icon.py build/icon_raw.png   （需要 Pillow）
import os, subprocess, sys, tempfile
from PIL import Image, ImageDraw

src = Image.open(sys.argv[1]).convert('RGBA').resize((1024, 1024), Image.LANCZOS)
# macOS 图标网格：824px 圆角方块居中，四周留白
tile = src.resize((824, 824), Image.LANCZOS)
mask = Image.new('L', (824, 824), 0)
ImageDraw.Draw(mask).rounded_rectangle([0, 0, 823, 823], radius=185, fill=255)
icon = Image.new('RGBA', (1024, 1024), (0, 0, 0, 0))
icon.paste(tile, (100, 100), mask)

out = os.path.join(os.path.dirname(__file__), '..', 'Resources', 'AppIcon.icns')
with tempfile.TemporaryDirectory() as d:
    iconset = os.path.join(d, 'AppIcon.iconset')
    os.mkdir(iconset)
    for s in (16, 32, 128, 256, 512):
        icon.resize((s, s), Image.LANCZOS).save(f'{iconset}/icon_{s}x{s}.png')
        icon.resize((s * 2, s * 2), Image.LANCZOS).save(f'{iconset}/icon_{s}x{s}@2x.png')
    subprocess.run(['iconutil', '-c', 'icns', iconset, '-o', out], check=True)
print('已生成', os.path.normpath(out))
