# Keycloak 登录主题（V8 Unified Theme）

> Keycloak 26.6.4 自定义登录/认证主题，V8 Unified Layout。仅 UI/主题改造：不影响 OIDC flow、client 配置、角色/映射、IdP 与 region 逻辑。

## 主题结构

```
docker/keycloak/themes/wotbtools/login/
├── theme.properties          # parent=keycloak；styles=本主题 css；scripts=theme.js；kc* → wbtb-* 类
├── template.ftl              # 唯一 FTL 覆盖：注册于 Keycloak `registrationLayout` 宏的共享 Shell
├── login.ftl                 # （未覆盖，用 base）：username/password/forgot/sign in + IdP grid
├── messages/{en,zh,ru}.properties   # 覆盖 identity-provider-login-label / wbtbThemeToggle*
└── resources/
    ├── css/{tokens,auth-shell,prism,components,responsive}.css
    ├── js/theme.js           # theme toggle + localStorage["wotbtools-theme"] 持久化 + 防闪烁
    └── img/login-battlefield.webp(1920×1080 <500KB) / -mobile.webp(900×1600 <300KB) / login-favicon.svg
```

## 设计要点

- 深色 = Battlefield：全屏战火背景（`login-battlefield.webp`，src `frontend/src/assets/showcase/home/hero-v4.png` 转码）；浅色 = Minimal：无背景图。
- 登录卡 = **clear transparent prism，无 blur**：`background: rgba(5,8,12,0.05~0.12)`（token `--auth-prism-alpha`），允许极弱 amber edge highlight / subtle shadow；**CSS 无 `backdrop-filter` / `filter: blur`**（回归守卫）。
- IdP 按 Keycloak `social.providers` 动态渲染，位于账号密码下方；无 Self Registration（realm 关闭）；无 `More sign-in options`。
- 三端破点：Phone ≤767 / Tablet 768–1179 / Tablet-portrait / Desktop ≥1180；Mobile 隐藏大 Hero、auth first；长页可滚动（`min-height:100dvh`）。
- 主题初始化：`template.ftl` head 内联脚本读 `localStorage["wotbtools-theme"]` 设 `data-theme`（防闪烁）。

## 生产部署注意

生产 realm 在 Admin Console 手工配置（非 `--import-realm`），因此 **realm JSON 改动只作用于导入/CI**。上线需人工同步：

1. Keycloak realm → Login → **Registration = Off**（对应 `registrationAllowed:false`）。
2. Realm → **Login theme = `wotbtools`**（对应 `loginTheme:"wotbtools"`）。
3. 其余（IdP、region、client、mapper、roles）不动。

## 验证

- 镜像构建：`docker build -f docker/Dockerfile.keycloak -t wotbtools-keycloak:local .`。
- 主题随 `docker/keycloak/themes/**` 变化被 `deploy.yml` 路径检测覆盖，触发 keycloak 镜像重建。
