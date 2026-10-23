# Wave D1 — Frontend HTTP Ownership Cleanup

## Outcome

收敛前端 Business HTTP endpoint ownership：所有 `/api/**` 业务端点由 `frontend/src/api/<domain>.ts` 拥有；`frontend/src/utils/http.ts` 仅保留跨域 transport / error normalization / runtime URL mapping。静态资源、Native resource protocol、构建脚本中的直接 `fetch()` 不属于本任务。

## Evidence

- `frontend/src/api/**` 已是新代码的 canonical owner：Tournament、Creators、League Broadcasts、AI Review、Replay 等均在此定义 endpoint / auth / wire contract。
- `frontend/src/utils/api.js` 仍混合 HoF、HoF Admin、Hundred、Mark3、Admin Users 等业务端点。
- `frontend/src/utils/api-user.js` 明确是 User domain transport，但物理位置仍在 `utils/`。
- `frontend/src/utils/http.ts` 是正确的 infrastructure primitive，不做统一 ApiClient 重构。

## Scope

1. `utils/api-user.js` → `api/user-profile.ts`。
2. `utils/api.js` 中 Admin Users 端点 → `api/admin-users.ts`。
3. `utils/api.js` 中 HoF / Hundred / Mark3 / admin 端点 → `api/hall-of-fame.ts`；只有代码证据证明有必要时才进一步拆 public/admin。
4. 机械更新 production/test imports，保持 public function names 与 observable behavior。
5. 删除 legacy `utils/api.js` / `utils/api-user.js`；不保留永久 re-export facade。
6. 增加窄 ownership guard：production Business API literal `/api/` 只能存在于 `src/api/**` 或明确 infrastructure exception；不要全局禁止 `fetch()`。
7. 更新 `docs/frontend/architecture.md`；只有现有 AGENTS 规则不足时才补 `frontend/AGENTS.md`。

## Preserve

- Endpoint URL、method、query、multipart fields。
- Bearer/token refresh、401 login target、auth epoch semantics。
- Feature gate ownership。
- `ApiError` / `apiErrorFromResponse` / `requireOk` 行为。
- HoF authenticated download filename / blob behavior。
- Existing response shapes；已有 generated OpenAPI schema 的 endpoint 继续使用或迁移到 generated types/validators，不为了搬文件重写整个 contract。
- Static assets、Agent assets、official demo、Native replay URI 等 direct fetch 保持原状。

## Non-goals

- Generic `ApiClient` / `HttpClient` / Repository / BaseApiService。
- 全仓禁用 `fetch()`。
- HoF 产品逻辑/UI 重构。
- 新 backend API。
- SSE abstraction rewrite。
- D2 contract-hardening backlog；D1 只做 ownership cleanup。

## Implementation order

1. User/Profile transport migration。
2. Admin Users migration。
3. HoF surface migration。
4. Remove legacy modules。
5. Ownership guard。
6. Current-state docs。

## Validation

- User/Profile + business bootstrap tests。
- Admin Users tests。
- HoF API/page/admin tests。
- HTTP/error tests。
- Typecheck + lint + affected frontend unit suite + build。
- Ownership guard。
- `git diff --check`。
- Review With Docs。

## Acceptance

- 所有 Business endpoint owner 位于 `frontend/src/api/**`。
- `utils/api.js` 与 `utils/api-user.js` 不再存在。
- `utils/http.ts` 仍然只负责 transport/error/runtime infrastructure。
- 不新增 generic HTTP abstraction。
- 业务行为与 wire contract 无可观察变化。
- Static/native resource direct fetch 不被误迁移。
- Targeted validation 与 CI 通过。
