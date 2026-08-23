# 产品路线图（Roadmap）

> 产品方向（非工程 checklist）。未完成的工程任务以 GitHub Issues 追踪：
> [#78](https://github.com/A158Coke/WotbTools/issues/78) 大批量回放预览性能 · [#79](https://github.com/A158Coke/WotbTools/issues/79) Excel 导出结构快照测试 ·
> [#80](https://github.com/A158Coke/WotbTools/issues/80) 版本发布清单 · [#81](https://github.com/A158Coke/WotbTools/issues/81) 用户 FAQ。
> 已完成项见 `CHANGELOG-PRODUCT.md`；技术侧变更见 `CHANGELOG.md`。

## Now

- 主线功能（回放解析与 Excel 导出 · 排行榜 · 战斗表现分析 · AI 战术复盘 · 陪练与打手管理）已上线，持续稳定性与体验优化。

## Next

- 暂无明确近期产品项。

## Later

- **战术地图编辑器**：获取 WoT Blitz 鸟瞰视角地图，允许玩家编辑创建战术图（箭头 / 标记 / 文字标注），支持导出与分享。

## Research

- **进场满血覆盖率**：已对 `OBSERVED_EXACT` 车辆使用回放实测进场满血；后续扩大可证明覆盖率，减少对车辆库基础 HP 的回退，提升战斗表现指标精度（车辆库也缺失时 fail-closed，不再硬编码 2400）。
- **潜在伤害口径**：用真实样本校验特殊伤害（殉爆 / 火烧等非 direct HP damage 场景），避免误补或漏补潜在伤害。
- **战斗表现指标回归**：用真实比赛批量样本校验贡献度 / KAST / Impact 等派生指标的分布与口径。
- **战术地图数据来源**：游戏提取 / 截图拼接 / 社区资源。

## Not planned

- 暂无明确排除项，随产品迭代补充。
