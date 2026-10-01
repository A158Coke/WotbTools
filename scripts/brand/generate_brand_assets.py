"""WoTBTools 品牌资源生成器：一份几何定义 → 全部 SVG / PNG / ICO / Android 图标。

用法（仓库根目录）：
    python scripts/brand/generate_brand_assets.py

依赖：Pillow；本机 Chrome / Chromium（无头模式栅格化 SVG，透明背景）。
图形改动只改本文件里的 MARK_BODY / MARK_ACCENT 几何，然后重新运行；不要手改生成产物。

图形（沿用 2026 版前的 AI 位图构图，矢量重绘）：左向坦克——炮管 + 炮塔 + 车体，
车体前段开口扳手负形（工具），车尾三根增长柱（数据）。坐标系即 MARK_VIEWBOX。
"""
from __future__ import annotations

import os
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parents[2]
ASSETS = ROOT / "common" / "assets"
BRAND = ASSETS / "brand"
KEYCLOAK_IMG = ROOT / "docker" / "keycloak" / "themes" / "wotbtools" / "login" / "resources" / "img"
ANDROID_RES = ROOT / "android" / "app" / "src" / "main" / "res"

MARK_VIEWBOX = (230, 360, 780, 365)

# 扳手负形（mask 内黑色 = 挖掉）：圆环头 + 右上开口钳口（白色 = 保留车体）+ 斜向手柄
WRENCH_MASK = """
  <circle cx="530" cy="622" r="46" fill="none" stroke="#000" stroke-width="20"/>
  <path d="M535 595.8 L576 554.8 L597.2 576 L556.2 617 Z" fill="#fff"/>
  <path d="M497 655 L430 722" stroke="#000" stroke-width="22"/>
"""
TURRET_AND_GUN = "M238 462 H305 V467 H548 L572 452 H520 L563 395 H728 L768 437 L652 522 H490 L462 500 H305 V505 H245 Z"
HULL_FRONT = "M315 640 L410 545 H683 V600 H648 L600 693 H385 Z"
HULL_REAR = "M668 618 H912 V555 H930 L1000 610 L935 693 H625 Z"
BARS = [
    "M705 612 V525 L748 500 V612 Z",
    "M781 612 V470 L834 440 V612 Z",
    "M857 612 V405 L912 372 V612 Z",
]

# 配色：车体随背景反相，增长柱固定为设计语言琥珀（tokens/color.css --color-accent）
INK_ON_LIGHT = "#313942"
INK_ON_DARK = "#e9ecea"
ACCENT = "#e0a02e"
TILE = "#0d1117"  # 与 Android ic_launcher_background 一致


def mark_svg(body: str, accent: str, mask_id: str = "wotbtools-wrench") -> str:
    """单独的图形（无底板），坐标系为 MARK_VIEWBOX。"""
    x, y, w, h = MARK_VIEWBOX
    bars = "".join(f'<path d="{d}"/>' for d in BARS)
    return (
        f'<mask id="{mask_id}" maskUnits="userSpaceOnUse" x="{x}" y="{y}" width="{w}" height="{h + 10}">'
        f'<rect x="{x}" y="{y}" width="{w}" height="{h + 10}" fill="#fff"/>{WRENCH_MASK}</mask>'
        f'<g fill="{body}"><path d="{TURRET_AND_GUN}"/>'
        f'<path mask="url(#{mask_id})" d="{HULL_FRONT}"/><path d="{HULL_REAR}"/></g>'
        f'<g fill="{accent}">{bars}</g>'
    )


def standalone_mark(body: str, accent: str) -> str:
    x, y, w, h = MARK_VIEWBOX
    return (
        f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="{x} {y} {w} {h}" role="img" aria-label="WoTBTools">'
        f"{mark_svg(body, accent)}</svg>\n"
    )


def app_icon(shape: str = "rounded", mark_width: float = 0.84, background: bool = True) -> str:
    """方形应用图标（viewBox 0 0 64 64）：深色底板 + 浅色图形。shape: rounded | circle。"""
    x, y, w, h = MARK_VIEWBOX
    mw = 64 * mark_width
    mh = mw * h / w
    mx, my = (64 - mw) / 2, (64 - mh) / 2
    if not background:
        plate = ""
    elif shape == "circle":
        plate = f'<circle cx="32" cy="32" r="32" fill="{TILE}"/>'
    else:
        plate = f'<rect width="64" height="64" rx="14" fill="{TILE}"/>'
    return (
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" role="img" aria-label="WoTBTools">'
        f"{plate}"
        f'<svg x="{mx:.2f}" y="{my:.2f}" width="{mw:.2f}" height="{mh:.2f}" viewBox="{x} {y} {w} {h}">'
        f"{mark_svg(INK_ON_DARK, ACCENT)}</svg></svg>\n"
    )


def find_chrome() -> str:
    candidates = [
        os.environ.get("CHROME_PATH", ""),
        r"C:\Program Files\Google\Chrome\Application\chrome.exe",
        r"C:\Program Files (x86)\Google\Chrome\Application\chrome.exe",
        "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
        shutil.which("google-chrome") or "",
        shutil.which("chromium") or "",
        shutil.which("chromium-browser") or "",
    ]
    for candidate in candidates:
        if candidate and Path(candidate).exists():
            return candidate
    sys.exit("未找到 Chrome / Chromium；设置 CHROME_PATH 后重试")


def rasterize(svg: str, width: int, height: int, out: Path, chrome: str) -> None:
    """无头 Chrome 透明背景截图：SVG 铺满整个视口。"""
    with tempfile.TemporaryDirectory() as tmp:
        page = Path(tmp) / "render.html"
        page.write_text(
            '<!doctype html><meta charset="utf-8"><style>html,body{margin:0;background:transparent}'
            "svg{display:block;width:100vw;height:100vh}</style>" + svg,
            encoding="utf-8",
        )
        shot = Path(tmp) / "shot.png"
        subprocess.run(
            [
                chrome, "--headless=new", "--disable-gpu", "--hide-scrollbars",
                "--force-device-scale-factor=1", "--default-background-color=00000000",
                f"--window-size={width},{height}", f"--screenshot={shot}", page.as_uri(),
            ],
            check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
        )
        out.parent.mkdir(parents=True, exist_ok=True)
        Image.open(shot).convert("RGBA").save(out)


def to_webp(png: Path, out: Path) -> None:
    Image.open(png).save(out, "WEBP", lossless=True)


def main() -> None:
    chrome = find_chrome()
    BRAND.mkdir(parents=True, exist_ok=True)

    # 1) 矢量原稿
    (BRAND / "wotbtools-mark.svg").write_text(standalone_mark(INK_ON_LIGHT, ACCENT), encoding="utf-8")
    (BRAND / "wotbtools-mark-on-dark.svg").write_text(standalone_mark(INK_ON_DARK, ACCENT), encoding="utf-8")
    icon_svg = app_icon()
    (BRAND / "wotbtools-app-icon.svg").write_text(icon_svg, encoding="utf-8")
    (KEYCLOAK_IMG / "login-favicon.svg").write_text(icon_svg, encoding="utf-8")

    # 2) Web：favicon / 应用图标 / 旧文件名兼容（Dockerfile 与 Keycloak 主题引用）
    rasterize(icon_svg, 256, 256, ASSETS / "icon.png", chrome)
    rasterize(icon_svg, 1024, 1024, ASSETS / "wotbtoolslogo.png", chrome)
    rasterize(icon_svg, 128, 128, BRAND / "_tmp-128.png", chrome)
    to_webp(BRAND / "_tmp-128.png", ASSETS / "wotbtoolslogo-128.webp")
    (BRAND / "_tmp-128.png").unlink()
    Image.open(ASSETS / "icon.png").save(ASSETS / "icon.ico", sizes=[(16, 16), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)])
    shutil.copyfile(ASSETS / "wotbtoolslogo.png", KEYCLOAK_IMG / "wotbtoolslogo.png")

    # 3) Android：传统方形 / 圆形启动图标 + 自适应图标前景（108dp 画布，图形落在 66dp 安全区内）
    densities = {"mdpi": 48, "hdpi": 72, "xhdpi": 96, "xxhdpi": 144, "xxxhdpi": 192}
    round_svg = app_icon(shape="circle", mark_width=0.74)
    for density, size in densities.items():
        folder = ANDROID_RES / f"mipmap-{density}"
        rasterize(icon_svg, size, size, folder / "ic_launcher.png", chrome)
        rasterize(round_svg, size, size, folder / "ic_launcher_round.png", chrome)
    foreground = app_icon(mark_width=0.56, background=False)
    rasterize(foreground, 432, 432, ANDROID_RES / "drawable" / "ic_launcher_foreground.png", chrome)
    shutil.copyfile(ANDROID_RES / "drawable" / "ic_launcher_foreground.png",
                    ANDROID_RES / "mipmap-xxxhdpi" / "ic_launcher_foreground.png")

    print("brand assets generated")


if __name__ == "__main__":
    main()
