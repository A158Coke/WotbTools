# 本地前端连接生产后端

本地可以只运行 Vue/Vite 前端，并通过 Vite 开发代理把相对 `/api` 请求转发到生产站点。这样可以使用本地未发布的前端代码验证生产后端和生产 Keycloak 登录链路。

## 本机资产面（3D 回放 / 车模 / 地图测试必读）

前端是 **client-only + remote 资产面**设计：回放解析在本机 WASM 完成，但地图地形、车模 GLB、
坦克 JSON/封面全部来自 `assetProvider` 配置的资产 origin。dev server 下没有构建期
`VITE_ASSET_BASE_URL` 时，`assetProvider` **显式抛错**而不静默降级：

```
资产源未配置：追加 ?assets=<remote-asset-base-url>（坦克数据/GLB/封面/地图资产均来自该 origin）
```

现象是「回放能播、标签与伤害数字都在，但地图/建筑/车模没了」——因为回放解析与场景内核的
数据部分不依赖资产，只有资产面缺失。**标准本机测试姿势（以后按这个来）**：

1. 在 **WoT-Blitz-Agent 仓**（资产包的生产者）启动本机资产服务：

   ```bash
   node scripts/serve_asset_pack.mjs 8123            # 默认伺服 release/asset_pack/，带 CORS
   ```

2. 在 **本仓** `frontend/.env.local`（gitignored）写一次即可：

   ```
   VITE_ASSET_BASE_URL=http://127.0.0.1:8123
   ```

3. `npm run dev`，打开 `http://localhost:5173/?view=agent-replay&agentViews=1`
   （`agent-replay` 等管理视图在 dev 下需要显式 `?agentViews=1` 才可达，见 `app/navigation.js`）。

优先级与坑：`?assets=<URL>` > `localStorage.wotb_asset_base` > `VITE_ASSET_BASE_URL`。
在 URL 上带过一次非空 `?assets=` 会持久化到 localStorage 并**盖住** `.env.local`；要回到默认，
带一次空的 `?assets=`（`scene/assetBase.js` 的显式清除开关）。改 `.env.local` 后必须**重启 dev
server**（`import.meta.env.*` 在 transform 时内联，不是运行时读取）。

自检（无需看画面）：开 `?debug` 后 `window.__gdbg.layers === true` 表示分层地表已就绪；
`window.__pbV.filter(v => v.glb).length` 等于车辆数表示车模 GLB 全部挂上。

## 启动方式

在仓库根目录执行：

```bash
cd frontend
npm ci
npm run dev:production-remote
```

浏览器打开 `http://localhost:5173`。该模式只替换开发服务器的 `/api` 代理目标：前端代码仍使用现有的相对 API 路径，不引入业务 `VITE_API_BASE_URL`。

普通本地后端开发仍使用：

```bash
npm run dev
```

它把 `/api` 转发到 `http://localhost:8087`。未识别的 Vite mode 也会安全回退到本地后端。

## 认证与安全边界

- 前端继续复用现有生产 Keycloak 配置：`https://auth.wotbtools.com` / realm `wotbtools` / client `wotbtools-web`。
- `http://localhost:5173/*` 必须已在 Keycloak client 的 Redirect URIs 中允许；登录完成后回到本地前端当前视图。
- `production-remote` 启动时 Topbar 会显示非模态环境提示，提醒当前 `/api` 请求指向生产后端。
- 生产后端上的真实用户、回放和业务操作会产生真实影响；仅使用明确获准的账号和数据，不上传测试或敏感数据。
- 该模式是开发服务器代理，不代表生产前端 bundle 或生产部署配置发生变化。

## 验收建议

本地可验证页面加载、Keycloak 登录回跳、带认证的 `/api` 请求和现有前端功能；真实生产账号权限、生产数据写入结果以及完整回放人工流程仍需在获准的生产环境手工确认。
