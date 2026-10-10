# -*- coding: utf-8 -*-
"""生成 LanShare 应用图标：build/icon.png / build/icon.ico / src/main/assets/tray.png"""
import os
from PIL import Image, ImageDraw

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
S = 1024

def lerp(a, b, t):
    return tuple(int(a[i] + (b[i] - a[i]) * t) for i in range(3))

def build_base():
    img = Image.new('RGBA', (S, S), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)

    # 对角渐变背景（画在方形上，再以圆角蒙版裁切）
    bg = Image.new('RGBA', (S, S), (0, 0, 0, 0))
    bd = ImageDraw.Draw(bg)
    c1, c2 = (74, 140, 255, 255), (26, 58, 168, 255)  # #4a8cff -> #1a3aa8
    for y in range(S):
        for_x = y / (S - 1)
        # 渐变沿对角线：用逐行近似 + 逐列微调太慢，这里按 (x+y)/2S 逐像素太慢
        # 改为逐行 + 逐像素采样（1024x1024 可接受）
        pass
    px = bg.load()
    for y in range(S):
        for x in range(0, S, 4):  # 步进 4 后再放大，加速
            t = (x + y) / (2 * (S - 1))
            col = lerp(c1, c2, t)
            for dx in range(4):
                if x + dx < S:
                    px[x + dx, y] = col

    mask = Image.new('L', (S, S), 0)
    md = ImageDraw.Draw(mask)
    md.rounded_rectangle([0, 0, S, S], radius=224, fill=255)
    img.paste(bg, (0, 0), mask)

    # 高光：左上淡白椭圆，透明度低
    hl = Image.new('RGBA', (S, S), (0, 0, 0, 0))
    hd = ImageDraw.Draw(hl)
    hd.ellipse([-260, -300, 760, 560], fill=(255, 255, 255, 26))
    img = Image.alpha_composite(img, hl)
    d = ImageDraw.Draw(img)

    WHITE = (255, 255, 255, 255)
    # 文件夹标签（后盖）
    d.rounded_rectangle([196, 258, 548, 400], radius=58, fill=WHITE)
    # 文件夹主体
    d.rounded_rectangle([196, 330, 828, 790], radius=64, fill=WHITE)

    BLUE = (47, 107, 255, 255)
    ORANGE = (255, 159, 67, 255)
    cx, cy = 512, 756
    # WiFi 弧线两条（朝上张开）
    w = 40
    d.arc([cx - 190, cy - 190, cx + 190, cy + 190], start=205, end=335, fill=BLUE, width=w)
    d.arc([cx - 110, cy - 110, cx + 110, cy + 110], start=205, end=335, fill=BLUE, width=w)
    # 顶点圆点
    r = 34
    d.ellipse([cx - r, cy - 44 - r, cx + r, cy - 44 + r], fill=ORANGE)
    return img

def main():
    img = build_base()
    os.makedirs(os.path.join(ROOT, 'build'), exist_ok=True)
    os.makedirs(os.path.join(ROOT, 'src', 'main', 'assets'), exist_ok=True)

    # PNG（electron-builder mac 用，≥512）
    img.resize((1024, 1024), Image.LANCZOS).save(os.path.join(ROOT, 'build', 'icon.png'))

    # ICO（Windows，多尺寸）
    base512 = img.resize((512, 512), Image.LANCZOS)
    base512.save(
        os.path.join(ROOT, 'build', 'icon.ico'),
        sizes=[(16, 16), (24, 24), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)]
    )

    # 托盘图标（32）
    img.resize((32, 32), Image.LANCZOS).save(os.path.join(ROOT, 'src', 'main', 'assets', 'tray.png'))

    # 预览
    img.resize((256, 256), Image.LANCZOS).save(os.path.join(ROOT, 'build', 'icon-preview-256.png'))
    print('icons generated:')
    print('  build/icon.png (1024)')
    print('  build/icon.ico (16-256)')
    print('  src/main/assets/tray.png (32)')
    print('  build/icon-preview-256.png')

if __name__ == '__main__':
    main()
