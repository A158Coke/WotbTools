# WotBTools CI/CD 职责收口 — 开发方案单

> 状态：已完成；用户已通过 `$plan-executer` 明确批准按本方案实施。Step 1–6、review-fix / review-with-docs / code-smell 审查与收尾验收均已完成。
> 本文件是本地开发计划载体（gitignore，不入库）。

## 需求确认单

### 目标

在不重写 CI/CD、不改变生产架构的前提下，收紧 workflow 的职责边界：

- `CI / PR` 继续只承担 PR validation 与稳定的 `CI / Required Gate`。
- `Build` 只构建并推送 Backend、Frontend、Keycloak 三类应用镜像。
- `Deploy` 的手动入口只发布三个应用组件；手动发布使用对应的 `latest`。
- 自动发布继续从 Build artifact 的 `deployment-manifest.json` 读取 immutable `sha-<12>` tag。
- `Infra / COS *` 只处理 `infra/tofu/environments/prod` 生产 OpenTofu root。
- `Infra / Grafana *` 继续独立处理 `infra/tofu/grafana`。
- `Ops / *` 与 `Data / *` 保持独立。

### 范围

- Build 的 component-local `sha-<12>` + `latest` 双 tag 推送与回归契约。
- Deploy manual input、显示名、latest image existence check、当前 main deployment config 与 pull 语义。
- `release_plan.py` 的应用服务映射、manual 入口约束和 manifest 兼容边界。
- `deploy.sh` 对 manual application deploy 的服务集合、latest pull 和自动 stale guard 的保持。
- COS Plan path scope、独立 COS Apply、production state/credentials/safety guard/exact plan/concurrency。
- 既有 workflow contract、release-plan、deploy rollback 和 OpenTofu safety tests。
- 与上述行为直接对应的仓库约定和 OpenTofu 文档。

### 非目标

- 不重写 `CI / PR` 的 `changes`、conditional jobs 或 `CI / Required Gate`。
- 不删除 immutable SHA tag，不把 Automatic Deploy 改为 `latest`，不删除 deployment manifest。
- 不合并 Build/Deploy、COS/Grafana state 或 Infra workflows。
- 不重构应用代码、Android release、生产架构，也不引入 Kubernetes/Nomad。
- 不新建 PostgreSQL maintenance 或 observability maintenance workflow，除非现实审计证明删除 manual Deploy 入口会丢失已有且必要的运维能力；默认不新增。

### 验收标准

1. Manual Build 选项仍只有 `all/backend/frontend/keycloak`；每个实际构建的应用只更新自己的 `sha-<12>` 与 `latest`，component-only build 不触碰其他应用的 `latest`。
2. Automatic Deploy 只接受并使用 triggering Build manifest 的 `commitSha/imageTag/imageServices/deployServices/buildRunNumber`，仍使用 `TAG=sha-<12>` 和 stale protection。
3. Manual Deploy 选项与 UI 显示名只包含 `All/Backend/Frontend/Keycloak`；没有 `image_tag` input、低层 Compose service 不出现在 UI。
4. Manual Deploy 在 SSH 前按选择验证 `latest` image；缺失时输出具体完整 image ref 和“先运行对应 Build”的提示，不进入 SSH。
5. Manual Deploy 的 `latest` 真正 pull 对应应用 image；All 只重新发布三个应用，不主动 pull/recreate postgres、Prometheus、Loki、Alloy、Grafana、node-exporter。Compose 的必要 `depends_on` 启动行为必须保留并单独说明。
6. COS Plan/Apply 仅对 COS production root 相关路径触发；Apply 仅 checkout main 的精确 commit，使用 production state/credentials，执行 `fmt/init/validate/plan`、现有 destructive guards，然后 apply 同一个 saved plan；普通应用 merge 不触发 COS Apply。
7. Grafana Plan/Apply 的现有独立 trigger、delete allowlist、exact-plan apply、runtime verification 与 `production-maintenance` 语义不被破坏。
8. Ops/Data workflow 仍独立，CI path-aware tests 与所有列出的部署/工作流回归验证通过。

### 关键假设与默认决策

- **默认：保留 automatic config-driven observability 维护链。** 现实代码显示 `deploy.sh` 在 automatic full/config release 路径会显式应用 observability services；本次只收窄 manual application entry，不把已有自动 runtime config 链迁移到新 Ops workflow，避免扩大生产变更面。若用户要求“Automatic Deploy 也绝不触及 observability runtime”，这是需要重新确认的范围分歧。
- `all` 继续作为 manifest/script 内部的 full-release sentinel，以保持现有 automatic manifest 兼容；其 manual 语义明确为三个应用组件，不能再解释为 Compose 全栈。
- `deploy/docker-compose.prod.yml` 的 `depends_on` 是应用启动的技术依赖；应用发布不得以显式目标方式主动 recreate 非应用服务。
- COS production root 的真实路径是 `infra/tofu/environments/prod/**`；当前 `infra/tofu/**` 会错误覆盖独立 Grafana root，需要收窄。
- 不改变当前 artifact bucket、Lighthouse、state bucket、provider 版本或 state key；只复用并共享当前 COS Plan 的生产安全 guard。

### 待确认项

- 阻塞性：无。用户贴出的 Plan 已明确行为边界。
- 可默认：是否把 COS Plan 现有 inline safety guard 提取成共享 helper。方案默认提取为最小的 workflow 共用 guard，避免 COS Plan 与 COS Apply 漂移；不改变 guard 规则本身。
- 可默认：完成后 branch protection 不改规则，只核对仍以 `CI / Required Gate` 为唯一稳定 required check；若 GitHub UI 中存在旧的单项 required check，再单独报告为手工事项。

## 现实审计结果

审计基线：`main` 与 `origin/main` 一致，工作区干净；当前 `docs/current-plan.md` 仅为初始模板。

### 当前真实边界

- `.github/workflows/ci.yml:1-3, 115-123` 已是 `CI / PR`，并由 `CI / Required Gate` 聚合；`.github/AGENTS.md:7-24` 与 `docs/DEVELOPER_GUIDE.md:115-123` 均将 PR CI 作为 authoritative gate。Phase 1 默认不改其 selector/job 结构。
- `.github/workflows/build.yml:1-18, 23-28` 已只有 `all/backend/frontend/keycloak` manual Build；`:50-90` 冻结 commit 与 release plan；`:103-204` 只构建三类应用镜像并生成 manifest，但 `:127-128`, `:157-158`, `:188-189` 当前每个 builder 只推 immutable SHA tag，没有 `latest`。
- `.github/workflows/deploy.yml:5-32` 当前 manual Deploy 仍暴露 `postgres/node-exporter/prometheus/loki/alloy/grafana/keycloak/wotb-backend/wotb-frontend`，并保留 `image_tag`；`:75-136` manual path 依据 SHA/tag 生成 manifest；`:165-193` 只验证 immutable tag；`:148-161` 仍有 Observability display mapping。
- `deploy/release_plan.py:18-38, 97-121` 同时定义应用服务与低层 production services；manual `all` 返回 `deployServices=["all"]`，低层 service 仍可被 manual 接受；`:191-235` 的 manifest validator 也允许这些服务。
- `deploy/deploy.sh:31-93` 接受低层服务并兼容旧 manual caller；`:302-330` 对非 full release 保留非目标应用 immutable tag；`:357-375` 支持按传入服务 pull；`:410-420` full release 当前显式启动 `postgres keycloak wotb-backend wotb-frontend`；`:387-394`、`:1091-1111` 仍有 automatic/full observability 应用链；`:1037-1044` 当前 full staged pull 不传服务参数，因此会 pull 全 stack。
- `deploy/docker-compose.prod.yml:6-102` 定义三应用及 PostgreSQL；`:103-174` 定义 node-exporter、Prometheus、Loki、Alloy、Grafana。应用服务通过 `depends_on` 依赖 PostgreSQL/Keycloak，不能把“启动依赖”误写成“主动发布目标”。
- `.github/workflows/tofu-plan.yml:1-15, 42-92` 已具备 COS production backend、trusted-run secret 注入、fmt/init/validate、authenticated plan，以及 artifact bucket/Lighthouse delete guard；但 `:4-7` 使用 `infra/tofu/**`，会包含 `infra/tofu/grafana/**`。
- `.github/workflows/grafana-tofu-plan.yml:1-24, 48-110` 保持独立 PR Plan；`.github/workflows/grafana-tofu-apply.yml:1-22, 49-114` 已有 main-only exact plan、delete allowlist、exact-plan apply，且 `:16-18` 使用 `production-maintenance`。这部分作为不变量保留。
- `infra/tofu/environments/prod/backend.tf` 使用 COS S3-compatible backend，state key 为 `wotbtools/prod/terraform.tfstate`；`cos.tf` 的 artifact bucket 有 `prevent_destroy=true`。`docs/architecture/opentofu-production-baseline.md:203-238` 明确当前 COS workflow 只 plan、不 apply，新增 Apply 后必须更新该文档。
- `deploy/test-build-workflow.sh:20-80` 当前锁定“只推 SHA、manual Deploy 接受 SHA tag、Observability mapping 存在”等旧契约；`deploy/test-release-plan.sh:29-63` 锁定低层 manual service 和 full/observability mapping；`deploy/test-deploy-rollback.sh:763-792, 904-975` 锁定 targeted/full pull、回滚和 generation 状态；这些测试必须按新语义更新，不得削弱回归覆盖。

### 隐藏依赖与风险

- `all` 同时用于 release planner、manifest、deploy.sh full branch 和 Compose 语义；不能简单把字符串删掉，必须保持 automatic manifest schema 的一致性，并只改变 manual application 的解释。
- `deploy.sh` 的 `WOTB_DEPLOY_IMAGE_SERVICES` 决定非目标应用是否保留当前 tag；manual latest 必须传递准确的 image service 集合，否则会把非目标应用误更新成同一个 latest。
- `latest` 是可移动 tag；必须在 runner 侧验证存在，在服务器 staged compose 侧对实际目标 image 执行 pull，并继续用 current main checkout 作为 deployment config source，不能把 config SHA 当作 image identity。
- COS backend 的 GitHub Actions concurrency 不是 COS distributed lock；Apply 必须与现有生产维护并发策略一致，文档也要继续明确该边界。
- Grafana 使用独立 root/state key，但当前 COS Plan glob 会造成 workflow UI/执行重叠；path 收窄是职责收口的必要修改，不是 state 合并。

## 方案概要

1. 先保留 CI PR gate 和 automatic manifest release contract，只增加 Build 的 component-local `latest` 推送。
2. 将 manual Deploy 的公开输入收敛为应用别名，通过 `release_plan.py` 统一映射到 `wotb-backend/wotb-frontend/keycloak`；manual manifest 固定 `imageTag=latest`，不再计算当前 main SHA 或接受 `image_tag`。
3. 在 Deploy runner 侧做与 `imageServices` 精确对应的 latest existence check；在 `deploy.sh` 中把 manual full 的 pull/up 目标收敛到三应用，保留 automatic stale guard、immutable SHA、config-only 与 targeted rollback 语义。
4. 为 COS production root 增加独立 Apply workflow；把 COS production plan guard 提取/复用到 Plan 与 Apply，Apply 只对 main exact checkout 生成并应用同一个安全检查过的 plan。Grafana workflow 不合并，只修正必要的路径/契约测试同步。
5. 更新 workflow/release/deploy/OpenTofu contract tests 和职责文档；最后按配置/脚本风险分层验证。

## 分步实施计划

### Step 1 — 建立共享 COS production plan safety guard

文件：

- 新增 `scripts/ci/validate-tofu-prod-plan.sh`（暂定名，若实现审计发现更合适的现有位置则保持单一 helper）。
- 修改 `.github/workflows/tofu-plan.yml`。
- 新增 `.github/workflows/tofu-apply.yml`。

改动要点：

- 将现有 COS Plan 对 `tencentcloud_cos_bucket.production_artifacts`、`tencentcloud_lighthouse_instance.production`、`tencentcloud_lighthouse_firewall_rule.production` 的 delete/replacement fail-closed 规则集中复用；不放宽 `prevent_destroy` 或现有地址 allowlist。
- COS Plan path 从 `infra/tofu/**` 收窄为 `infra/tofu/environments/prod/**`，并保留必要的 workflow-contract path；Grafana root 不再触发 COS Plan。
- COS Apply 显示名固定 `Infra / COS Apply`，触发为 main push + COS production root paths，并保留 `workflow_dispatch`；job 必须额外 `if: github.ref == refs/heads/main`，checkout `github.sha` 精确提交，不接受任意 branch apply。
- Apply 使用与 Plan 相同的 production COS backend/state key、Tencent credentials、OpenTofu 版本和 `TF_IN_AUTOMATION/CHECKPOINT_DISABLE`；执行 `fmt -check -recursive`、production `init -reconfigure`、`validate`、`plan -out=plan.tfplan`、共享 safety guard、`tofu apply plan.tfplan`。
- Apply 仅在 guard 成功后 apply；不上传 state/plan，不执行 import，不把 secret 写入日志。concurrency 默认加入现有 `production-maintenance`，并与 Deploy、Grafana Apply、database backup 串行。

验证：YAML parse/actionlint（如可用）、`bash -n` helper、COS workflow contract fixture、无凭据的 fork/非 trusted Plan 仍只能 backend=false init、不执行 authenticated plan/apply；trusted fixture 覆盖 bucket/Lighthouse delete/replacement fail-closed。

### Step 2 — Build 双 tag，保持 component-local

文件：

- `.github/workflows/build.yml`
- `deploy/test-build-workflow.sh`
- `scripts/ci/test-workflow-contract.sh`（仅同步必要 workflow contract）

改动要点：

- 每个 `docker/build-push-action@v7` 同时写入该组件的 `${{ needs.changes.outputs.tag }}` 与 `latest`；不得共享或覆盖其他组件 tag。
- 保留 `changes` 的冻结 SHA、manual current-main HEAD guard、affected image selection、manifest 结构和 no-op manifest 行为。
- 更新测试为：backend-only 只声明 backend SHA/latest；frontend-only/keycloak-only 同理；all 声明三组件两类 tag；禁止 Build 触及 postgres/Prometheus/Loki/Alloy/Grafana/node-exporter。
- 不给 Build 增加测试套件；CI validation 继续由 PR gate 承担。

验证：静态 YAML/workflow contract、`bash deploy/test-build-workflow.sh`、按组件检查 tags/manifest output 的 fixture。

### Step 3 — 收窄 `release_plan.py` 的 manual application contract

文件：

- `deploy/release_plan.py`
- `deploy/test-release-plan.sh`

改动要点：

- 保留 automatic path 对现有 production config/observability mapping 的必要兼容，避免未经确认改变自动 config release。
- 将 manual public service 集合固定为 `all/backend/frontend/keycloak`；移除 `postgres/node-exporter/prometheus/loki/alloy/grafana/wotb-backend/wotb-frontend` 作为 manual 输入的公开入口。
- 通过单一 alias map 生成内部应用 service：`backend → wotb-backend`、`frontend → wotb-frontend`、`keycloak → keycloak`；`all` 继续是 full sentinel，但其 imageServices 明确为三个应用。
- 增加 manual manifest mode 或等价参数，使 manual manifest 固定 `imageTag=latest`，不要求/不接受 SHA identity；automatic manifest validator 继续要求 `sha-<12>`。
- 对不支持 manual service、重复/非法 service 和 image/deploy service 不一致 fail-closed，并保持 manifest schema 不无故升级。

验证：manual 四种输入结果、所有旧低层输入失败、manual latest manifest、automatic SHA manifest、multi-application automatic manifest、config-only automatic manifest和现有 path detection regression。

### Step 4 — 收窄 Deploy workflow UI、manual identity 和 latest preflight

文件：

- `.github/workflows/deploy.yml`
- `deploy/test-build-workflow.sh`
- `scripts/ci/test-workflow-contract.sh`

改动要点：

- `workflow_dispatch` 只保留 `service: all/backend/frontend/keycloak`，UI description 使用应用名称，不显示底层 Compose service；删除 `image_tag` input。
- Manual Deploy checkout 当前 main 的精确 workflow SHA 作为 deployment config source，但不再将其转换成 image tag；manual release metadata 固定 `release_tag=latest`、`stale_release_guard=0`，并要求 source 精确等于当前 `origin/main` HEAD。
- `image_existence` 根据 manual/automatic 语义选择 tag：manual 使用 latest，automatic 使用 manifest SHA；每个 service 只检查其实际 application image。
- `docker manifest inspect` 失败时包装为可行动错误：完整 image ref、具体组件、提示先运行对应 Build；失败发生在 SSH 前。
- display mapping 只输出 `Deploy All`、`Deploy Backend`、`Deploy Frontend`、`Deploy Keycloak`；automatic 多应用 manifest 继续输出组合名，例如 `Deploy Backend + Frontend`，不使用动态顶层 run-name hack。
- 保留 `workflow_run` 只订阅成功 Build、manifest 下载/校验、精确 release SHA checkout、无 build/test duplication、`production-maintenance` concurrency。

验证：四种 manual UI/input contract、manual latest image check、缺 image fail-fast 且无 SSH、automatic manifest 禁止 latest、组合 display name、stale guard 分离。

### Step 5 — 在 `deploy.sh` 保持自动发布安全并限定 manual app 发布

文件：

- `deploy/deploy.sh`
- `deploy/test-deploy-rollback.sh`
- `deploy/AGENTS.md`（实现后同步）

改动要点：

- 保留 automatic `WOTB_STALE_RELEASE_GUARD=1` 的完整 SHA/run-number/tag 校验、per-service generation stale precheck、targeted rollback、full LKG rollback、observability degraded 语义。
- 对 workflow 传入的 manual service 做最终 fail-closed 校验，低层 service 不再能通过 Deploy workflow 进入生产；旧环境变量兼容只在不扩大公开入口且不破坏安全的范围内保留，必要时更新测试明确其边界。
- manual Backend/Frontend/Keycloak 使用 `TAG=latest` 和对应 `WOTB_DEPLOY_IMAGE_SERVICES`；manual All 使用三个应用 image services，非目标应用不会被改成该 TAG。
- `TAG=latest` 时 staged pull 必须只针对实际 application image services；manual All 不再无参数 pull 全部 Compose stack。automatic config-only release 的 pull/observability 行为按 Step 0 默认决策保留并单独测试。
- full manual deploy 的显式 `docker compose up` 目标只列 `keycloak/wotb-backend/wotb-frontend`；允许 Compose 按既有 `depends_on` 启动缺失依赖，但不主动 recreate PostgreSQL 或 observability service。
- 不改变 current main deployment config checkout、staged compose config validation、Alloy validation、health gate、diagnostics、LKG/snapshot 恢复和成功/失败状态写入。

验证：`bash -n deploy/deploy.sh`；manual app-only fake-docker tests；latest pull log 只含目标应用；All 不含低层 service；automatic SHA/stale/config-only/targeted rollback、LKG 与 observability degraded regression 全部保留。

### Step 6 — 文档、workflow inventory 与人工事项同步

文件：

- `.github/AGENTS.md`
- `deploy/AGENTS.md`
- `docs/DEVELOPER_GUIDE.md`
- `docs/architecture/opentofu-production-baseline.md`
- `docs/CHANGELOG.md`
- `docs/operations/observability.md`

改动要点：

- 更新 Build 双 tag、Deploy manual latest、automatic SHA manifest、manual All 仅三应用、应用与 Compose runtime 的边界说明。
- 更新 COS Plan/Apply 的真实 path/trigger、Apply exact-plan safety 和 state/concurrency 边界；明确 Grafana root/state 独立。
- 保留并准确描述 `CI / Required Gate` 唯一 branch-protection gate、Ops/Data workflow inventory 和不重复测试原则。
- `docs/CHANGELOG.md` 记录实现后的职责收口与验证结果；不写未经验证的生产 Apply/CI 成功结论。

验证：repo-wide `rg` 检查旧 manual service/input、旧“COS 只 plan”描述和错误 tag 语义无残留；workflow inventory 与实际文件一致。

## 影响面清单

| 层面 | 结论 | 证据/动作 |
|---|---|---|
| 解析 | ✓ 不涉及 | 不改 replay/parser。 |
| 模型 | ✓ 不涉及 | 不改 domain/API model。 |
| API | ✓ 不涉及 | 不改 HTTP/OpenAPI contract。 |
| 前端 locale | ✓ 不涉及产品前端 | 仅 GitHub Actions Deploy UI input/显示名，不改 Vue locale。 |
| 导出 | ✓ 不涉及 | 不改 `Columns.java`/`AggregateSheets.java`。 |
| 测试 | ✓ 必须同步 | workflow/release/deploy/OpenTofu safety regression。 |
| 文档 | ✓ 必须同步 | `.github/AGENTS.md`、`deploy/AGENTS.md`、Developer Guide、OpenTofu baseline、Changelog。 |
| 构建/部署 | ✓ 核心影响 | Build tags、manual latest、automatic manifest、Compose pull/up、COS Apply。 |

### Contract Impact

- 不是 HTTP contract；不存在 `contracts/http/openapi.yaml` 变更。
- 新的 workflow wire-like contracts：manual input options、manifest `imageTag` mode、`imageServices/deployServices` mapping、COS path/trigger、job names。SSOT 依次为 `.github/workflows/*.yml` 与 `deploy/release_plan.py`；shell/Python tests 只验证它们，不另造第二份业务映射。
- Automatic manifest schema 保持 `schemaVersion=1`，继续由 `deploy/release_plan.py` 生成/验证；manual latest 只在明确 manual path 生成，不让前端/Actions 通过隐式 fallback 掩盖 producer violation。

## 不做清单

- 不重写 CI path-aware architecture，不移动 `CI / Required Gate` job。
- 不把 automatic release 改成 latest，不删除或弱化 stale release guard、manifest、LKG、rollback 或 production health gate。
- 不让 Deploy manual 继续作为任意 Compose service dispatcher；不以保留旧下拉项为理由污染应用发布职责。
- 不把 COS/Grafana state 合并，不把 Grafana OpenTofu apply 合并进 Deploy，不把 Apply 简化成未经 guard 的 `tofu apply -auto-approve`。
- 不把 Postgres/observability service 新增到普通 Deploy UI；不新增 Ops maintenance workflow，除非验证到明确缺口并重新确认范围。
- 不修改 production compose 服务定义、镜像版本、Keycloak/数据库架构或应用代码。

## 风险、回滚与失败处理

- **latest 漂移**：manual preflight + staged targeted pull；若 image 不存在或 pull 失败，SSH deploy 不开始/正式 compose 不替换。
- **误覆盖非目标应用**：`imageServices` 与 service alias 双重校验；测试锁定 component-local latest 和 current live immutable tags。
- **自动发布回归**：automatic path 继续使用 manifest SHA、exact source SHA、run-number guard；manifest 校验失败直接 fail-closed。
- **full/manual 误触及 runtime**：显式 app service list + latest pull target assertions；automatic config-driven runtime 维持现状并不扩大到新的 manual UI。
- **COS 误 destroy/replace**：shared plan guard + `prevent_destroy` + exact saved plan；任何 guard failure 终止 Apply。Apply workflow 本身可删除/回滚而不触碰 state；infra 配置回滚后重新生成新 exact plan，不复用旧 binary plan。
- **生产并发**：COS Apply、Grafana Apply、Deploy、backup 使用同一 `production-maintenance`，`cancel-in-progress=false`；文档明确这不是 owner laptop/其他 repo 的 distributed lock。

## 验证矩阵

实现后按以下顺序执行，结果必须真实记录：

1. 静态：YAML parse/actionlint（若环境提供）、`bash -n` 所有改动 shell、`git diff --check`。
2. CI/workflow：`python scripts/ci/test-path-filters.py`、`bash scripts/ci/test-workflow-contract.sh`，并覆盖新增 COS Apply/Grafana 独立 trigger contract。
3. Release/build：`bash deploy/test-build-workflow.sh`、`bash deploy/test-release-plan.sh`；新增/更新 latest、manual alias、automatic SHA、missing image fixture。
4. Deploy：`bash deploy/test-deploy-rollback.sh`；另执行 production compose validation，覆盖 manual app-only pull/up、automatic config-only、stale guard、targeted/full rollback。
5. OpenTofu：在 `infra/tofu/environments/prod` 和 `infra/tofu/grafana` 分别执行 `tofu fmt -check -recursive`、无后端 `tofu init -backend=false -input=false`、`tofu validate`；trusted COS plan/apply contract 使用 fixture/真实 owner-approved run 验证 safety guard 和 exact plan，禁止把未执行的 production Apply 写成已验证。
6. 回归审计：`rg` 检查 Deploy manual 不再出现低层 options/`image_tag`，Build tag contract 不再只推 SHA，COS Plan path 不再覆盖 Grafana root，旧“COS 只 plan”文档描述已更新。

## 最终汇报清单

实现完成后必须报告：

1. 修改文件与未修改的明确边界。
2. 最终 workflow inventory。
3. Build manual options 与 job names。
4. Deploy manual options 与 job names。
5. Automatic SHA vs Manual latest tag semantics。
6. COS Plan/Apply trigger、state、guard、concurrency。
7. Grafana Plan/Apply trigger 保持情况。
8. 从普通 Deploy 移除的 Compose services。
9. concurrency strategy 与其非-distributed-lock 限制。
10. tests/validation 的实际结果、未验证项和剩余风险。
11. 是否需要手工更新 branch protection；默认只需确认 `CI / Required Gate`。

## 计划状态

- [x] 用户批准本开发方案
- [x] Step 1：COS shared guard + Apply
- [x] Step 2：Build 双 tag
- [x] Step 3：release planner manual contract
- [x] Step 4：Deploy workflow latest/manual UI
- [x] Step 5：deploy.sh 与 rollback regression
- [x] Step 6：文档与最终 inventory
- [x] review-fix / review-with-docs（主代理自审、OCR delegate coverage、文档与 code-smell 审查完成；Blocker count: 0）
