# 本机测试 runbook（全功能联调 · 自动化门禁 · 故障对照）

在本机把 WotbTools 跑成"可测状态"的完整手册：Agent 引擎产物、资产面、认证门禁与可选管理旁路、
自检探针、常见故障、自动化门禁。改动前端/场景/回放前先按 §0 起环境，交付前跑 §8 的相关门禁。

相关文档：[`local-production-dev.md`](local-production-dev.md)（连接生产后端与 Keycloak 链路）、
[`../../frontend/AGENTS.md`](../../frontend/AGENTS.md)（前端硬规则）、
[`../../.agents/AGENTS.md`](../../.agents/AGENTS.md)（仓库级规则，含 §视觉验证归属）。

## 0. TL;DR（最短路径）

```bash
# ① Agent 仓（WoT-Blitz-Agent）【根目录】：伺服资产包（127.0.0.1:8123，带 CORS），测试期间保持运行
node scripts/serve_asset_pack.mjs 8123

# ② 本仓：拉取 deploy/agent/source.json 锁定的 Agent 引擎（pin 变更后必须重跑）
bash scripts/fetch-agent-wasm.sh

# ③ 本仓 frontend/.env.local（一次性，gitignored）
# VITE_ASSET_BASE_URL=http://127.0.0.1:8123

# ④ 本仓 frontend：起 dev server（/api → 本机 8087）
npm run dev
```

浏览器打开 `http://localhost:5173/`（可加 `?view=agent-replay` / `agent-shots` / `agent-armor`）。五种回放能力始终可见；3D / shots / armor / AI 用普通账号登录，无需 `?admin=1`。

## 1. 系统构成（先理解数据从哪来）

| 组件 | 来源 | 说明 |
|---|---|---|
| 回放解析 | **本机** WASM（Worker 优先） | 文件不出本机 |
| Agent 引擎 | `common/assets/wasm/<ref>/`（gitignored） | `<ref>` = `deploy/agent/source.json` 的 `.ref`；dev 下由 `vite.config.js` 的 `local-dev-public-wasm-as-module` 中间件按 `/wasm/<ref>/…` 伺服 |
| 地图 / 车模 / 坦克数据 / 封面 | **Agent 仓** `release/asset_pack/`（gitignored，约 2.8GB） | 本机静态服务 8123 提供；前端经 `assetProvider` + `VITE_ASSET_BASE_URL` 取 |
| admin 视图可见性 | dev-gated 旁路（**已入库**） | `?admin=1`（dev 构建把 admin 角色视为已持有），见 §4 |
| 后端 API / 登录 | 生产（或本机 8087 后端） | 按真实 Keycloak realm 角色鉴权，旁路绕不过，见 §5 |

## 2. 一次性准备

1. **Node 24 + `npm ci`**（frontend 目录，`.nvmrc` 为准）。
2. **引擎产物**：本仓根目录执行 `bash scripts/fetch-agent-wasm.sh`
   （2026-10-03 时 pin = v0.3.11 / `73ea422a…`；以 `source.json` 现值准）。
   - 脚本从上游 Release 直取 ZIP，sha256 + fingerprint 双重校验后落位 `common/assets/wasm/<ref>/`。
   - **何时重跑**：`deploy/agent/source.json` 变化（上游 pin bump）后必须重跑。不重跑的症状：
     dev 下 `/wasm/<ref>/…` 404 → 3D 回放 / 射击复现 / 装甲查看器"引擎加载失败"，其余功能正常。
   - 旧 ref 目录可留可删，互不干扰。
3. **资产包**（Agent 仓）：确认 `release/asset_pack/` 存在（根部有 `index.json` / `manifest.json`）。
   缺了用 `python scripts/export_asset_pack.py --map-index map_index.json` 生成（需游戏客户端产出 map index）。
4. **`frontend/.env.local`**（本仓，`.env.*` 已 gitignore）：

   ```
   VITE_ASSET_BASE_URL=http://127.0.0.1:8123
   ```

   改后必须**重启 dev server**（`import.meta.env.*` 在 transform 时内联，非运行时读取）。
5. 仅调试真正管理入口时按 §4 带 `?admin=1`；回放能力不需要它。

## 3. 每次测试的启动

1. Agent 仓**根目录**起资产服务：

   ```bash
   node scripts/serve_asset_pack.mjs 8123
   # 用法：node scripts/serve_asset_pack.mjs [port] [packDir]
   ```

   脚本把 `release/asset_pack` 按 **cwd** 解析：在别的目录启动会静默 404（资产全丢但服务"正常"）。
2. 本仓 frontend：

   | 命令 | `/api` 指向 | 用途 |
   |---|---|---|
   | `npm run dev` | 本机 `http://localhost:8087` | 本地后端开发 |
   | `npm run dev:production-remote` | 生产站点 | 生产数据/真实登录；Topbar 有非模态提示；只用获批账号与数据 |

3. URL 参数（模块加载时读取，**每次都要带在 URL 上**；建议存书签）：

   | 参数 | 作用 |
   |---|---|
   | `?admin=1` | dev-only 旁路（已入库）：把 `wotbtools-admin` / `HoF-admin` 视为已持有（仅前端可见性；生产构建忽略）。**约定写法**——实际触发条件是 dev 构建下 URL 存在 `admin` 参数，value 当前不参与判定 |
   | `?view=<name>` | 直达视图（如 `agent-armor`、`agent-replay`） |
   | `?assets=<URL>` | 覆盖资产面；**非空值会持久化到 localStorage 并盖住 `.env.local`**；回默认要带一次空 `?assets=` |
   | `?debug` | 场景调试探针（见 §6） |

4. Keycloak：`http://localhost:5173/*` 必须在生产 client `wotbtools-web` 的 Redirect URIs 里，
   否则登录回跳失败。

## 4. 本机 admin 旁路（dev-gated，已入库）

**背景**：本地账号通常没有 `wotbtools-admin` / `HoF-admin` realm 角色，真正管理功能的入口与操作
会被角色边界挡下。dev 构建下 URL **存在 `admin` query 参数**即把这两个角色视为已持有（约定写法
`?admin=1`；当前实现只判断参数存在，`?admin=0` / `?admin=` / `?admin` 同样生效，value 不参与判定）
——这是 `frontend/src/composables/useAuth.js` 里**已入库**的 dev-gated 实现（`DEV_ADMIN_ROLES`），
不是本机补丁，也不是可回退的临时改动。

管理功能**只认角色**，URL 不得成为权限来源。Agent 深链不再有 admin route gate：匿名保留目标并显示 Login Gate，普通登录用户可用 3D / shots / armor。`?admin=1` 不提供登录态，也不能绕过这些认证门禁；`tournament-admin` 不在覆盖之列（`tournamentAdminAllowed` 只认真实 token claims）。

- 生效条件：`import.meta.env.DEV` 且 URL 存在 `admin` 参数（实现为 `.has('admin')`，value 不参与
  判定；模块加载时读取，不持久化，每次都要带）；生产构建该表达式在 build 期折叠为恒 false、参数
  被整段消除（无产品行为变化）；vitest 环境无 query（jsdom 默认 URL）同样 false，既有门禁断言不受影响。
- 覆盖范围：仅 `hasRole()` 的 `wotbtools-admin` / `HoF-admin` 两个角色——侧边栏 / 更多菜单的管理
  入口因此可见（`isHofAdmin` 含 `isAdmin` 继承）。
- 只改**前端可见性**：后端仍按真实 token 鉴权，越权调用照样 401/403（见 §5）。

## 5. 能力分层：本地能全用什么，什么要真角色

**普通登录用户即可使用**（数据链全在本机，无需 admin role）：3D 回放、射击分析 / 复现。**装甲查看器匿名可用**（Tankopedia 详情入口卡对全员开放，深链不设登录门）。匿名可用数据、2D 与装甲查看器，并可看到全部五个 tab；匿名进入受限能力不会加载实际 pane、解析或资产。

**需要真实 realm 角色**（前端旁路只解决可见性，后端按 token 鉴权）：

| 功能 | 端点 | 需要的 realm 角色 |
|---|---|---|
| 用户管理 | `/api/admin/users/**` | `wotbtools-admin` |
| 名人堂管理 | `/api/admin/hof/**` | `HoF-admin` 或 `wotbtools-admin` |
| AI 复盘 | `/api/ai/**` | `wotbtools-user` 或 `wotbtools-admin` |

角色只能在 **Keycloak Admin Console** 授予（本仓只 provision realm JSON，没有授予 UI）。前端
Keycloak 配置是硬编码的生产（`auth.wotbtools.com` / realm `wotbtools` / client `wotbtools-web`，
见 `src/platform/browserAuthProvider.js`），本机没有"本地 realm"开关。

## 6. 自检探针（不看画面）

- **资产面**：`curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:8123/index.json` → `200`。
- **引擎**（dev server 在跑）：

  ```bash
  REF=$(python3 -c "import json;print(json.load(open('deploy/agent/source.json'))['ref'])")
  curl -s -o /dev/null -w '%{http_code}\n' "http://localhost:5173/wasm/$REF/wotb_replay_wasm.js"   # 期望 200（带 ?import 也应 200）
  ```

- **场景**（浏览器控制台，`?debug`）：
  - `window.__gdbg.layers === true` —— 分层地表就绪；
  - `window.__pbV.filter(v => v.glb).length` 等于车辆数 —— 车模 GLB 全部挂上。

## 7. 故障对照

| 症状 | 原因 | 处置 |
|---|---|---|
| 回放能播，但地图/建筑/车模全没；控制台「资产源未配置」 | 资产面没接上 | §2/§3：`.env.local` + **重启 dev server** + 8123 在跑 |
| 同上但错误是 404 | 8123 起在了错误目录（根按 cwd 解析） | 到 Agent 仓根目录重启 |
| 同上但 `.env.local` 明明是对的 | URL/localStorage 里残留非空 `?assets=` | 带一次空 `?assets=` 清除 |
| 3D 回放/射击/装甲查看器"引擎加载失败"，`/wasm/<ref>/…` 404 | `source.json` pin 与 `common/assets/wasm/` 不一致（bump 后没重跑） | `bash scripts/fetch-agent-wasm.sh` |
| dev 下 `/wasm/*.js?import` 500 | Vite 拦截 publicDir 里的 .js（回归） | 检查 `vite.config.js` 的 `local-dev-public-wasm-as-module` 中间件 |
| 直连 `?view=agent-armor` 显示登录提示 | 当前未登录 | 普通账号登录；返回保留原场景 query |
| admin 页面能打开但数据 401/403 | 后端按真实 token 鉴权 | §5（需要真角色；本地绕不过，也不应绕） |

## 8. 自动化测试与门禁

- 先跑与改动直接相关的：`npx vitest run <related-test-files>`；多文件 feature 再跑对应 suite；
  全量 `npm test`。不因小改动重复跑全量测试或 build。
- 浏览器门禁（真实 Chrome；**完整清单以 [`../../frontend/AGENTS.md`](../../frontend/AGENTS.md)
  §Testing rules 为权威**，新增 gate 随其特性一起落地；改对应代码时保持通过）：
  - `npm run test:browser-layout` —— Playback 布局（PC / tablet / mobile 实际 CSS geometry 与 form isolation）；
  - `npm run test:browser-interaction` —— 交互（hit target、pointer-events、capability 切换、认证门禁、播放控件）。
  - `npm run test:browser-armor-aiming` —— 瞄准 / 指针交互；部位取样同时检查几何分类与
    `elementFromPoint` 实际命中 canvas，避免选车按钮等面板遮挡导致手势误入弹窗。
    既有像素扫描单测覆盖按钮 / 弹窗遮挡及空命中，浏览器门禁用临时覆盖控件验证重新取样。
  - agent 运行环境起不了 Chrome 时：明确说明并交给 PR CI（本机起不来 ≠ 改动有问题）。
- 交互夹具的 Vite 依赖缓存隔离在 `node_modules/.vite-browser-interaction`，避免带 stub 的模块图使正在运行的开发页报 `504 Outdated Optimize Dep`。额外本地 smoke 也应使用独立 `cacheDir`；遇到旧缓存失效，停掉冲突实例并用 `npm run dev -- --force` 重启开发服务。
- 无 GPU 的隔离 Chrome 夹具显式使用 SwiftShader 软件 WebGL。`browser-chrome.mjs` 的 `--enable-unsafe-swiftshader` 只用于受控本地测试页面，不改产品设置，也不能用来代替真实 3D 视觉验收。缺 WebGL 导致 fixture 无法建场时，先区分运行环境失败与布局断言失败。
- 其余按需：`npm run typecheck`、`npm run build`、`npm run verify:agent-wasm`（build 后核对
  `/wasm/<ref>/` 与 pin 一致）、`npm run lint:css`。

### 单发击穿判定的加载回归

`cd frontend && npm run test:browser-armor-shot-readiness`：复用浏览器门禁的应用/资产夹具，
验证弹药延迟时保持加载、不执行零穿深判定；弹药返回后按本发弹种自动完成首次判定；
初始化期间选车入口禁用且显示说明，就绪后恢复；离开页面后的迟到响应不覆盖新查看器；
弹药数据无效时显示“弹药数据”阶段错误，重试可恢复；目标加载失败的重试复用已就绪弹药，
恢复同一射手模型时也复用车辆 JSON，避免重复请求。
同时覆盖普通检视的配置弹表来源、深链选弹与无效下标回退、手动换配置，以及同车型
单发复现的射手 `scfg` 弹表与回放选弹隔离。
这条门禁已加入 `ci-frontend.yml` 的 `browser-gates` 矩阵，随前端 PR 自动执行。
这条门禁负责异步初始化与销毁，独立于瞄准手势和移动端布局门禁，不做 3D 画面验收。
macOS 可指定 `CHROME_BIN='/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'`。

单发检查的执行顺序是：射手弹药就绪 → 目标模型与配置就绪 → 恢复本发姿态和弹道、选弹
→ 更新世界矩阵 → 击穿判定。网络耗时不会被固定等待时间替代。缺失弹药不应显示为穿深 0
或模拟结果 `-`；加载失败可重试。此顺序修复不改变穿深公式，也不保证本地模拟与服务器结果
逐发一致；二者仍受回放数据精度和模拟模型差异影响。

**普通装甲检视的首次判定输入有意改变**：无 `shot` 且射手与目标同车型时，首次加载
即采用展示配置 `configs[config].shells`（未指定 `config` 时取当前默认配置），包含真实
`normalization` / `ricochet`。此前首次加载取顶层 `shells`，缺失字段时使用转正角 0°、
跳弹角 70° 等默认值。公式没有变化，但输入补全会改变部分热力图颜色和点击判定结果。

`shell` 保留为从 0 开始的弹表下标：上述普通检视对应展示配置弹表，两个模型与配置完成后
恢复 URL 选弹；越界、负数、无效下标回退第一项。用户手动切换配置时仍重置到新配置第一项，
不会再次套用 URL。单发复现则对应射手 `scfg` 弹表，回放 `shell_id` 的自动匹配优先；
即使射手与目标同车型，也不允许目标 `config` 覆盖射手弹表。

当前弹药缺失/无效仍采用页面级失败策略，普通装甲查看入口也同样处理，可通过重试恢复；
暂未提供仅保留模型、禁用弹药相关功能的降级模式。初始化先加载弹药再加载目标模型，
慢网络下首次模型显示会承担两阶段串行耗时，以保证首次判定只使用就绪数据。

## 9. 边界（必读）

- **视觉验收归用户**：agent 不驱动浏览器看 3D 画面、不以截图作验收证据；本 runbook 的探针都是
  协议/控制台级。见 [`../../.agents/AGENTS.md`](../../.agents/AGENTS.md) §视觉验证归属。
- **不提交**：`common/assets/wasm/`、Agent 仓 `release/asset_pack/`。
- **生产远端模式**（`dev:production-remote`）只使用明确获准的账号与数据，不上传测试或敏感数据。
