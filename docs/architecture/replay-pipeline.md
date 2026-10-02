# 回放管线（Replay Pipeline）

> **服务器没有 parser。** 唯一的回放解析器是上游 [WoT-Blitz-Agent](https://github.com/fanypcd/WoT-Blitz-Agent)
> Rust Core，编译成 WASM 在浏览器 / Android WebView 里运行（版本与 sha256 锁定在 `deploy/agent/source.json`，
> 消费契约 `contracts/agent/replay-facets-v2.md`）。对解析结果的一切计算（去重、League Rating、指标、列投影、
> xlsx 导出、2D 回放数据）也都在客户端完成；服务端只负责存储、去重键、授权、名人堂记录与 AI 编排。
> 迁移过程见 [client-replay-engine-migration.md](client-replay-engine-migration.md)。

## Agent 产物身份（content-addressed）

- **identity SSOT**：`deploy/agent/source.json:ref`（上游完整 commit）。`artifact.release` 是同一份
  Release 的 tag，二者必须同时匹配产物自带的 `fingerprint.json`（`upstream_commit` / `tag`）。
- **运行时 URL 是 content-addressed**：`/wasm/<ref>/wotb_replay_wasm.js`、`/wasm/<ref>/wotb_replay_wasm_bg.wasm`、
  `/wasm/<ref>/fingerprint.json`（wasm-bindgen wrapper 从同目录加载 `_bg.wasm`，所以三者必须同一目录）。
- **stable `/wasm/wotb_replay_wasm.js` 被禁止**：固定 URL 会让浏览器把**别的 build 的 Agent** 长期缓存下来，
  同一个 frontend 用错版引擎解析，直到 AI Review 才以 `ai_review.poses 缺失` 暴露。构建/发布两侧都断言它不存在
  （`frontend/scripts/verify-agent-wasm-dist.mjs`、`deploy/tx/build-frontend-from-gitee.sh`）。
- **浏览器缓存靠 URL identity 失效，不靠 no-cache**：新 Agent → 新 URL，旧 URL 永不覆盖，因此
  `location ~ ^/wasm/[0-9a-f]{40}/` 反而是长期 `immutable` 缓存（用户普通刷新即可拿到新建对应的产物，
  不需要 Ctrl+F5 / 清站点数据）。只锁 40 位 hex 目录，不给 `/wasm/` 根目录统一 immutable。
- **装载顺序 fail closed**：先校验 fingerprint（commit 与 tag 都要等于 build 期 pin）→ 再 dynamic import
  版本化 JS → 才装载 `_bg.wasm`。任一不一致抛 `AgentWasmVersionMismatchError`
  （带 `expectedRelease` / `expectedCommit` / `actualRelease` / `actualCommit`），UI 提示刷新页面重试。
- **build 期注入**：`frontend/vite.config.js:agentWasmIdentity()` 读 `deploy/agent/source.json` 并通过
  `define` 注入 `__AGENT_WASM_COMMIT__` / `__AGENT_WASM_RELEASE__`（不在 TypeScript 里手写版本号）。
  Docker 通过 `COPY deploy/agent/source.json /deploy/agent/source.json` 保持与仓库同一相对布局。
- **落位与证据链**：`scripts/fetch-agent-wasm.sh`（Release 直取，sha256 + fingerprint 校验；
  `scripts/agent-wasm-artifact.py` 是唯一 ingest 实现）与 `scripts/build-agent-wasm.sh`（源码自建后备）
  都产出 `common/assets/wasm/<ref>/`，经 Vite publicDir 进 `dist/wasm/<ref>/`，再由 TX 发布脚本
  从该 source commit 的 `source.json` 逐字段回验镜像内产物。

## 数据流

```text
.wotbreplay（用户本机，文件不上传）
    │
    ▼
上游 Rust Core WASM（/wasm/<source.json ref>/wotb_replay_wasm.js）
    ├── parseResult      结算：花名册 / 胜负 / 地图 / 全员统计（毫秒级，不读包流）
    ├── parsePlayback    时序：位姿网格 / 弹道 / 击杀 / 阶段 / 可见性 / 基地
    ├── parseShotReplays 射击复现
    └── parseAiReview    AI 事件流（伤害归因等）
    │
    ▼
frontend/src/replay-local/
    ├── parse.worker.ts / parseReplays.ts   批量 parseResult 跑在 Web Worker，逐文件进度
    ├── battleFacts.ts                      parseResult → Battle 事实（与已退役 Java ReplayParser 逐字段一致）
    ├── compute/                            去重 → League Rating → 指标 → Preview 列投影
    ├── analyzeReplays.ts                   全链路：逐文件失败隔离，0 场有效 → NoValidReplaysError
    ├── export/                             xlsx 汇总 / 逐场 zip（exceljs、fflate 按需加载）
    ├── canonical/                          WotbTools canonical replay facts：身份 / 视角 / AoI / 血量 / 归属 / 终态
    │                                       （已退役 Java canonical 层逐条移植；2D 与 AI 共用的语义边界）
    ├── playback/                           canonical facts + 原始位姿 → BattlePlaybackDataset + MapOverview
    ├── ai/                                 canonical facts → ClientAiReviewProjection（AI 请求的唯一事实载体）
    └── submissionFacts.ts                  名人堂 / 百场 / 三环提交的结算事实
```

## 消费面

| 能力 | 入口 | 说明 |
|---|---|---|
| 回放工作台 · 数据 | `composables/useLocalReplayAnalysis.ts` | 选择文件 → Worker 解析 → 批次计算 → 表格；失败只显示原因，不回退服务端 |
| 回放工作台 · 导出 | 同上 `exportExcel(mode)` | 复用最近一次分析的批次结果，客户端生成 xlsx / zip |
| 2D 战局回放 | `components/BattlePlaybackPanel.vue` | 目标文件本机 `parseLocalPlayback`（三切面 → canonical facts），主线程一次性解析 |
| AI 复盘 | `components/AiReviewWorkspacePane.vue` | 目标文件本机 `buildLocalAiReviewInput` → `AiReviewRequest`（gzip）→ ai-service |
| 3D 回放 / 射击复现 / 装甲查看 | `scene/*`、`AgentShots.vue` | 直接消费 WASM 时序 / 射击切面 |
| 名人堂 / 百场 / 三环提交 | `utils/api.js` → `replay-local/submissionFacts.ts` | 本机解析得到 `Battle` 事实 JSON（`facts` 字段）+ 原始回放（证据附件） |
| 账号验证 | `ProfilePage.vue` | 本机解析出录像者 accountId，提交给 `POST /api/users/wotb-account/verify-replay` |
| Android | `useNativeReplayImport.js` | Native 只交接字节；本机分析完成后 ACK pending |

## 服务端边界

- **名人堂**（`com.wotb.web.replayfile.ClientReplayFacts`）：**client facts are intentionally untrusted; server validates
  structure, not authenticity.** 只做结构校验（arenaId / 录像者 / 1..64 名战斗者 / 账号与车辆 ID / 队伍）；不重新解析回放、
  不比对回放与 facts。防伪造靠管理员审核与回放附件（有意的产品决策，见 `docs/features/hall-of-fame.md`「信任模型」）。
- **账号验证**：客户端声称的便利徽章——只比较客户端提交的录像者数值 accountId 与当前绑定账号；不授予权限、不参与
  授权、不是身份安全边界（`docs/features/user-profile.md`）。
- **AI 复盘**：`AiReviewRequest` 只承载 client canonical AI projection；ai-service 的 `ClientAiProjectionAdapter` 结构校验后
  装配内存 canonical 事件流（纯归约，不读字节），下游 BattleTimeline / 证据 / prompt 不变。与 Java 删除前冻结重建的
  语义 parity 见 `docs/architecture/ai-review.md`「AI 复盘输入」。

## 一致性基线

`frontend/src/replay-local/__golden__/` 保存服务端 Java 解析器 / 批次计算 / 导出 / 2D 回放在仓库 fixture 回放上的
最后一份输出（Java 删除前生成，只读），CI 常驻断言客户端全链路与之逐字段一致（2D 时序数据按文档化的容差）。
上游 Rust Core 升级后重新导出 `wasm-*` 文件，再跑同一组测试。

## Agent 切面不是领域契约

2D 回放与 AI 复盘都经过 `replay-local/canonical` 消费上游切面：`api/agent-replay-facets.ts` 只做信任边界的形状校验
（含 canonical 必需证据的版本门禁，缺失即拒绝），语义决定（参战者 / 录像者 / 观测段 / 可信血量 / 归属证据 / 终态）
只在 canonical 层发生一次。Agent DTO 字段名、钳 0 的显示值、渲染滤波网格等都不得直接进入 WotbTools 的展示或领域模型。

## 缺字段怎么办

后端或前端需要的回放字段，一律向上游 Rust Core 要（直接改上游、发版、升级 `deploy/agent/source.json`），
不在客户端启发式推导，也不在服务端解析。已知待补项见 [client-replay-engine-migration.md](client-replay-engine-migration.md)。
