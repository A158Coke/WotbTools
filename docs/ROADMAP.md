# 产品路线图（Roadmap）

> 这里只记录尚未完成或仍在研究的产品方向。已完成的历史演进见 `../HISTORY.md`；具体工程任务以 GitHub Issues / Pull Requests 为准。

## Now

- 稳定当前 Replay Workspace、AI Review、Battle Playback、Hall of Fame 与分布式 Replay Processing 生产链路。
- 持续降低 Replay 事实模型中的 UNKNOWN / heuristic 范围，但只在存在可验证证据时提升语义等级。
- 完成当前认证入口与生产身份配置的稳定化，保持普通用户通过受控 IdP 登录。

## Next

- 暂无需要在 Roadmap 中冻结的近期大型产品项；具体执行工作以 GitHub Issues / Pull Requests 为准。

## Later

- **战术地图编辑器**：基于现有地图资产与语义数据，允许玩家制作箭头、标记和文字战术图，并支持导出与分享。

## Research

- **进场满血覆盖率**：继续用真实 Replay 扩大可证明覆盖率，减少车辆基础 HP fallback；证据不足时保持 fail-closed。
- **战斗表现指标回归**：使用真实比赛批量样本验证贡献度、KAST、Impact 等派生指标的分布与口径。
- **Replay Protocol**：继续将逆向结论收敛到 Canonical Replay Facts；未证明字段保持 UNKNOWN 或 version-gated。
- **AI Review 质量**：继续扩展 Evidence Contract、Evaluation Harness 与回归案例，避免把外部知识或模型推断当成 Replay 事实。

## Not planned

- 不重新建立已经退役的代练业务。
- 不恢复 TX 本地 Replay Parsing；生产 Replay Processing 保持 Control Plane / Parser Worker 分离。
- 不维护第二套 Replay Parser、Rating 事实源或 AI 专用解析链。
