# Keycloak 登录主题（V8 Unified Theme）

> Keycloak 26.6.4 自定义登录/认证主题，V8 Unified Layout。仅 UI/主题改造：不影响 OIDC flow、client 配置、角色/映射、IdP 与 region 逻辑。

## 主题结构

```
docker/keycloak/themes/wotbtools/login/
├── theme.properties          # parent=keycloak；styles=本主题 css；scripts=theme.js；kc* → wbtb-* 类
├── template.ftl              # 唯一 FTL 覆盖：注册于 Keycloak `registrationLayout` 宏的共享 Shell
├── background-rotation.ftl   # 背景轮换配置 + 选片（服务端；template.ftl 在 <head> 内 include）
├── login.ftl                 # （未覆盖，用 base）：username/password/forgot/sign in + IdP grid
├── messages/{en,zh,ru}.properties   # 覆盖 identity-provider-login-label / wbtbThemeToggle*
└── resources/
    ├── css/{tokens,auth-shell,prism,components,responsive}.css
    ├── js/theme.js           # theme toggle + localStorage["wotbtools-theme"] 持久化 + 防闪烁
    └── img/<背景>.webp（横版 <500KB）+ <背景>-mobile.webp（900×1600 竖版 <300KB）× N / login-favicon.svg / wotbtoolslogo.png(256px/37KB 优化版，白底不透明)
```

## 设计要点

- 深色 = 全屏背景图，按天轮换（见「背景轮换」）；浅色 = Minimal：无背景图。
- 登录卡 = **dark 局部毛玻璃 / light 透明 prism**：深色 `background: rgba(8,12,16,0.34)` + `backdrop-filter: blur(10px) saturate(120%)`，仅作用于 `html[data-theme="dark"] .wbtb-card`（token `--auth-card-bg/border/shadow/blur`），保留极弱 amber 高光；浅色 `rgba(255,255,255,0.72)`、`--auth-card-blur: none`。回归守卫：`backdrop-filter` 只允许出现在 dark `.wbtb-card` 作用域。
- IdP 按 Keycloak `social.providers` 动态渲染，位于账号密码下方；无 Self Registration（realm 关闭）；无 `More sign-in options`。
- 品牌：topbar 复用主站官方 Logo（`resources/img/wotbtoolslogo.png`，256px/37KB 优化版）。白底来自图片本身且仓库无透明源，**不裁切、不拉伸、不换源**，仅以固定显示高度收敛视觉面积——desktop 36px、mobile(≤767)/tablet-portrait 28px；brand 无额外背景/padding。
- 主题切换：右上 pill 内用 CSS 绘制 Sun（圆+8 射线）与 Moon（月牙）双图标，双图标常显、当前主题态高亮另一态置灰；aria-label/title/data-label-* 中文硬编码，切换后 JS 同步指向「下一目标主题」；dark/light 两主题均有 `:focus-visible`；mobile(≤767) 点击区域经 `::after` 扩至 ≥40px（视觉保持 44×26）。
- Locale：登录页不提供语言选择器；主题自创文案（theme toggle aria/tooltip）中文硬编码；登录表单字段仍由 Keycloak 基础包按浏览器语言本地化。
- Dark readability：深色登录卡自带局部毛玻璃承载面；`.wbtb-shell__auth::before` 软径向 dark veil 保留但强度下调（中心 0.12 / 边缘 0.05，避免与毛玻璃双重黑化，无硬矩形/左右分区）+ 提升 input/eye/IdP/divider 对比（dark-only），light 零回归。
- 三端破点：Phone ≤767 / Tablet 768–1179 / Tablet-portrait / Desktop ≥1180；Mobile 隐藏大 Hero、auth first；长页可滚动（`min-height:100dvh`）。
- 主题初始化：`template.ftl` head 内联脚本读 `localStorage["wotbtools-theme"]` 设 `data-theme`（防闪烁）。


## 背景轮换

选片在 Keycloak 渲染时由 `background-rotation.ftl` 完成（服务端，无 JS）：没有首屏闪烁，也不受浏览器禁用脚本影响。结果写成 `:root` 自定义属性（`--auth-bg-desktop` / `--auth-bg-desktop-pos` / `--auth-bg-mobile` / `--auth-bg-mobile-pos`），`auth-shell.css` 用 `var(…, url('../img/login-battlefield.webp'))` 消费并保留硬编码兜底。`template.ftl` 使用 `<#attempt>/<#recover>` 隔离轮换模板失败，因此该文件缺失或渲染异常时认证入口仍继续渲染并使用 CSS 默认背景。

规则：

- **按天轮换**：日期与轮换 index 统一按 **UTC calendar day** 计算；同一个 UTC 日期所有访客看到同一张，UTC 零点切换下一张，不依赖访客本地时区或容器/JVM 默认时区。
- **档期窗口**：条目带 `from` / `to`（`yyyyMMdd` 整数，含首尾两天）即为档期图。今天落在任一窗口内 → 只在这些档期图里轮换，常规图全部让位；无窗口命中 → 回到常规池。赛事结束后无需回来删配置。
- FreeMarker 的 `<` / `>` 只支持数字与日期，不支持字符串，所以日期必须写成整数 `20260401`，不能写 `"2026-04-01"`。

加一张图：把 `<id>.webp`（横版 ≤500KB）与 `<id>-mobile.webp`（900×1600 竖版 ≤300KB）放进 `resources/img/`，然后在 `background-rotation.ftl` 的 `backgrounds` 里加一条。`desktopPos` / `mobilePos` 是 `background-position`，用来把画面主体让开登录卡（桌面卡片靠右、手机卡片在上半屏）。

当前 3 张：`battlefield`（src `frontend/src/assets/showcase/home/hero-v4.png`）、`wtc-overlook`、`summit-station`。后两张按 1672×941 原生分辨率转码，不上采样到 1920×1080——源就是 1672 宽，放大只增体积不增细节；竖版由横版按 9:16 裁切后缩放到 900×1600，因此比横版略软。
## 生产部署注意

生产 realm 在 Admin Console 手工配置（非 `--import-realm`），因此 **realm JSON 改动只作用于导入/CI**。上线需人工同步：

1. Keycloak realm → Login → **Registration = Off**（对应 `registrationAllowed:false`）。
2. Realm → **Login theme = `wotbtools`**（对应 `loginTheme:"wotbtools"`）。
3. 其余（IdP、region、client、mapper、roles）不动。

## 验证

- 镜像构建：`docker build -f docker/Dockerfile.keycloak -t wotbtools-keycloak:local .`。
- 背景轮换：把主题目录挂进 Keycloak 容器（`-v <themes>/wotbtools:/opt/keycloak/themes/wotbtools:ro`，`start-dev --spi-theme-default=wotbtools --spi-theme-cache-themes=false`），请求 login 页后检查注入的 `<style id="wbtb-bg-rotation" data-bg-id="…">`，并在浏览器里核对 `.wbtb-shell__bg` 的 computed `background-image`（桌面/手机各一次）。临时给某条目加一个覆盖今天的 `from`/`to` 窗口即可逐张验收，验完删掉。
- 视觉清单：dark/light × desktop(≥1180)/tablet-portrait/mobile(≤767)——brand 尺寸、toggle 双图标与焦点环、卡片毛玻璃可读性、无左右分区。
- CSS 守卫：`rg -n "backdrop-filter" resources/css` 应只命中 `prism.css` 的 `html[data-theme="dark"] .wbtb-card`。
- 主题随 `docker/keycloak/themes/**` 变化被 `deploy.yml` 路径检测覆盖，触发 keycloak 镜像重建。
