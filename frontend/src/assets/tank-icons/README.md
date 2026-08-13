# 战局回放坦克标记

AI Review「战局回放」的俯视坦克标记素材契约。最终方案为**通用半立体 MT 双层模型**：
可独立旋转的透明车体层与透明炮塔层（炮塔外壳 + 完整炮管为刚性整体）。

## 运行时素材（唯一事实源）

- `tank-marker-hull.png`：车体层，`512 × 512` RGBA 真透明 PNG，车头朝上（0° 基准）。
- `tank-marker-turret.png`：炮塔层，`512 × 512` RGBA 真透明 PNG；炮塔外壳与完整炮管是
  不可拆分的刚性整体，禁止独立炮管层，炮口朝上（0° 基准）。

两层使用相同画布与旋转轴：

- 旋转中心统一为画布中心 `(256, 256)`，叠加时两层左上角重合。
- 车体层按 `hullYaw` 旋转；炮塔层按 `turretWorldYaw` 旋转，其中
  `turretWorldYaw = hullYaw + turretRelativeYaw`。
- 只旋转完整炮塔层；禁止只旋转炮管、修正炮管角度或让炮管与炮塔外壳分离。
- 0° 组合必须正确覆盖炮塔座；90°/180°/270° 旋转不得绕圈或漂移。

## 接入契约（未来播放器变更）

- `hullYaw` / `turretRelativeYaw` / `turretWorldYaw` 是**未来播放器接入契约**：
  当前 PR #71 的 DTO 尚未提供这些方向字段，`BattlePlayback.vue` 仍使用圆点标记，
  本素材合入后不会被播放器自动使用；实际接入、方向字段与双层旋转属于后续播放器变更。
- 历史轨迹只代表车辆曾经的位置，不代表车体或炮塔朝向。
- 最后已知状态只使用透明灰，不添加时钟图标。
- 录像者、选中、低血量、阵亡、悬停属于 UI overlay，不烘焙进基础 sprite。
- 推荐地图显示尺寸为 `28px`；阵营色、选中、低血量、阵亡、悬停和录像者标记由消费组件以
  CSS 滤镜或独立 UI 覆盖层表达。
- 无障碍名称与车辆状态由消费组件提供；地图上的装饰性实例应设置 `aria-hidden="true"`。

## 状态规范表（设计参考，非运行时资产）

状态、姿态、层级和尺寸规范原图位于
[`docs/assets/battle-replay/tank-marker-state-spec.png`](../../../../docs/assets/battle-replay/tank-marker-state-spec.png)，
只用于设计和实现校验，不应由运行时加载。

> ⚠️ 当前提交的 `tank-marker-hull.png` / `tank-marker-turret.png` 尚未通过同源/旋转/边缘校验
> （缺少 authoritative master：两层存在几何漂移、炮管触边与座圈不匹配），且规范表文件当前已损坏
> （IDAT 截断）。合入前需基于最终 master 重新生成同源双层素材并更新规范表。
