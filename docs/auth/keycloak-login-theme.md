# Keycloak 登录主题（V8 Unified Theme）

> Keycloak 26.6.4 自定义登录/认证主题，V8 Unified Layout。仅 UI/主题改造：不影响 OIDC flow、client 配置、角色/映射、IdP 与 region 逻辑。

## 主题结构

```
docker/keycloak/themes/wotbtools/login/
├── theme.properties          # parent=keycloak；styles=本主题 css；scripts=theme.js；kc* → wbtb-* 类
├── template.ftl              # 唯一 FTL 覆盖：注册于 Keycloak `registrationLayout` 宏的共享 Shell
├── background-rotation.ftl   # 背景轮换配置 + 选片（服务端；template.ftl 在 <head> 内 include）
├── login.ftl                 # 4.0 覆盖：Wargaming 三服主按钮 + QQ 次按钮在上；用户名密码收进「运维登录」<details>
├── messages/{en,zh,ru}.properties   # 主题文案 wbtb*（hero / chips / footer / theme toggle）+ identity-provider-login-label；zh 另含完整 Keycloak 简体中文副本
└── resources/
    ├── css/{tokens,auth-shell,prism,components,responsive}.css
    ├── js/theme.js           # theme toggle + localStorage["wotbtools-theme"] 持久化 + 防闪烁
    └── img/<背景>.webp（横版 <500KB）+ <背景>-mobile.webp（900×1600 竖版 <300KB）× N / login-favicon.svg / wotbtoolslogo.png(256px/37KB 优化版，白底不透明)
```

## 设计要点

- 深色 = 全屏背景图，按天轮换（见「背景轮换」）；浅色 = Minimal：无背景图。
- 登录卡 = **dark 局部毛玻璃 / light 透明 prism**：深色 `background: rgba(8,12,16,0.34)` + `backdrop-filter: blur(10px) saturate(120%)`，仅作用于 `html[data-theme="dark"] .wbtb-card`（token `--auth-card-bg/border/shadow/blur`），保留极弱 amber 高光；浅色 `rgba(255,255,255,0.72)`、`--auth-card-blur: none`。回归守卫：`backdrop-filter` 只允许出现在 dark `.wbtb-card` 作用域。
- 登录卡（4.0，`login.ftl` 基于 26.6.4 base 改写，字段名 / action / credentialId / passkeys 条件 UI 不变）：普通用户只用 Wargaming 与 QQ 登录。`social.providers` 按 alias 归类——`wargaming-asia/eu/na` 是主按钮（文案 `wbtbIdp_*`：亚服 / 欧服 / 北美服），其余（`idp-qq` 及以后新增的 IdP）在「或」之后作次按钮，不会因归类缺失而消失。用户名密码是运维后门：默认收在卡片底部低对比的「运维登录」`<details>`（无 JS 可用），登录失败或带回用户名时默认展开；无「记住我」「忘记密码」。无 Self Registration（realm 关闭）。卡片 kicker 显示当前季节（`wbtbSeason_*`）。
- 品牌：topbar 复用主站官方 Logo（`resources/img/wotbtoolslogo.png`，256px/37KB 优化版）。白底来自图片本身且仓库无透明源，**不裁切、不拉伸、不换源**，仅以固定显示高度收敛视觉面积——desktop 36px、mobile(≤767)/tablet-portrait 28px；brand 无额外背景/padding。
- 主题切换：右上 pill 内用 CSS 绘制 Sun（圆+8 射线）与 Moon（月牙）双图标，双图标常显、当前主题态高亮另一态置灰；aria-label/title/data-label-* 取自 `msg("wbtbThemeToggleTo{Light,Dark}")`，切换后 JS 同步指向「下一目标主题」；dark/light 两主题均有 `:focus-visible`；mobile(≤767) 点击区域经 `::after` 扩至 ≥40px（视觉保持 44×26）。
- Locale：顶栏右侧「中文 | EN」两段切换（`locale.supported[].url`，只列 `zh` / `en`）；realm locale 仍为 `zh` / `en` / `ru`（默认 `zh`），`ru` 不进切换器但 `ui_locales=ru` 照常生效（从 realm 去掉 ru 需要 tofu apply，不在主题范围）。站点浏览器端发起登录时经 keycloak-js `login({ locale })` 带当前站点语言作为 OIDC `ui_locales`；Android App 的原生登录经 `authLogin {locale}` 把同一语言交给 Native，由 AppAuth `setUiLocales` 带上（Native 只接受 `zh` / `en` / `ru`，其它值不带）。`ui_locales` 在生产授权端点的实际效果未在线验证。主题自创文案（hero、chips、footer、theme toggle）全部走 `msg("wbtb*")`，三份 messages 文件 key 集合一致。
- 简体中文：Keycloak 26.6.4 内置简体中文 bundle 名为 `messages_zh_Hans`，与 realm locale `zh` 不匹配，缺 key 会整页回退英文；因此 `messages_zh.properties` 是该 bundle 的完整副本（术语统一为「账号」「关联」等，见文件头），文件末尾是主题文案段。升级 Keycloak 时用新版本 `theme/base/login/messages/messages_zh_Hans.properties` 重新生成。
- Dark readability：深色登录卡自带局部毛玻璃承载面；`.wbtb-shell__auth::before` 软径向 dark veil 保留但强度下调（中心 0.12 / 边缘 0.05，避免与毛玻璃双重黑化，无硬矩形/左右分区）+ 提升 input/eye/IdP/divider 对比（dark-only），light 零回归。
- 三端破点：Phone ≤767 / Tablet 768–1179 / Tablet-portrait / Desktop ≥1180；Mobile 隐藏大 Hero、auth first；长页可滚动（`min-height:100dvh`）。
- 主题初始化：`template.ftl` head 内联脚本读 `localStorage["wotbtools-theme"]` 设 `data-theme`（防闪烁）。


## 背景（四季主视觉）

选片在 Keycloak 渲染时由 `background-rotation.ftl` 完成（服务端，无 JS）。登录页与站点不同源，读不到用户在站点选的主题，所以按 **UTC 日历月份** 选季节：3–5 月春、6–8 月夏、9–11 月秋、12–2 月冬；图与站点四季主题同源（`frontend/src/assets/theme/theme-<季节>-{wide,portrait}.webp` → `resources/img/login-season-<季节>{,-mobile}.webp`）。结果写成 `:root` 自定义属性（`--auth-bg-desktop` / `--auth-bg-desktop-pos` / `--auth-bg-mobile` / `--auth-bg-mobile-pos`），并设置 `wbtbSeason` 给卡片 kicker；`auth-shell.css` 保留夏季图兜底。`template.ftl` 用 `<#attempt>/<#recover>` 隔离该模板失败，此时用 CSS 兜底背景、kicker 回落夏季。

档期图（可选）：在 `scheduled` 里加带 `from` / `to`（`yyyyMMdd` 整数，含首尾）的条目；今天落在窗口内时只在档期图里按 UTC 天轮换，季节图让位，窗口外完全不参与。FreeMarker 的 `<` / `>` 只支持数字，日期必须写整数。

本地无 Keycloak 时可用 FreeMarker 2.3.34 离线渲染 `login.ftl`（数据模型按 Keycloak 字段打桩）核对结构；最终以容器内实际渲染为准。

## 生产部署注意

生产/TX realm 由 TX-local OpenTofu 管理（非 `--import-realm`）。主题仍由镜像发布；上线需通过 OpenTofu 同步：

1. Keycloak realm → Login → **Registration = Off**（对应 `registrationAllowed:false`）。
2. Realm → **Login theme = `wotbtools`**（对应 `loginTheme:"wotbtools"`）。
3. 其余（IdP、region、client、mapper、roles）由 `infra/tofu/keycloak` 声明，禁止改回手工或 realm JSON 导入。

## 验证

- 镜像构建：`docker build -f docker/Dockerfile.keycloak -t wotbtools-keycloak:local .`。
- 背景：把主题目录挂进 Keycloak 容器（`-v <themes>/wotbtools:/opt/keycloak/themes/wotbtools:ro`，`start-dev --spi-theme-default=wotbtools --spi-theme-cache-themes=false`），请求 login 页后检查注入的 `<style id="wbtb-bg-rotation" data-bg-id="…">`，并在浏览器里核对 `.wbtb-shell__bg` 的 computed `background-image`（桌面/手机各一次）。临时在 `scheduled` 加一个覆盖今天的档期条目即可验证档期逻辑，验完删掉。
- 视觉清单：dark/light × desktop(≥1180)/tablet-portrait/mobile(≤767)——brand 尺寸、toggle 双图标与焦点环、卡片毛玻璃可读性、无左右分区。
- CSS 守卫：`rg -n "backdrop-filter" resources/css` 应只命中 `prism.css` 的 `html[data-theme="dark"] .wbtb-card`。
- 主题随 `docker/keycloak/themes/**` 变化由 `.github/workflows/keycloak.yml` 路径检测覆盖，触发 keycloak 镜像重建。
