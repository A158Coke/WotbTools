from pathlib import Path

plan = Path('docs/current-plan.md')
text = plan.read_text(encoding='utf-8')
section = '''# Battle Playback 2.5D Vehicle Terrain Attitude

## 状态

IMPLEMENTED — READY FOR PR REVIEW

## 范围

- 保持现有 2D hull/turret 与 Tier X dedicated top-view assets，不引入 3D 坦克模型。
- 复用 2.5D authoritative terrain heightfield，在车辆 footprint 的前/后/左/右采样地面高度。
- hull yaw 仅负责把 terrain slope 转到车辆局部轴；pitch/roll 只作用于 `.pb-graphics`。
- HP、标签、hitbox、selected/recorder、碰撞布局继续 screen-aligned，不随车体倾斜。
- 视觉 pitch/roll 做轻度放大并分别 clamp ±14° / ±10°；不伪造 replay Z。

## 验收

- [x] 上坡/下坡可见车头抬起/下压；横坡可见轻微 roll。
- [x] flat terrain = 0° attitude。
- [x] marker 真实 footprint 继续来自现有 `vehicleMarkerSizing` SSOT。
- [x] 无 heightfield 或无可靠 hull yaw 时退化为原 2D marker，不猜方向。
- [x] targeted unit tests 覆盖 pitch/roll/clamp 与 graphics-only transform。

---
'''
if not text.startswith('# Battle Playback 2.5D Vehicle Terrain Attitude'):
    plan.write_text(section + text, encoding='utf-8')

changelog = Path('docs/CHANGELOG.md')
text = changelog.read_text(encoding='utf-8')
bullet = '- **Battle Playback 2.5D 车辆地形姿态**：复用 terrain heightfield 与现有真实车辆 footprint，在车辆局部前/后/左/右采样地面高度并计算受限 pitch/roll；只倾斜 hull/turret 视觉层，HP/标签/hitbox/碰撞布局继续保持屏幕对齐，无 heightfield 或无可靠朝向时退化为原平面 marker。\n'
if bullet not in text:
    text = text.replace('## [Unreleased]\n\n', '## [Unreleased]\n\n### Battle Playback\n' + bullet + '\n', 1)
    changelog.write_text(text, encoding='utf-8')
