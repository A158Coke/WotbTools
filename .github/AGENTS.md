# .github/ — Workflow 所有权与变更规则

> **何时必读本文件**：新增/修改 `.github/workflows/` 下任何 workflow、
> 调整 CI 路由或 production 触发条件时。硬约定见 `.agents/AGENTS.md`；
> 细节 canonical 在 `docs/operations/*` 与 `docs/android/release-process.md`；
> 契约测试 `scripts/ci/test-workflow-contract.sh`。

## 硬约束（不可协商）

- 仓库只有一个 PR routing 入口：`ci-gate.yml` 拥有唯一的 `CI / Required Gate`；
  不得增加 heavy、non-gating job，不得在 production workflow 内重复 PR test suite。
- 所有 production owner 必须在 `on.push.paths` 与 `PRODUCTION_INPUT_PATHS`
  声明完全相同的 owned inputs；application owner 只在 main 上 owned inputs
  变化时运行（取消同服务旧 run，发布前立即复查 main）。
- `deploy/check-production-freshness.sh` 检查 source ancestry 与 owned inputs；
  manual dispatch 必须精确指向 current `main`；强制更新 transport ref 的
  `asset-origin.yml` 还需 mutation 前以 `PRODUCTION_REQUIRE_EXACT_MAIN=1` 确认。
- Host mutation 使用 host-level `flock`；**不得恢复已删除的
  Release/Build/Deploy/Tofu reusable-workflow DAG**，不得新增 `workflow_run`
  链或跨服务 planner；改 workflow 前先读其真实 scripts 与相关
  `deploy/AGENTS.md`/OpenTofu 契约。
- Replay parsing 在浏览器运行：**没有 parser-worker、RabbitMQ 或 MinIO owner，
  不得重新引入**（`scripts/ci/test-workflow-contract.sh` 断言）。
- 不得在 workflow 文件中放置凭据；`secrets.*`/`vars.*`/job permission 只作用于
  消费它们的 job；TX production job 用现有 repository-level Actions
  secrets/variables，不得发明未配置的 Yecao environment。

- PR CI 没有 production credentials、SSH、image push、production state、plan 或
  apply；OpenTofu PR validation 永不读 production state、不建 authenticated plan；
  main workflow 本地重新 plan，apply 精确且受 guard 保护的 saved plan。
- Main-triggered production workflow 必须在昂贵工作前拒绝非 ancestor source 与
  owned inputs 变化；`latest` freshness（Keycloak / AI service）在 owned inputs
  已变化时标记 superseded——跳过 publish/deploy 但不失败
  （`check-latest-main.sh` exit 10）。
- `infra/komodo/resources/**` 只路由到 non-production `deployment` PR gate
  （`scripts/ci/test-komodo-resources.py`），**绝不能**加入 controller 的
  paths/inputs。唯一狭窄例外是 `infra/komodo/resources/asset-origin.toml`：
  它同时是 `asset-origin.yml` 的 production source-transport gate input，
  该 gate 只能修改 GitHub `asset-origin` pointer branch 与 Gitee `asset-origin`
  transport branch；不得修改共享 Gitee `main`、执行 ResourceSync Apply、
  修改 Komodo resources 或部署 Stack。
- `ali-sh-asset-01` 不属于 `komodo-periphery.yml` 自动化链：其 Periphery agent
  手动 bootstrap、手动管理 lifecycle；不得引入 Alibaba SSH secrets、
  reusable workflow 或自动 reconcile。

## Workflow 职责地图（40 个，以 `.github/workflows/` 目录为准）

| Workflow | 职责 | 细节 canonical |
|---|---|---|
| `ci-gate.yml` + 15 个 `ci-<owner>.yml` | 唯一 PR 入口：identity 验证、按 changed paths 路由、聚合结果；OpenTofu root 只在 owner 受影响时验证 | — |
| `business-api.yml` / `frontend.yml` | digest-pinned 车道：exact SHA → immutable TCR → 生产消费 `repo@sha256:<digest>`；Business API mutation 前跑只读 dependency probe | `../docs/operations/ci-supply-chain.md` §5 |
| `keycloak.yml` / `ai-service.yml` | `latest` freshness owner；Keycloak 保留 runtime/OpenTofu/verification 链 | `../docs/auth/keycloak-tx-bootstrap.md` |
| `caddy.yml` | 独立 TX gateway owner：stage/验证配置、reconcile gateway、验证 TLS/redirect/route；不构建镜像、不依赖 database/admin credential | `../docs/operations/komodo-public-ingress.md` |
| `business-postgres.yml` / `keycloak-postgres.yml` / `observability.yml` / `alloy-tx.yml` | 各自 TX/Yecao runtime 与 OpenTofu root；provider/state/secret/plan guard/readiness 限定在 owner 内 | `../docs/operations/tx-service-plane.md`、`../docs/operations/observability.md`、`../docs/architecture/grafana-opentofu.md` |
| `komodo-controller.yml` | Komodo control plane bootstrap / break-glass owner；唯一可读 DNSPod credentials；GitHub Actions 拥有 controller reconcile | `../docs/operations/komodo-periphery.md` |
| `komodo-periphery.yml` | 每 agent 独立 owner，一 host 一 job，链式 yecao→tx1→tx2；`deploy/periphery/**` 只归本 workflow | `../docs/operations/komodo-periphery.md` |
| `production-worker.yml` | TX2 Docker 主机前置条件（compose plugin、daemon.json、TCR 凭据） | `../docs/operations/tx2-production-worker.md` |
| `gitee-mirror.yml` | Gitee main 唯一自动同步 owner（独占 `production-gitee-main-sync` 队列）：exact SHA、fast-forward-only、push 后复验；分叉/非 FF 失败只由人工修；只同步 main、不 prune | `../docs/operations/agent-asset-origin.md` |
| `asset-origin.yml` | asset origin source-transport gate：冻结 event SHA → GitHub pointer branch → Gitee `asset-origin`；不部署 Stack、不触碰共享 main | `../docs/operations/agent-asset-origin.md` |
| `android-release.yml` / `android-auto-publish.yml` / `android-offload-probe.yml` | stage/publish（共用 concurrency + `queue: max`）、薄续跑入口（publish 由 `publish_gate` 执行时判定）、offload manual probe | `../docs/android/release-process.md` |
| `database-backup.yml` / `cleanup-images.yml` / `prod-diagnostics.yml` | 备份（含 Tofu root 本地 state）、镜像清理、只读诊断 | `../docs/operations/opentofu-local-state.md` |
| `tx-runtime-check.yml` | 仅 manual，只读 TX runtime gate；**绝不** stage 生产 Compose/config、部署、重建、停止、apply OpenTofu 或改 DNS | `../docs/operations/tx-service-plane.md` |
| `update-tankopedia.yml` / `update-equipment.yml` / `update-crew-skills.yml` | 独立 data-update 入口；共享 PR 发布协议唯一正文 `scripts/ci/publish-data-update.sh` | `../docs/reference/replay-data.md` |
| `codeql.yml` | CodeQL SAST（push main + 每周 + dispatch）；observe 不进 required gate | `../docs/operations/ci-supply-chain.md` §4 |

已退役 workflow 的历史 Actions run 不是激活入口；按职责维护、不按运行次数决定。
