# WotBTools Showcase Assets

本目录保存展示用视觉素材，不参与业务事实、地图坐标、车辆型号、战绩或 AI 证据判断。

## 当前使用范围

2026-10-08 的页面现代化实验已移除全屏装饰背景层。页面、表格与表单使用语义纯色表面；插图由实际组件拥有，不再通过全局 CSS 给每页强制铺图。

| 资产 | 当前用途 |
|---|---|
| `home/card-replay-parser-v1.webp` | 首页回放解析入口插图 |
| `home/card-ai-review-v1.webp` | 首页 AI 复盘入口插图 |
| `home/card-battle-playback-v1.webp` | 首页战局回放入口插图 |
| `home/card-hall-of-fame-v1.webp` | 首页名人堂入口插图 |
| `home/card-sponsor-v1.webp` | 首页赞助入口插图 |
| `home/hero-v4.webp`，其余各页 `*-v1.webp` / SVG | 保留的历史设计素材，当前 SPA 不通过全局背景样式加载 |
| `../../../public/sponsor-bg.webp` | `SponsorPage.vue` 自己引用的赞助页背景，用户提供，仅用于视觉氛围 |

首页图片由 `HomePage.vue` 显式导入，卡片使用独立图片区域，文字与操作不烘焙进图片。`showcase-backgrounds.css` 与 `showcase-backgrounds-v3.css` 已删除，应用及浏览器夹具均不再导入；`showcase-cohesion.css` 仍保留未迁移 HoF 的部分局部样式，不负责资产加载。

## 替换约定

1. 素材不能替代真实 UI、按钮、数据或交互状态；装饰性 Logo / 徽标须有合法来源。
2. 只替换目标素材；保持原路径则无需改变引用。变更文件格式或名称时，更新实际组件 import，检查引用及构建。
3. 优先提供尺寸合适的 WebP / AVIF；确认实际产物与网络加载体积，不使用历史 PNG 体积推测当前页面负载。
4. 检查 Desktop、Tablet、Mobile 的裁切及图片区域比例，并在 Classic / Showcase 下检查文字、焦点和操作的可读性。
5. 历史素材仍留作设计参考，不表示当前产品启用这些背景。新增使用遵循 `docs/frontend/design-language.md` 的装饰插槽规则。
