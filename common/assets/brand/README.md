# WoTBTools 品牌图形

构图沿用原 AI 位图 logo，矢量重绘：左向坦克（炮管 · 炮塔 · 车体）+ 车体前段的开口扳手负形（工具）+ 车尾三根增长柱（数据）。
车体随背景反相（浅底 `#313942` / 深底 `#e9ecea`），增长柱固定为设计语言琥珀 `#e0a02e`；应用图标底板 `#0d1117`（与 Android `ic_launcher_background` 一致）。

| 文件 | 用途 |
|---|---|
| `wotbtools-mark.svg` / `wotbtools-mark-on-dark.svg` | 无底板图形（浅底 / 深底） |
| `wotbtools-app-icon.svg` | 方形应用图标原稿（favicon、Keycloak、Android 都由它派生） |

**唯一几何来源**是 [`scripts/brand/generate_brand_assets.py`](../../../scripts/brand/generate_brand_assets.py)。改图形只改脚本里的路径，然后在仓库根目录运行：

```bash
python scripts/brand/generate_brand_assets.py
```

它会重新生成本目录的 SVG，以及 `common/assets/icon.{png,ico}`、`wotbtoolslogo.png`、`wotbtoolslogo-128.webp`、Keycloak 主题的 `login-favicon.svg` / `wotbtoolslogo.png`、Android 全部启动图标。
前端页面内的图形是内联组件 `frontend/src/components/BrandMark.vue`（跟随主题 token），路径需与脚本同步。
