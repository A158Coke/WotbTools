## 现有 workflow 职责

- `ci.yml`：唯一 PR 验证入口和 `CI / Required Gate`。Selector 调用
  `deploy/release_plan.py --base BASE --head HEAD`；普通 Java 使用受影响 reactor
  `-pl/-am`，Docker packaging、浏览器测试和七个 Tofu roots 按风险选择。
  PR 的 Tofu 工作是 validation：`OpenTofu validation / <root>` matrix 只跑
  fmt / `init -backend=false` / validate 与该 root 的本地 safety fixture。PR 不 SSH 生产宿主、
  不读生产 local state、也不接收 host-local 生产凭据；需要 production-local provider 的五个
  root（keycloak、rabbitmq、business-postgres、keycloak-postgres、minio）只在 main-only Tofu
  Apply 里 plan/apply。COS/Grafana 走远端 backend / 外部 API，仍由 runner 做 authenticated
  只读 plan + safety guard。PR 与 main 不共享 binary plan。
- `build.yml`：仅 `workflow_call` 与单 component `workflow_dispatch`，接受五个组件
  business-api/frontend/keycloak/parser-worker/minio。冻结完整 source SHA，只发布对应 registry
  的 immutable `sha-<12>` image，回读并核对 registry digest；输出完整 image/tag/SHA/digest。
  TX 三镜像直传 TCR，Yecao 两镜像使用 GHCR。无 main push trigger、无 all、无 latest release tag、
  无 manifest handoff。
- `deploy.yml`：仅 `workflow_call` 与单 service `workflow_dispatch`。调用方传精确 Build
  image+digest；配置服务从 production metadata 读取已部署镜像身份。TCR/GHCR registry 归属与
  immutable tag 必须 fail-closed 校验。TX production metadata v2 只含三个应用镜像；
  Yecao metadata v2 只含 parser-worker/minio。Caddy、PostgreSQL、RabbitMQ 与 Yecao 观测配置
  可被 Release 按实际受影响服务选择，不写入应用镜像 metadata。
- `release.yml`：唯一 main push 自动发布入口。一次 push 的完整 before..head diff 由 planner
  解释，独立触发五个 Build、单 service Deploy 与七个单 root Tofu Apply lane；无关 lane 并行，
  依赖 lane 等待必需的基础设施，最终 summary 对选择的失败汇总。过期 rerun 在生产写入前由
  Build/Deploy/Tofu 拒绝；生产 workflow 使用不取消的共享维护队列。
- `tofu-apply.yml`：单 root `workflow_call`/手动入口，只接受 main 当前 SHA；七 root 各自
  使用 scoped state/provider/secret 和原 safety guard，apply 同一份已校验 saved plan，并按 root
  做 second-plan/readiness 检查。不要恢复独立 main apply 或 PR plan workflow。
- `android-release.yml`：版本来自 committed `android/gradle.properties`，Native Bridge 协议来自
  `contracts/android-native-bridge.json`；workflow 不接受手工版本输入。
- `update-tankopedia.yml`、`database-backup.yml`、`prod-diagnostics.yml`、
  `cleanup-images.yml` 保持各自独立职责。

## 规则

- 新增/修改 workflow 前先读对应脚本真实实现；CI 命令必须与本地命令一致（settings.xml 路径、Node/JDK 版本）。
- 不把 secret 写进 workflow 文件；用 `secrets.*` / `vars.*` 或环境变量。
- 不要给 CI 塞非门禁性的重活；Deploy 不重复跑测试套件。
- 职责分层：Agent 做 targeted correctness，PR CI 是唯一 authoritative validation gate，
  按影响域选择 jobs 并由 `CI / Required Gate` 聚合，Deploy 做 production verification。
