# Current Development Plan

> 本地开发计划载体（gitignore，不入库）。由 `grill-me` / `plan-designer` 写入，`review-with-docs` 同步；任务完成后清理回初始状态。

## WotBTools 中国大陆 ICP 备案展示

### 分步计划

| 步骤 | 状态 | 内容 |
|---|---|---|
| 1 | 完成 | 核对 App/Layout/Router 与现有 Footer，确认公共挂载点 |
| 2 | 完成 | 复用现有 Footer 并在 AppShell 公共壳中追加 ICP 外链，移除首页重复挂载 |
| 3 | 完成 | 补充 focused regression、响应式/主题样式与变更文档 |
| 4 | 完成 | 执行 review-with-docs，完成验收与交接 |

### 影响面清单

- `frontend/src/app/AppShell.vue`：所有 Vue 主要路由的公共 Footer 挂载点。
- `frontend/src/components/HomePage.vue`：移除被提升为公共 Footer 的首页重复挂载与局部样式。
- `frontend/homepage/sponsor.html`：扩展独立赞助页面已有 Footer，覆盖 AppShell 之外的主要页面。
- `frontend/src/styles/app-shell.css`：Footer 的主题与响应式样式。
- `frontend/src/App.test.js`：验证 Footer、ICP 文案、外链属性及各主要路由共享挂载。
- `frontend/src/locales/{zh,en,ru}.json`：三语同值 legal identifier。
- `frontend/src/data/versions.json`：同步用户可见的版本历史条目。
- `docs/CHANGELOG.md`、`docs/CHANGELOG-PRODUCT.md`：记录用户可见变更。

### 非目标

- 不新增第二套 Footer。
- 不添加公安联网备案号。
- 不改变 Footer 原有业务文案、路由、认证或页面业务内容。

### 验收标准

- 公共 Footer 在首页、Replay、名人堂及 Android 下载等 AppShell 路由中各只出现一次；独立赞助页复用其现有静态 Footer。
- ICP 文案为 `闽ICP备2026036303号-1`，链接为 `https://beian.miit.gov.cn/`，并带 `target="_blank"` 与 `rel="noopener noreferrer"`。
- Footer 使用次级文字样式，桌面/手机可见，深色/浅色主题使用可读 token，且不使用 fixed/absolute 遮挡页面内容。
- focused frontend regression 与 `git diff --check` 通过。

### 待确认项

- 无阻塞项；用户已明确授权按上述要求执行。
