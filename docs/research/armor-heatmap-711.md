# Kranvagn 跳弹续飞噪点：#711 修复证据

> **2026-10-20 P0 清理后的状态**：20 µm 共面容差 / `compareContinuationHitOrder` 模块优先 / GPU cell 游标保留与候选 variant 过滤 / `primaryResultRT` 单样本 RT / `moduleInFront` discard / 炮管跳过 `EXTERNAL_FRAG` / `shotOverlayScene` 均已移除。真正保留的是 gun_mask 负侧炮管裁剪及其在点击/续飞/JS/GPU/HE 五路的一致应用；同时完成 P1 清理（可见性向上遍历、gun 拆件不再算 gunBarrel、0mm Primary 合法、空概率链 fail-closed）。以下正文保留为历史证据，不再描述当前实现。

2026-10-20，基线 `ef46adcc9d4e86dd68c5fd7830c7201407e437e1`。

## 根因与修复

首板身份保持 `turret_01_armor_1`、triangle 32。CPU 判穿而 GPU 有时无续飞。
把 GPU 实际跳弹起点和反射方向读回后交给 CPU，仍判穿；去掉 Primary 深度预通道
作单次写入 A/B，7 个点的分类不变。因此本 PR 只修求交，不重构显示管线；合并分支另按
MSAA 混色问题引入单样本 `primaryResultRT`（见 `armor-inspector-mixed-color-investigation.md`），
与分类修复相互独立。

KRV 炮管模块与炮盾板有共面表面。DDA 消费模块后原先执行
`tCur = bestT + ADVANCE_EPSILON`（0.1 mm），把距离相同或紧邻的 Primary 一并跳过。
浮点舍入改变模块/Primary 的先后顺序，造成稳定表面内部的绿紫交替。
现在在候选阶段过滤已消费模块 variant，模块消费后保留 cell 游标，继续寻找其它候选。
完全同距时统一先消费外部模块、再处理装甲，GPU/CPU/点击续飞不依赖 pack 顺序。
仅靠精确相等（`tHit == bestT`）不够——同一表面点的距离会带浮点噪声；追加的
20 µm 同距容差见下方 2026-10-20 追加节。没有板名特判、厚度优先、邻域涂色；
模块仍扣穿深并计入层预算。
同时修正 `bestT=hi` 时拒绝恰好命中 cell 窗口上界的问题。

输入与状态修复：5 px 内微动不再瞄准；复制矩阵数值检测姿态变化，所有通道前统一
准备网格，失败统一禁用；点击前更新源矩阵，续飞反射使用实际入射射线。
法线、片元计算与网格边界全程 highp。原始诊断见 [本机测试](../frontend/local-testing.md)。

## 固定样本

- 资产源：`https://wotbtools.com/agent-assets`，取公开 JSON/GLB 后由临时本地服务器提供，
  不改变模型、板厚或配置；原始跨域访问会被浏览器拒绝。
- tank=4481，config=0，shell=0（实际 AP），穿深 250 mm、伤害 410。
- yaw=1.8282649919926826°，pitch=10°，az=90°，dist=14，h=2.4。
- viewport=2552×1227 CSS px，DPR=1；canvas=(240,0)，2297×1227。
- 7 个 viewport CSS 点：`(1670,608), (1669,608), (1671,608), (1670,607),
  (1670,609), (1637,563), (1717,638)`。
- GPU 原始板/三角形身份保持一致；续飞层链包含 70 mm 炮盾。50 mm 炮管只在 `gun_mask` 裁切面之前计入——2026-10-20 修正：该样本的炮管命中点在裁切面负侧（见下方追加节），已剔除。

| 数值验证 | 修复前（已统一姿态和 highp） | 修复后 |
|---|---|---|
| 7 点 GPU cls | 0,0,1,1,1,1,0 | 1,1,1,1,1,1,1 |
| 7 点 CPU cls（像素中心及 GPU 实际输入） | 全部 1 | 全部 1 |
| CSS (1666,604) 起 9×9 连续 ROI | 未记录整块基线 | 81/81 cls=1；同输入 CPU/GPU 零差异 |

ROI 的同步四通道+CPU 读回约 807 ms，是诊断墙钟耗时，不能冒充热力图 GPU 帧耗时。
本 PR 的生产路径没有新增 render pass/持久 RT（合并分支的单样本显示缓冲另计）。APCR 由同一 GLSL 的 2° 转正夹具覆盖；KRV config 0
第二弹实际为 `hc_premium`（HEAT），不能把它记作真实 APCR 样本。

资产 SHA-256：

| 文件 | SHA-256 |
|---|---|
| tank/4481.json | c0f7efb3b687f7ab84db3993fb555a97ecdcece73053a5e19e88bccfa1e7e250 |
| glb/4481/collision.glb | 527732e6e2e51e02602711c2860a8f561fd737ce2062b0cfb88061fc449fd338 |
| glb/4481/model.glb | ae8c28af8c9ff621c3ef8a6af450b5663dce4a1795f32c56307fc4530123d8f4 |

## 2026-10-20 追加：近共面主装甲在前（红/绿）

用户固定样本：Kranvagn 4481 config 0，AP（250 mm / 410），点击 hull plate 1
（80.0° → RICOCHET）。复现输入：URL
`http://localhost:5175/?view=agent-armor&armordebug=1&dist=14&assets=&tank=4481&config=0`；
pose turret −26.703596°、gun 9.315511°；click NDC `(0.028009, −0.076174)`，
canvas 1444×935（drawing buffer 2888×1870）；相机距离 30.22 m、fov 12.06°。
**修正前的**续飞层链首两块是 Gun Barrel 50 mm 与 Gun Plate 7 70 mm：

- 命中点分别 `[0.08006643867735094, 2.123040651395192, -1.3421246211831126]` 与
  `[0.08006643867735092, 2.1230406513951916, -1.3421246211831124]`，相差 ~1e-16 m；
  法线相同 `[-0.8933431844525984, 8.3e-17, -0.4493750713959229]`，即同一表面点。
- 这两点在同一姿态下的 `gunClipPlane.distanceToPoint` = **−0.8038 m**（负侧 =
  被 `gun_mask` 裁掉的炮管后段），2026-10-20 修正后该模块命中在收集阶段即剔除。
- 修正前模块先消费：剩余 187.5 − 50 = 137.5 mm；Gun Plate 7 在 69.2° 下等效 160.85 mm
  → BLOCKED（红）。若浮点舍入让主装甲先被选中：剩余 187.5 mm > 160.85 mm →
  PENETRATED（绿），模块的 50 mm 消耗被跳过；相邻像素在这两种顺序之间翻转，
  就是红/绿混色。
- 修正后只剩 Gun Plate 7：剩余 187.5 mm > 160.85 mm → **PENETRATED**。
  该样本不再能证明“模块必须先于炮盾”的生产语义；共面排序规则改由可见模块的
  合成夹具锁定（见下）。

原 PR 的精确相等 tie-break 与 20 µm 模块优先规则已于 2026-10-20 P0 清理中移除：
`COINCIDENT_EPSILON`、`compareContinuationHitOrder`、GPU 候选 variant 过滤与 cell 游标
保留都不再存在；续飞/点击/JS/GPU 只按命中距离排序。原 KRV 样本的炮管命中在
`gunClipPlane` 负侧，已由 gun_mask 裁剪在排序前剔除。上面的 20 µm/模块优先叙述保留为
历史证据，不再代表当前实现。

## 2026-10-20 追加：gun_mask 负侧炮管不属于续飞碰撞几何

用户新样本（同一辆 Kranvagn 4481 config 0，AP 250/410）：
`turret=-25.927985°`、`gun=10°`、相机距离 12.0 m、fov 25.57°、canvas 1444×935。
跳弹点 `[0.040691, 1.274079, -2.658561]`，反射方向
`[0.088863, 0.568462, 0.817896]`。复算 `model.glb` 得到三个 `gun_01` 命中：

| 命中点 | `gunClipPlane` 距离 |
|---|---|
| `[0.163076, 2.056983, -1.532129]` | `-0.6138 m` |
| `[0.182139, 2.178929, -1.356674]` | `-0.7893 m` |
| `[0.191696, 2.240068, -1.268709]` | `-0.8773 m` |

三个点与 debug JSON 的 `ricochet.hits` 逐位一致；第一个点同时是
`gun_01_armor_7`（同一点、同一法线）。负距离说明它们全部是被裁掉的炮管后段
（炮尾/炮盾内壁），不是外露炮管。修正前点击续飞链把它当外部模块消费：

- 剩余 187.5 − 50 = 137.5 mm；Gun Plate 7 等效 136.12 mm → PENETRATION，
  但概率卡按 137.5 mm 区间算得 **67%**；
- 修正后炮管层消失，Gun Plate 7 用 187.5 mm → **100%**，确定性结果仍 PENETRATION。

实现：`isClippedModuleHit(section, point, clipPlane)` 作为唯一判据
（`section === 'gunBarrel' && plane.distanceToPoint(point) < 0`），用于
点击主判定/续飞 raycaster、JS `raycastPackAll`/`simulateContinuation` 与 HE 采样；
GPU 走 `rcClipEnabled` + `rcClipPlane`（世界系 vec4），在 `rcContinue` 候选阶段
跳过负侧 `gunBarrel` 命中。其它 section（包括 Gun Plate 7 炮盾）不受影响。
`renderSpacedArmorPass()` 每帧 `computeGunClipPlane()` 后同步 uniform，姿态/配置
变化无需额外 dirty 标记。平面按 BlitzKit `SpacedArmorScene` 的固定模型前向构造：
`maskOrigin = gun.mask + hullOrigin.y + turretOrigin.y + gunOrigin.y`，不再取炮管
世界 AABB 最长轴；模型局部 +Y 经 `matrixWorld` 变到世界前向。

## 回归与边界

既有 `browser-armor-aiming` 门禁新增微动点击、原始 ID/分类重复读回、非零跳弹
GPU/CPU 对照，以及直接执行 production GLSL 的共面/0.05 mm 间距回归：AP/APCR
转正参数 × 高/低剩余穿深 × 两种 pack 顺序，必须分别判穿/判挡。零样本不能算对照通过。
同一门禁另跑 `rcClipEnabled=1` + 世界系 `rcClipPlane`：负侧 50 mm 炮管必须被
`rcContinue` 剔除，只剩 70 mm 炮盾时 `remIn=100` 必须判穿，锁 GPU 与点击/JS 同口径。
`armorCollisionPack.test.js` 覆盖 `isClippedModuleHit` 的 section 边界、隐藏/可见炮管的
命中集合、以及 BLOCKED→PENETRATED 的层链变化。旧的 24 组共面/近共面 GLSL 用例随
20 µm/模块优先规则一起移除。
矩阵快照单测覆盖父级移动、微小变化、相机运动不失效；浏览器门禁将真实模型变为
超大几何使网格连续失败 240 次，再恢复到原成功姿态，必须无需 dirty 标记便恢复续飞。
销毁网格时清除成功姿态快照，避免误用已不存在的网格。射击就绪门禁保护首帧/换车/重试。

上述证据是原始分类与几何输入的数值验证，不是最终画面的人工验收。
需用户在实际设备检查原噪点带、相机微移、DPR/resize、HE 与模块遮挡；
9×9 ROI 不能代表整个未采样楔形区域或所有设备。
## 2026-10-20 追加：多段跳弹

跳弹后的炮弹可以再跳一次：首段跳弹后执行一段续飞（剩余穿深 ×0.75），该段首个命中层（主装甲或间隙甲，外部模块先消费时不再跳弹）可再次跳弹；第二次跳弹即终态，炮弹消失，不再做第三段判定，结果卡终态为 RICOCHET/0%。点击/JS/GPU 同口径；模块/间隙甲前置仍按 `layerIndex > 0` 抑制。结果卡的击穿概率行改到最终判定结果标题下侧。

## 2026-10-20 追加：间隙甲背面重复计层

闭合间隙甲在点击链里被正、背两面各计一次：显示材质为 DoubleSide（部分间隙屏只有单侧绕序），raycaster 因此同时返回闭合壳的内外表面。Kranvagn `gun_01_armor_9`（50mm spaced）在结果卡出现两次（52.1mm @25° / 52mm @24°），把 250mm 穿深误判为未击穿。点击/续飞命中收集现在按采样网格/BlitzKit 的 FrontSide 口径剔除 `normal·dir > 0` 的背面命中（`classifyHit.backface`，两处过滤）；显示材质仍保持 DoubleSide，HE 800 射线采样仍保留 `twoSidedSpaced` 以覆盖背面命中的间隙屏。

