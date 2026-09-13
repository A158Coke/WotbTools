# .github/ — CI/CD workflow 指令

> 仓库级硬约定见 `.agents/AGENTS.md`。

## 现有 workflow 职责

- `ci.yml`：仓库级 authoritative PR gate；`changes` 按 PR base SHA → head SHA 分类影响域，
  `CI / Required Gate` 始终创建并作为稳定 merge gate。docs-only 不运行 validation job，
  仅保留 selector 与 Required Gate，
  单层改动只执行相关 heavyweight jobs，CI/全局构建配置/跨切面变更触发 full CI；覆盖 Python、
  Backend、Keycloak providers/runtime、Frontend、Android、HTTP contract、Observability 与 Deploy smoke。
- `build.yml`：main push 或手工选择目标时，从冻结触发 SHA 只构建受影响 backend/frontend/keycloak 镜像，发布 component-local 的 immutable `sha-<first-12-sha>` 与 `latest` tag，并上传 authoritative `deployment-manifest`。`latest` 仅供手工应用发布使用，自动 manifest 永远只引用 immutable SHA；手工 Build 只接受当前 `origin/main` HEAD；docs-only push 仍产出 no-op manifest；不运行测试套件。
- `deploy.yml`：成功 Build `workflow_run` 自动接力，也支持手工选择 `all/backend/frontend/keycloak` 应用入口；自动路径只下载并校验对应 manifest，checkout 精确 source SHA，按 manifest 发布，不重新计算 diff、不构建、不跑测试。自动应用服务/all 必须使用 manifest 指定的 immutable image tag；手工应用发布固定使用对应组件的 `latest`，并在 SSH 前 fail-fast 校验镜像存在；run-number stale guard fail-closed。
- `tofu-plan.yml` / `tofu-apply.yml`：分别负责 production COS root 的 trusted plan 与 main-only exact-plan apply；两者共用 production path、OpenTofu safety guard 与 `production-maintenance` concurrency。Grafana root 仍由独立的 `grafana-tofu-plan.yml` / `grafana-tofu-apply.yml` 管理。
- `android-release.yml`：版本来自 committed `android/gradle.properties`，Native Bridge 协议来自 `contracts/android-native-bridge.json`；workflow 不接受手工版本输入。Android Contract CI 校验 Gradle/Native/FE/manifest 一致、runtime 改动递增版本、breaking bridge 改动递增 bridgeVersion。
- `update-tankopedia.yml`：手动触发，从 blitzkit 同步并提交 `common/tankopedia-tier{7,8,9,10}.json` 到当前分支。
- `database-backup.yml` / `prod-diagnostics.yml` / `cleanup-images.yml`：生产备份、线上诊断、镜像清理。

## 规则

- 新增/修改 workflow 前先读对应脚本真实实现；CI 命令必须与本地命令一致（settings.xml 路径、Node/JDK 版本）。
- 不把 secret 写进 workflow 文件；用 `secrets.*` / `vars.*` 或环境变量。
- 不要给 CI 塞非门禁性的重活；Deploy 不重复跑测试套件。
- 职责分层：Agent 做 targeted correctness，PR CI 是唯一 authoritative validation gate，
  按影响域选择 jobs 并由 `CI / Required Gate` 聚合，Deploy 做 production verification。
