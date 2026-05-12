"""
Generate OptiLearn PWA icons in all required sizes from the existing 512px source.
Run from the optilearn/ directory: python scripts/generate_icons.py
"""
from PIL import Image
import os
import sys

SOURCE = 'frontend/public/icons/icon-512.png'
ICONS_DIR = 'frontend/public/icons'

if not os.path.exists(SOURCE):
    print(f'Source icon not found: {SOURCE}')
    sys.exit(1)

os.makedirs(ICONS_DIR, exist_ok=True)

img = Image.open(SOURCE).convert('RGBA')

sizes = [72, 96, 128, 144, 152, 192, 384, 512]
for s in sizes:
    out_path = f'{ICONS_DIR}/icon-{s}x{s}.png'
    resized = img.resize((s, s), Image.LANCZOS)
    resized.save(out_path, format='PNG')
    print(f'Generated {s}x{s}: {out_path}')

# Favicon (32x32)
favicon = img.resize((32, 32), Image.LANCZOS)
favicon.save('frontend/public/favicon.ico', format='ICO')
print('favicon.ico generated.')

# Windows .ico (multi-size, used by desktop.py taskbar)
ico_sizes = [(16, 16), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)]
img.save('optilearn.ico', format='ICO', sizes=ico_sizes)
print('Windows icon created: optilearn.ico')
