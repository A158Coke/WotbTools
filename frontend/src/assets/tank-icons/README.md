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

- `hullYaw` / `turretRelativeYaw` / `turretWorldYaw` 已接入播放器：DTO 提供
  `directionSamples`，`BattlePlayback.vue` 用四张运行时素材渲染双层标记
  （hull 按 `hullYawDeg`、turret 按 `turretWorldYawDeg` 独立旋转，共同 pivot 256,256）。
- 阵亡（`pb-destroyed`）：敌我一致——双层素材冻结在最后可信方向（无方向样本时以素材默认 0° 渲染，
  不代表真实朝向），整体 opacity .35 + grayscale(1) 去饱和，叠加同款 ✕；为独立 UI 状态，
  不并入 `pb-last-known`。
- 历史轨迹只代表车辆曾经的位置，不代表车体或炮塔朝向。
- 最后已知状态只使用透明灰，不添加时钟图标。
- 录像者、选中、低血量、阵亡、悬停属于 UI overlay，不烘焙进基础 sprite。
- 推荐地图显示尺寸为 `28px`（移动端 22px）；阵营色由四张基础 sprite 表达，选中、低血量、阵亡、悬停和
  录像者标记由消费组件的独立 UI 覆盖层表达。
- **有效可见尺寸（2026-08-14 起）**：素材 512×512 含大量透明留白（实测有效车体 bbox ≈210×336，
  炮塔层 ≈162×323），`BattlePlayback.vue` 将两层 img 放大到按钮的 131% 并以共同 pivot 居中旋转
  （`translate(-50%,-50%) rotate(...)`）——桌面 28px 容器下有效可见车体 ≈15×24px，地图缩放时
  标记屏幕尺寸恒定、不再显得过小。改素材时保持画布中心 pivot 与留白比例，否则需同步该缩放系数。
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
