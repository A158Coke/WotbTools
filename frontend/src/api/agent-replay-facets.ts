/**
 * WoT-Blitz-Agent 回放数据消费接口（契约 v2：独立能力，无 giant envelope）。
 *
 * 契约 SSOT：`contracts/agent/replay-facets-v2.md`。能力边界（评审裁决）：
 *   Agent Rust Core = 结果解释（BattleResult）+ 时序解释（PlaybackData / AI 事件）
 *   WotBTools = 消费/编排；名人堂（HoF）是 WotBTools 产品域——从 Result 投影，
 *   Agent 公开面不感知（v1 的 HofFacet / `{playback,ai,hof}` 信封已拆除，breaking）。
 *
 * 五条消费路径（全部本地 WASM，文件不出本机；WotBTools Playback 拓扑 client-only）：
 *  1. `parseAgentResultFromBytes`   → BattleResult（毫秒级，不物化 Playback）
 *  2. `parseAgentPlaybackFromBytes` → PlaybackData（时序）
 *  3. `parseAgentShotsFromBytes`    → 全员射击链（射击复现）
 *  4. `parseAgentAuthorInitialPositionFromBytes` → 录像者初始世界位姿（独立轻量 probe）
 *  5. `validateAgentRecorderCamera` → 录像者相机状态（独立入口，3D 录像者视角消费）
 *  5. `projectHoF(result)`          → HoF 提交行（Result 的消费方投影，纯函数）
 * 预解析 JSON 通道（`*FromJson`）用于部署面静态托管的同形状文件。
 *
 * AI 事件数据（AiReviewFacet v1，`parseAiReview`）：本模块只建模与做形状校验；
 * 语义投影在 `replay-local/canonical`（WotbTools canonical facts）——Agent DTO 不是
 * WotbTools 的领域契约。
 *
 * 语义原则：unknown ≠ 0 ≠ false —— 观测缺失一律 undefined/null；
 * 数值零只在该字段语义就是零时出现。本模块不修改上游形状，只做形状校验与装载。
 */

// ---------- 模块拆分（LOC 预算）：单一公共入口不变，实现按能力域分文件 ----------
export * from './agent-facets/resultTypes.js'
export * from './agent-facets/playbackTypes.js'
export * from './agent-facets/aiTypes.js'
export * from './agent-facets/shotTypes.js'
export * from './agent-facets/validation.js'
export * from './agent-facets/wasm.js'
export * from './agent-facets/shots.js'
export * from './agent-facets/hof.js'
