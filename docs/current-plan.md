# WotBTools CI/CD Architecture v2 — 开发方案单

> 状态：已完成；COS backup implementation remains a separate PR, V22 production verification is deferred to operator runbook.
>
> 需求来源：用户粘贴的 `WotBTools CI/CD Architecture v2 — Implementation Plan`；该用户计划优先于本文件此前的模板内容。

## 1. 需求确认单

### 目标

将单 VPS + Docker Compose + GitHub Actions 的生产链路收敛为：

```text
PR → affected CI → merge main → affected immutable Build
→ affected Deploy → 全部核心服务 Health → service-version metadata
```

正常发布不再依赖人工 Promote、candidate/LKG 状态机、自动应用回滚或 Deploy 内数据库备份。

### 范围

- 建立 CI、Build、Deploy 共用的 `changed files → affected surfaces/services` 单一事实源。
- 保留并修正 backend、frontend、Keycloak 的 selective CI、selective Build、SHA image 与 manifest。
- Deploy 只更新受影响 service；部署后检查全部 blocking core health；观测故障只标记 degraded。
- 用简单的 per-service production metadata 记录成功部署的 image identity 与 backend schema version。
- 删除正常发布中的 LKG、candidate、自动 rollback、legacy LKG bootstrap、schema-aware application rollback 与 Deploy 内 backup。
- 将 COS 数据库备份完整实现明确拆为后续独立 PR；本次只解除 Deploy 与现有本地 backup 的耦合，并保留清晰的后续边界。
- 新增仅 `workflow_dispatch` 的 service-aware Ops Recovery；Application Recovery 与 Database Disaster Recovery 分离。
- 更新部署脚本、workflow、测试、运维文档与 CHANGELOG。

### 非目标

Kubernetes、Nomad、Blue/Green、Canary、Service Mesh、ArgoCD、GitOps 迁移、多节点编排、自动数据库回滚、复杂 release catalog、自动 COS 数据库 restore。

### 验收标准

1. frontend/backend/Keycloak/shared dependency 的 CI、Build、Deploy 选择结果来自同一模型；skipped job 不使 `CI / Required Gate` pending。
2. 同一 commit 的多个 affected image 全部 Build 成功后才允许进入 Deploy；每个 production image 使用 `sha-<前 12 位完整 SHA>`。
3. frontend-only/backend-only/Keycloak-only 发布不会 Build、Pull、Recreate、Restart 其它应用 service；生产 Deploy mutation 被串行化。
4. 每次应用 Deploy 后都检查 backend、frontend（含 `Host: wotbtools.com`）、Keycloak OIDC 与 backend 的数据库可用性；Prometheus/Loki/Alloy/Grafana 为 non-blocking degraded domain。
5. blocking health 失败时 workflow 失败、先输出 release/affected/image/status/log/schema 诊断，并停止失败 service 的 runaway restart；不自动恢复任何旧 application image。
6. 只有 affected service 已部署且 global core health PASS 后，才原子更新该 service metadata；其它 service metadata 不变。
7. normal Deploy 不执行 `pg_dump`、数据库 restore、LKG/candidate promotion 或 application rollback。
8. 本次 normal Deploy 不依赖或调用 database backup；COS 上传、retention 与 object verification 在后续独立 PR 验收。
9. Ops Recovery 只能人工触发，按 service 使用 current production metadata 或明确 SHA；backend target 的最大 migration version 高于 live schema 时拒绝启动。
10. normalized shell smoke、workflow/release contract、change-detection、failure/no-rollback、metadata、schema guard 与文档检查全部通过；不伪造生产 V22/CPU 结果。

### 关键假设与待确认项

- 默认保留 `Build` 的人工 `workflow_dispatch` 作为构建工具；“manual workflow only Ops Recovery”约束针对生产应用 Deploy。
- 默认保持当前 `unless-stopped` runtime policy；Deploy 失败路径只对确认失败的 affected container 执行 bounded stop，不引入 supervisor。
- 默认保留 `deploy/postgres-restore.sh` 作为显式、人工、独立的 DB restore runbook，不接入 Ops Recovery 的 application action。
- COS bucket/prefix/tool/credentials 是后续独立 PR 的前置确认，不在本 PR 实现或猜测；不得把现有 artifact bucket 当成 backup bucket。
- V22 production schema、当前 backend SHA、restart count、CPU 与 global health 是后续 operator runbook 验证项；本 PR 只实现代码库内的 schema guard、测试和命令，不伪造线上结果。
- 默认将共享生产 Compose 文件变更视为“全部 runtime config affected”，因为当前所有服务共用一个 `deploy/docker-compose.prod.yml`，不能安全推断只影响一个 service。

## 2. 现实审计（main 当前证据）

| 领域 | 当前实现 | v2 差距 |
|---|---|---|
| CI | `.github/workflows/ci.yml:16-153` 用 `dorny/paths-filter` 维护独立 filters；`required` job 在 `:694` 附近聚合 | CI 规则未与 `deploy/release_plan.py` 共用 |
| Build | `.github/workflows/build.yml:31-103` 冻结 SHA；`:105-203` selective image build；`:204-263` 上传 manifest | 基础已符合，但需扩展 CI/deploy surfaces 与 infra-only 边界 |
| Deploy | `.github/workflows/deploy.yml:6-110` 支持 `workflow_run` 和手工应用 Deploy；`:139-265` 校验 image/SSH 执行 | 手工 Deploy 仍存在，自动路径仍传递 stale guard/旧 rollback 语义 |
| Change model | `deploy/release_plan.py:18-82,103-162` 已覆盖部分 Build/Deploy path | 缺少 CI surface；HTTP contract、共享数据与 infra-only 规则需统一 |
| Deploy script | `deploy/deploy.sh:1-49` 声明 LKG/restore/prev；`:395-418` pre-deploy 双库 backup；`:1149-1292` rollback；`:1313-1465` LKG promotion | 重写为 staged selective deploy + global health + diagnostics + no automatic rollback |
| Compose | `deploy/docker-compose.prod.yml:1-192` 是 9-service Compose project，共用 `wotb_internal` | 保留 service identity/env/volume，禁止普通发布无条件全栈 `up` |
| Backup | `.github/workflows/database-backup.yml:1-47` 只 SSH；`deploy/postgres-backup.sh:6-124` 写 `/opt/wotb/backups` 并本地 retention | 无 COS upload/object verification；Deploy 仍耦合 pre-deploy backup |
| COS | `infra/tofu/environments/prod/cos.tf` 管理 artifact bucket，lifecycle 1 天；baseline `:254-255` 明确 runtime COS access 未纳管 | 不能猜 backup bucket/凭据 |
| Tests/docs | `deploy/test-deploy-rollback.sh` 约 77 KB 的 LKG rollback smoke；`docs/operations/observability.md:175-204` 记录旧架构 | 替换旧测试与文档，避免两套模型并存 |

### 依赖映射基线

| 路径/变化 | CI | Build | Deploy |
|---|---|---|---|
| `frontend/**`、`docker/Dockerfile.frontend`、`deploy/nginx/**`、frontend 使用的 `common/assets/**` | frontend | frontend | `wotb-frontend` |
| `java/**`、`docker/Dockerfile.backend`、Flyway `V*.sql` | backend；wire 变化加 HTTP contract | backend | `wotb-backend` |
| `keycloak-*-provider/**`、`docker/Dockerfile.keycloak`、`docker/keycloak/**` | provider/runtime | keycloak | `keycloak` |
| `contracts/http/**` | backend + frontend + HTTP contract | backend + frontend | backend + frontend |
| `common/map_names.json`、`common/tankopedia-tier10.json` | backend + frontend | backend + frontend | backend + frontend |
| backend Dockerfile 使用的 tier7/8/9、`tank_tactical_profiles.json`、`map-semantics/**` | backend/data | backend | backend |
| `map-semanticizer/**`、`common/python/**` 且未改变产出数据 | data/专用验证 | 不构建 | 不部署 |
| `.dockerignore`、Maven/Node/build 全局配置、`.github/workflows/**` | full CI | 按实际 image input；无法证明时 all | 不因 workflow-only 自动改生产 |
| `deploy/docker-compose.prod.yml` | deploy smoke | 不构建 image | 全部声明受影响 runtime service |
| `deploy/observability/{prometheus,loki,alloy}/**`、Grafana provisioning | observability/deploy smoke | 不构建应用 image | 对应 observability service；dashboard JSON 走 Grafana OpenTofu |
| `infra/tofu/**` | OpenTofu validation | 不构建 | 仅对应 IaC workflow |
| `deploy/deploy.sh`、backup/restore/helper、纯 workflow 控制逻辑 | deploy/ops smoke | 不构建 | 不因控制脚本变化自动重启应用 |

以上映射在实现前还需以 Dockerfile、pom、Vite 配置和 workflow 实际引用复核；不能把 `common/** → all` 作为默认规则。

## 3. 目标设计

### 3.1 唯一 Change Detection Model

扩展现有 `deploy/release_plan.py`，不新建第二套规则。输入为确定的 changed-path 列表，输出至少包含：

```json
{
  "ciSurfaces": {"backend": false, "frontend": false, "keycloak": false, "httpContract": false, "data": false, "deploy": false, "observability": false, "full": false},
  "buildServices": [],
  "deployServices": [],
  "deployConfig": false
}
```

PR 使用 base SHA → head SHA；main Build 使用事件携带的 `before` → `github.sha` 并冻结 checkout SHA；Deploy 不重新计算 diff，只消费校验后的 manifest。输出排序、去重、manual 输入和 manifest schema 由同一 Python 工具校验。

### 3.2 CI / Build

- `ci.yml` 删除重复的 `dorny/paths-filter` 业务规则，改为调用 change model；保留现有 Python、Backend、Keycloak provider/runtime、Frontend、HTTP contract、Android、Observability、Deploy smoke 边界。
- `CI / Required Gate` 始终创建；按 `ciSurfaces` 处理 skipped job，docs-only 只执行 selector/gate。
- `build.yml` 保留 component-local SHA tag、同一 frozen commit checkout 和 manifest；任一 required image build 失败不得触发 Deploy。
- `latest` 只作为 convenience tag；自动 production Deploy 与 Ops Recovery 均不得依赖它。

### 3.3 Selective Deploy 与 Health

- `deploy.yml` 的自动入口只接受成功 Build manifest；删除普通手工 `all/backend/frontend/keycloak` Deploy 入口，事故操作转入 Ops Recovery。
- 保留 incoming staging、`docker compose config`、目标 image pull 与同文件系统 promote；应用使用 `docker compose up -d --no-deps --force-recreate <affected>`，不执行 `down`，不无条件 `up -d` 全 stack。
- `production-maintenance` concurrency 继续串行化 Actions；服务器脚本保留 `flock` 作为第二道 production mutation guard。
- blocking：backend `/api/health`、frontend 带 `Host: wotbtools.com` 的 `/api/health`、Keycloak OIDC discovery；backend readiness 作为应用 DB connectivity contract，必要时补 bounded `pg_isready`，不引入完整 E2E。
- non-blocking：Prometheus、Loki、Alloy、Grafana、datasource/dashboard、metrics/log ingestion；失败输出 `OBSERVABILITY DEGRADED`，不回滚健康应用。
- 每个 probe 具备 connect timeout、request timeout、interval、最大 attempts；失败先输出 target/image/compose ps/inspect/logs/Flyway version，再对 failed affected container bounded stop，防止 restart storm。
- blocking gate 失败：workflow FAIL、metadata 不更新、无自动 application rollback；operator 进入 Ops Recovery。

### 3.4 Production Metadata

使用 `/opt/wotb/production-release.json`，结构保持最小：三个应用的 `commitSha`、immutable `imageTag`、`deployedAt`，backend 可带 `schemaVersion`，顶层可带 `deploymentConfigSha`/`updatedAt`。写入必须 atomic、`0600`，只在 affected service + global core health PASS 后更新该 service。

该文件只回答“最后一次被完整 health 验证成功的 service identity”，不是 LKG、candidate、restore 或 rollback engine；失败发布不覆盖旧 metadata，也不自动切换到旧 metadata。

### 3.5 Backup / COS

复用现有 `postgres-backup.sh` 的双库 dump、catalog/data validation 和临时文件清理；移除 Deploy 调用。`database-backup.yml` 独立执行：VPS 生成 `wotb`/`keycloak` 压缩归档 → owner-approved COS prefix（建议 `postgres/YYYY/MM/DD/` 与 `keycloak/YYYY/MM/DD/`）→ object exists + size > 0 验证 → 删除本地临时文件。

上传实现只选择经 owner discovery 证明可用的现有 COS CLI/S3-compatible path；禁止在仓库、workflow output、日志或 metadata 写入凭据。retention 优先交给 owner-approved COS Lifecycle；未完成时验收报告明确 blocker。

### 3.6 Ops Recovery

新增 `Ops Recovery` workflow，仅 `workflow_dispatch`，service-aware，至少支持：

- `recover-current`：从 production metadata 取该 service 最近一次成功 identity，重新验证 image 存在后只恢复该 service。
- `recover-specific-sha`：operator 明确提供 service + full SHA，校验 `sha-<12>` image 存在后只恢复该 service。

backend recovery 先以目标 source SHA 的 `java/wotb-web/src/main/resources/db/migration/V*.sql` 计算最大 migration version，再读取 live `flyway_schema_history`；target max < live schema、schema 无法读取或 target identity 无法验证时 REFUSE。Recovery 不做 DB restore/downgrade，不自动重启其它 service。

## 4. 分步实施计划

### Step 0 — 执行前冻结与生产前置（完成）

文件：`docs/current-plan.md`、相关 `AGENTS.md`、部署文档。

- 用户批准后在独立 branch/worktree 执行；保留主工作区现状。
- 重新核对 remote、main HEAD、生产 environment approval 与 workflow concurrency。
- 按用户边界将 COS bucket/prefix/tool/credential discovery 与生产 V22 live verification 留给后续 operator/独立 PR；本 PR 未执行 production mutation。

验证：workflow YAML/actionlint、secret static check、无 secret 的 preflight record。

### Step 1 — 统一 change model 与 contract tests（完成）

文件：`deploy/release_plan.py`、`deploy/test-release-plan.sh`、`.github/workflows/ci.yml`、`.github/workflows/build.yml`、`.github/workflows/deploy.yml`。

- 把 CI/build/deploy path map 收敛到 Python；覆盖 PR/main/首 commit/squash/merge/sequential merge/rerun。
- 增加 shared/common、HTTP contract、migration、Dockerfile、workflow、observability、OpenTofu、docs-only 正反例。
- manifest 只允许 immutable SHA；移除自动路径中的 latest/stale rollback 语义。

验证：change detection、manifest schema、multi-service required-build gate、sequential release fixture。

### Step 2 — Selective CI（完成）

文件：`.github/workflows/ci.yml`、`.github/AGENTS.md`、必要的 CI smoke script。

- 用 Step 1 输出替换重复 filter；保留现有高价值验证 job，不把 Deploy/Backup/Recovery 重活塞进 PR CI。
- 固化 skipped-job 与 `CI / Required Gate`；full selector 只用于全局 workflow/build/test infrastructure 或无法可靠限界的变化。

验证：frontend-only/backend-only/Keycloak-only/multi-service/shared/infra/docs-only workflow contract；必要时 actionlint。

### Step 3 — Selective immutable Build（完成）

文件：`.github/workflows/build.yml`、`deploy/release_plan.py`、`deploy/test-build-workflow.sh`。

- 保留三个独立 builder 的 frozen SHA checkout 与 `sha-<12>` tag。
- 只构建 affected image；所有 affected image 成功后生成 authoritative manifest；docs/config-only 生成明确 no-op 或 config-only manifest。
- 不在 Build 中跑测试或 production health；不让单个成功 builder 提前触发 Deploy。

验证：SHA/tag parity、unaffected image skipped、multi-image failure blocks manifest/Deploy、rerun 不漂移。

### Step 4 — 重写 normal Deploy（完成）

文件：`deploy/deploy.sh`、`deploy/docker-compose.prod.yml`、`.github/workflows/deploy.yml`、`deploy/test-deploy-contract.sh`（新增）。

- 删除 LKG/candidate/restore-next/failed-tree/legacy bootstrap/`DB_SCHEMA_VERSION.lkg`/`DEPLOYED_SHA.lkg`/automatic rollback 及相关 env。
- 删除 Deploy 内 pre-deploy backup；保留 staged config/pull/promote、目标 service up、global health、diagnostics、failed-service stop。
- 读取并原子更新 `production-release.json`；metadata 失败必须使 Deploy 失败且不伪造 promotion。
- 保留 observability verifier 的 fail-closed 检查语义，但由 Deploy 将其归类为 degraded。

验证：只触碰 affected service；blocking health failure 无 rollback；observability failure 不回滚健康应用；restart storm stop；metadata 仅 global PASS 更新；compose/pull 失败不改变 live。

### Step 5 — 保留独立 Backup 边界（COS 另 PR，完成）

文件：`.github/workflows/database-backup.yml`、`deploy/postgres-backup.sh`、相关文档；COS upload helper 与 COS workflow 不在本 PR 新增。

- 删除 normal Deploy 对 `postgres-backup.sh` 的调用，保持现有 backup workflow 独立；不要把“本地备份存在”误标成 COS 完成。
- 在文档中记录后续 COS PR 的 bucket/tool/secret/retention 接口要求，不引入未经确认的资源或凭据。

验证：Deploy 不调用 backup；现有本地双库 backup 脚本保持语法/契约可用；COS upload/对象验证留给后续 PR。

### Step 6 — Ops Recovery（完成）

文件：`.github/workflows/ops-recovery.yml`（新增）、`deploy/ops-recovery.sh`（新增或复用最小入口）、`deploy/test-ops-recovery.sh`（新增）。

- 只允许人工触发、明确 service 与 target；禁止 `all` 隐式重启全栈。
- 实现 current metadata 与 specific immutable SHA；backend schema guard fail-closed。
- 输出 target/current image、compose status、health、schema guard；失败不自动改 DB。

验证：frontend recovery 不读 Flyway；backend older-than-live 拒绝；未知 image/缺 metadata 拒绝；只变更目标 service。

### Step 7 — 删除旧测试与文档同步（完成）

文件：删除/替换 `deploy/test-deploy-rollback.sh`；更新 `deploy/AGENTS.md`、`.github/AGENTS.md`、`docs/DEVELOPER_GUIDE.md`、`docs/operations/observability.md`、`docs/operations/observability-runbook.md`、`docs/CHANGELOG.md`、`docs/CHANGELOG-PRODUCT.md`。

- 删除 LKG/candidate/automatic rollback/Deploy backup 的过时叙述、命令、fixture 和 comments。
- 明确 Normal Release、Selective CI/Build/Deploy、Production Health、metadata、独立 COS Backup、Ops Recovery、Flyway rules 与 V22 operator commands。
- 保留数据库 restore 的独立人工 runbook；不把未完成的 COS/V22/CPU 结果写成完成。

验证：全文 `rg` 无旧架构 production path 残留；文档命令与 workflow/script 参数一致；无 secrets/token/DB password。

### Step 8 — 收口验证与交接（完成）

1. `git diff --check`、YAML/actionlint、Python syntax。
2. normalized LF 下 Bash syntax 与 targeted shell contracts。
3. release/build/deploy/backup/recovery smoke、Flyway immutability、observability/runtime smoke。
4. affected module validation；CI/build infrastructure 变化按仓库规则由 PR CI 作 authoritative gate。
5. 只验证代码库内 forward-only V22 schema guard、migration immutability 与 recovery smoke；生产 Flyway/restart/CPU/global health 由 operator 后续按 runbook 执行。

最终报告必须包含旧→新架构、实际 changed files、删除的复杂度、path→service map、CI/Build/Deploy、metadata、COS backup、Ops Recovery、V22 实测或 operator commands；不得用历史文档代替生产证据。

## 5. 执行记录

- Worktree/branch：`WotbTools-cicd-architecture-v2` / `refactor/cicd-architecture-v2`。
- 已实现：统一 path model、immutable Build manifest、workflow_run-only normal Deploy、staged selective deployment、global core health、degraded observability、atomic production metadata、single-service Ops Recovery 与 backend migration ceiling guard。
- 已删除：normal Deploy 内 backup、LKG/candidate/自动 application recovery 相关脚本与测试；COS upload/object verification/retention 未加入本 PR。
- 已验证：LF-normalized shell contract、release plan、Build/Deploy workflow、CI aggregation、path model、selective deploy failure/no-auto-recovery、Ops Recovery schema guard、生产 Compose config；未宣称真实生产 V22/CPU/restart/global-health 结果。

## 6. Contract Impact

无 FE ↔ BE HTTP JSON shape 变更；`contracts/http/openapi.yaml` 不因本任务改动。CI/CD manifest、production metadata、workflow inputs 和 shell env 是运维 contract，需由 `release_plan.py`/shell contract tests 锁定。Flyway 只允许新增 forward-only version，不修改历史 migration。

## 7. 不做清单

- 不改业务 API、前端页面、AI prompt、回放解析、Keycloak provider 业务逻辑。
- 不把 `correlationId` 等高基数值加入 Prometheus label。
- 不保留新旧两套部署模型并存的兼容分支。
- 不用 automatic application rollback 规避 Flyway schema mismatch。
- 不把 artifact COS bucket 猜成数据库备份 bucket，不伪造生产访问或备份成功。
