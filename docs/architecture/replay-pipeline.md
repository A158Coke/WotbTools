# 回放管线（Replay Pipeline）

> **服务器没有 parser。** 唯一的回放解析器是上游 [WoT-Blitz-Agent](https://github.com/fanypcd/WoT-Blitz-Agent)
> Rust Core，编译成 WASM 在浏览器 / Android WebView 里运行（版本与 sha256 锁定在 `deploy/agent/source.json`，
> 消费契约 `contracts/agent/replay-facets-v2.md`）。对解析结果的一切计算（去重、League Rating、指标、列投影、
> xlsx 导出、2D 回放数据）也都在客户端完成；服务端只负责存储、去重键、授权、名人堂记录与 AI 编排。
> 迁移过程见 [client-replay-engine-migration.md](client-replay-engine-migration.md)。

## 数据流

```text
.wotbreplay（用户本机，文件不上传）
    │
    ▼
上游 Rust Core WASM（/wasm/wotb_replay_wasm.js）
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
    ├── playback/                           parsePlayback (+ parseAiReview 伤害) → BattlePlaybackDataset + MapOverview
    └── submissionFacts.ts                  名人堂 / 百场 / 三环提交的结算事实
```

## 消费面

| 能力 | 入口 | 说明 |
|---|---|---|
| 回放工作台 · 数据 | `composables/useLocalReplayAnalysis.ts` | 选择文件 → Worker 解析 → 批次计算 → 表格；失败只显示原因，不回退服务端 |
| 回放工作台 · 导出 | 同上 `exportExcel(mode)` | 复用最近一次分析的批次结果，客户端生成 xlsx / zip |
| 2D 战局回放 | `components/BattlePlaybackPanel.vue` | 目标文件本机 `parseLocalPlayback`，主线程一次性解析 |
| 3D 回放 / 射击复现 / 装甲查看 | `scene/*`、`AgentShots.vue` | 直接消费 WASM 时序 / 射击切面 |
| 名人堂 / 百场 / 三环提交 | `utils/api.js` → `replay-local/submissionFacts.ts` | 本机解析得到 `Battle` 事实 JSON（`facts` 字段）+ 原始回放（证据附件） |
| 账号验证 | `ProfilePage.vue` | 本机解析出录像者 accountId，提交给 `POST /api/users/wotb-account/verify-replay` |
| Android | `useNativeReplayImport.js` | Native 只交接字节；本机分析完成后 ACK pending |

## 服务端边界

- **名人堂**（`com.wotb.web.replayfile.ClientReplayFacts`）：只做结构校验（arenaId / 录像者 / 1..64 名战斗者 /
  账号与车辆 ID / 队伍）。无法从字节验证事实——防伪造靠管理员审核与回放附件；SHA-256 去重、`(arena_id, account_id)`
  唯一键、准入策略（`HallOfFameBattleTypePolicy`）照旧作用于提交的事实。
- **账号验证**：只比较提交的录像者数值 accountId 与当前绑定账号；已验证状态只用于主页徽章，不授予权限。
- **AI 复盘**（维护中）：服务端 `ReplayFactsCodec` 只有解码方向，接收客户端投影；测试输入是冻结的
  `common/fixtures/replay-facts/*.json.gz`。恢复 AI 复盘时基于上游 `parseAiReview` 重建投影。

## 一致性基线

`frontend/src/replay-local/__golden__/` 保存服务端 Java 解析器 / 批次计算 / 导出 / 2D 回放在仓库 fixture 回放上的
最后一份输出（Java 删除前生成，只读），CI 常驻断言客户端全链路与之逐字段一致（2D 时序数据按文档化的容差）。
上游 Rust Core 升级后重新导出 `wasm-*` 文件，再跑同一组测试。

## 缺字段怎么办

后端或前端需要的回放字段，一律向上游 Rust Core 要（直接改上游、发版、升级 `deploy/agent/source.json`），
不在客户端启发式推导，也不在服务端解析。已知待补项见 [client-replay-engine-migration.md](client-replay-engine-migration.md)。
