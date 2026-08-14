# 产品路线图（Roadmap）

> 产品方向（非工程 checklist）。未完成的工程任务以 GitHub Issues 追踪（见 PR 描述 Recommended GitHub Issues）。
> 已完成项见 `CHANGELOG-PRODUCT.md`；技术侧变更见 `CHANGELOG.md`。

## Now

- 主线功能（回放解析与 Excel 导出 · 排行榜 · 实时评分 Rating V2 · AI 战术复盘 · 陪练与打手管理）已上线，持续稳定性与体验优化。

## Next

- 暂无明确近期产品项。

## Later

- **战术地图编辑器**：获取 WoT Blitz 鸟瞰视角地图，允许玩家编辑创建战术图（箭头 / 标记 / 文字标注），支持导出与分享。

## Research

- **精确 average_hp 数据源**：从回放解析每车实际进场血量 / 双方总血量，替代当前「车辆库无 HP 时暂定 2400」的近似，提升实时 rating 精度。
- **潜在伤害口径**：用真实样本校验特殊伤害（殉爆 / 火烧等非 direct HP damage 场景），避免误补或漏补潜在伤害。
- **rating 参数回归**：用真实比赛批量样本导出 rating 分布，微调权重与封顶值。
- **战术地图数据来源**：游戏提取 / 截图拼接 / 社区资源。

## Not planned

- 暂无明确排除项，随产品迭代补充。
