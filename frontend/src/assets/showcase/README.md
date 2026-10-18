# WotBTools Showcase Assets

本目录保存展示用视觉素材，不参与业务事实、地图坐标、车辆型号、战绩或 AI 证据判断。

## 当前使用范围

2026-10-08 的页面现代化实验已移除全屏装饰背景层。页面、表格与表单使用语义纯色表面；插图由实际组件拥有，不再通过全局 CSS 给每页强制铺图。

| 资产 | 当前用途 |
|---|---|
| `home/hero-v4.webp`（1920×768，108 KB） | 首页 Hero 装饰插槽（`design-language.md` §2）。`HomePage.vue` import 后经内联 `--home-hero-image` 传给 CSS；插槽开关是 `--home-hero-decor`，Classic Profile 与 `width < 768px` 两种情况下置 `none` |
| `home/showcase-playback-3d-v1.webp`（1600×798，177 KB） | 首页能力展示①：3D 战局回放 |
| `home/showcase-armor-v1.webp`（1600×1043，192 KB） | 首页能力展示②：装甲查看器（112 Glacial 实体渲染） |
| `home/showcase-rating-v1.webp`（1600×696，50 KB） | 首页能力展示③：回放解析结果与 League Rating |
| `home/showcase-tankopedia-v1.webp`（1600×1165，94 KB） | 首页能力展示④：坦克百科列表 |
| `home/card-*.webp`（5 张） | 2026-10-18 首页改为纯展示页后全部不再被引用，保留作设计参考 |
| 其余各页 `*-v1.webp` / SVG | 保留的历史设计素材，当前 SPA 不通过全局背景样式加载 |
| `../../../public/sponsor-bg.webp` | `SponsorPage.vue` 自己引用的赞助页背景，用户提供，仅用于视觉氛围 |

**`showcase-*` 四张是真实产品截图，不是插画**（2026-10-18 拍摄）。来源与再拍方式：

- 拍摄源是**生产站** `wotbtools.com`，真实资产面与真实渲染；1600×1000 CSS 视口、`deviceScaleFactor 2`，裁掉侧边栏（源图 x<480）与滚动条（x>3169）后缩到 1600px 宽。
- **回放类一律使用产品自带的匿名官方示例回放**（`championship-maus-example.wotbreplay`，「打开示例回放」）。不得把名人堂等真实玩家数据拍成静态图提交——真实昵称冻进仓库二进制与页面上实时展示是两回事；首页的实时数字走 `/api/hof`，不走截图。
- 产品 UI 一改截图就过时。替换时重拍而不是 PS，并同步更新本表的拍摄日期与尺寸。

首页图片一律由 `HomePage.vue` 显式 import（含 Hero 装饰图）。Hero 装饰图是背景插槽而非内容图片，落在 `aria-hidden` 的空容器上，不承担任何信息；能力展示的四张同样 `aria-hidden`，说明文字在图外的 DOM 里，不烘焙进像素。`showcase-backgrounds.css` 与 `showcase-backgrounds-v3.css` 已删除，应用及浏览器夹具均不再导入；`showcase-cohesion.css` 仍保留未迁移 HoF 的部分局部样式，不负责资产加载。

## 替换约定

1. 素材不能替代真实 UI、按钮、数据或交互状态；装饰性 Logo / 徽标须有合法来源。
2. 只替换目标素材；保持原路径则无需改变引用。变更文件格式或名称时，更新实际组件 import，检查引用及构建。
3. 优先提供尺寸合适的 WebP / AVIF；确认实际产物与网络加载体积，不使用历史 PNG 体积推测当前页面负载。
4. 检查 Desktop、Tablet、Mobile 的裁切及图片区域比例，并在 Classic / Showcase 下检查文字、焦点和操作的可读性。
5. 历史素材仍留作设计参考，不表示当前产品启用这些背景。新增使用遵循 `docs/frontend/design-language.md` 的装饰插槽规则。
