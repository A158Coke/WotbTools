# 产品路线图（Roadmap）

> 这里只记录尚未完成或仍在研究的产品方向。已完成的历史演进见 `../HISTORY.md`；具体工程任务以 GitHub Issues / Pull Requests 为准。

## Now

- 迁移 Replay 解析权威到客户端 Replay Engine：上游 [WoT-Blitz-Agent](https://github.com/fanypcd/WoT-Blitz-Agent) Rust Core 的 WASM 产物（版本与 sha256 锁定在 `deploy/agent/source.json`，消费契约 `contracts/agent/replay-facets-v2.md`）。当前只有三维回放与射击复现消费客户端结果；Replay Workspace（数据解析 / 战局回放 / 导出）与 Hall of Fame 仍走服务端 Replay Processing 链路，在客户端 parity 全部通过前继续服务生产。
- 持续降低 Replay 事实模型中的 UNKNOWN / heuristic 范围，但只在存在可验证证据时提升语义等级。
- 完成当前认证入口与生产身份配置的稳定化，保持普通用户通过受控 IdP 登录。

## Next

- 暂无需要在 Roadmap 中冻结的近期大型产品项；具体执行工作以 GitHub Issues / Pull Requests 为准。

## Later

- **战术地图编辑器**：基于现有地图资产与语义数据，允许玩家制作箭头、标记和文字战术图，并支持导出与分享。

## Research

- **进场满血覆盖率**：继续用真实 Replay 扩大可证明覆盖率，减少车辆基础 HP fallback；证据不足时保持 fail-closed。
- **Replay Protocol**：继续将逆向结论收敛到 Canonical Replay Facts；未证明字段保持 UNKNOWN 或 version-gated。
- **AI Review 质量**：继续扩展 Evidence Contract、Evaluation Harness 与回归案例，避免把外部知识或模型推断当成 Replay 事实。

## Not planned

- 不重新建立已经退役的代练业务。
- 不恢复已退役的战斗表现派生指标列（`contribution` / `kast` / `impact` / `alpha_damage` /
  `traded_deaths`）作为跨场公共列：它们是 average-of-per-battle 型复合指标，与
  「跨场比率先累计总量再相除」的口径冲突；账号 / 车辆 ID（`account_id` / `tank_id`）也不再
  作为公共列，改由响应行结构化身份字段承载。汇总表现只保留 `multi_damage_rate`。
- 不在客户端 Replay Engine 之外保留第二套 Replay Parser：解析权威是上游 Agent Rust Core（Web 与 Android 共用同一引擎）；仓库内曾经的 `replay-engine/` 移植已于 2026-09-30 退役，不再恢复；服务端解析执行平面（`parser-worker`、parser MQ 拓扑）随迁移退役，不再作为长期 authority。
- 服务端不重新承担 Replay 解析执行：服务端只保留 schema validation / dedup / authorization / 共享状态与 AI 编排。
- 不维护第二套 Rating 事实源或 AI 专用解析链。
