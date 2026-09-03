# 本地前端连接生产后端

本地可以只运行 Vue/Vite 前端，并通过 Vite 开发代理把相对 `/api` 请求转发到生产站点。这样可以使用本地未发布的前端代码验证生产后端和生产 Keycloak 登录链路。

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
