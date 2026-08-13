# 战局回放坦克标记

AI Review「战局回放」的俯视坦克标记素材契约。最终方案为**通用半立体 MT 双层模型**：
可独立旋转的透明车体层与透明炮塔层（炮塔外壳 + 完整炮管为刚性整体）。

## 运行时素材

- `tank-marker-friendly-hull.png` / `tank-marker-friendly-turret.png`：友军暖金车体与完整炮塔层。
- `tank-marker-enemy-hull.png` / `tank-marker-enemy-turret.png`：敌军青蓝车体与完整炮塔层。

四张文件均为 `512 × 512` RGBA 真透明 PNG，0° 时车头和炮口朝上。炮塔外壳与完整炮管是
不可拆分的刚性整体，禁止增加独立炮管层。友军与敌军版本来自同一套 alpha 蒙版；敌军素材是
对暖金基材的确定性换色，不依赖未经校验的运行时 CSS filter。

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
- 推荐地图显示尺寸为 `28px`；阵营色由四张基础 sprite 表达，选中、低血量、阵亡、悬停和
  录像者标记由消费组件的独立 UI 覆盖层表达。
- 无障碍名称与车辆状态由消费组件提供；地图上的装饰性实例应设置 `aria-hidden="true"`。

## 设计与验收源（非运行时资产）

车体与炮塔的唯一同源基材位于
[`docs/assets/battle-replay/tank-marker-authoritative-master.png`](../../../../docs/assets/battle-replay/tank-marker-authoritative-master.png)。
运行时四张素材均从该 master 拆层、归一化到统一画布；禁止分别生成或替换其中一层。

状态、姿态、层级和尺寸规范位于
[`docs/assets/battle-replay/tank-marker-state-spec.png`](../../../../docs/assets/battle-replay/tank-marker-state-spec.png)，
四方向旋转、双阵营、28px 深浅背景与叠层效果的导出验收板位于
[`docs/assets/battle-replay/tank-marker-runtime-verification.png`](../../../../docs/assets/battle-replay/tank-marker-runtime-verification.png)。
以上图片只用于设计和实现校验，不应由运行时加载。
