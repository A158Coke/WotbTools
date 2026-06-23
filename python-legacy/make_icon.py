#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
生成一个原创的坦克主题应用图标 icon.ico (非任何官方 logo, 自绘, 可自由分发)。
    python make_icon.py
"""
import os

from PIL import Image, ImageDraw

BG1 = (47, 67, 89)     # 深蓝灰 (与 xlsx 表头同色系)
BG2 = (33, 48, 66)
TANK = (224, 196, 122)  # 弹壳金
TANK_DK = (180, 150, 80)
TRACK = (60, 60, 64)


def rounded(draw, box, r, fill):
    draw.rounded_rectangle(box, radius=r, fill=fill)


def render(size):
    S = 256  # 先按高分辨率绘制再缩放, 边缘更平滑
    img = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)

    # 背景: 圆角方块 + 顶部高光
    rounded(d, (8, 8, S - 8, S - 8), 48, BG2)
    rounded(d, (8, 8, S - 8, S - 12), 48, BG1)

    cx = S // 2
    # 履带 (底部圆角长条 + 负重轮)
    d.rounded_rectangle((40, 178, S - 40, 214), radius=18, fill=TRACK)
    for x in range(58, S - 50, 26):
        d.ellipse((x - 9, 184, x + 9, 208), fill=(95, 95, 100))

    # 车体
    d.polygon([(52, 178), (S - 52, 178), (S - 64, 146), (64, 146)], fill=TANK_DK)
    d.rounded_rectangle((58, 150, S - 58, 180), radius=8, fill=TANK)

    # 炮塔
    d.rounded_rectangle((92, 112, 168, 152), radius=14, fill=TANK)
    d.rounded_rectangle((92, 140, 168, 152), radius=10, fill=TANK_DK)

    # 炮管
    d.rounded_rectangle((160, 122, 226, 134), radius=6, fill=TANK)
    d.rounded_rectangle((220, 118, 232, 138), radius=4, fill=TANK_DK)

    if size != S:
        img = img.resize((size, size), Image.LANCZOS)
    return img


def main():
    # 图标是 Python 与 Java 两侧构建共用的资源, 输出到仓库的 common/assets/。
    here = os.path.dirname(os.path.abspath(__file__))
    out_dir = os.path.join(here, "..", "common", "assets")
    os.makedirs(out_dir, exist_ok=True)
    ico = os.path.join(out_dir, "icon.ico")
    png = os.path.join(out_dir, "icon.png")
    sizes = [16, 24, 32, 48, 64, 128, 256]
    imgs = [render(s) for s in sizes]
    imgs[0].save(ico, format="ICO", sizes=[(s, s) for s in sizes],
                 append_images=imgs[1:])
    render(256).save(png)
    print(f"已生成 {ico} 和 {png}")


if __name__ == "__main__":
    main()
