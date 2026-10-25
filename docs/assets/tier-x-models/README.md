# Tier X 专属俯视车型系统（Battle Playback Vehicle Marker System V2）

> 本目录是 Tier X 车型系统的文档与资产生成规范。
> 当前状态：正式资产 = Source-faithful PBR top-view WebP（BlitzKit LOD0 geometry + 内嵌纹理确定性 bake）；
> Battle Playback 已集成 dedicated models（VehicleMarker + 战局级 preload + 单车 fallback；非 Tier X 继续 generic）；
> 旧 SVG 仅 Legacy/debug extractor 产物。baker 从真实模型确定性生成；人工/ChatGPT 只做
> visual QA，不绘制 geometry。

## 业务目标（一句话）

> WotBTools Tankopedia 中所有 Tier X 基础车型都拥有自己可辨识的专属俯视战术模型，
> 并在真实 Battle Playback 中使用；非 Tier X 继续使用当前通用 marker。

## 生成路线（正式：texture bake，替代 AI 手绘 / 旧 SVG extractor）

```
tankId
  ↓
model.glb（BlitzKit 视觉模型，节点分层）
+ models.pb（ModelDefinition：origins / selected ids）
+ tanks.pb（默认配置：turrets/tracks/guns 数组最后）
  ↓
bake-tier-x-topview.mjs（复刻 BlitzKit 节点契约 + correctZYTuple + z-buffer bake）
  ↓
hull.webp（640×640 physical / 320×320 logical）
+ turret.webp（turreted：turret + mantlet + 完整炮管，raster overflow contract）
+ metadata.json（turretPivot / turretRaster 自动计算）+ bake-report.json
```

**为什么不是 AI 手绘**：车型几何必须来自真实数据（结构/比例/炮塔座圈精确）；
AI 只做 visual QA；发现错误 → 修 baker → 重新生成，禁止人工 patch 单车资产。

## 系统结构

| 路径 | 职责 |
|---|---|
| `frontend/src/vehicle-models/types.js` | discriminated union 类型契约 + 统一 viewBox + metadata schema（Source-faithful PBR） |
| `frontend/src/vehicle-models/mapping.js` | 集中静态 Tank ID → baseModelKey（83 组；confirmPending 已全部清零，2026-09-08） |
| `frontend/src/vehicle-models/assets/<modelKey>/` | **正式 WebP 资产**（hull.webp / turret.webp / metadata.json / bake-report.json，baker 生成） |
| `frontend/src/vehicle-models/validate.js` | validator（CI 与 CLI 共用；正式资产强制 source.provider=blitzkit + method=texture-bake） |
| `frontend/src/vehicle-models/coverage.test.js` | Tier X 100% 覆盖门禁（新增 Tier X 无 mapping → CI FAIL） |
| `frontend/src/vehicle-models/pivot.js` | 图层旋转数学（嵌套 transform：assembly 绕车辆中心 + image 绕 raster 内 pivot） |
| `frontend/src/vehicle-models/extractor.test.js` | extractor 契约测试（坐标/fit/资产/确定性，CI 不联网） |
| `frontend/src/vehicle-models/texture-bake.test.js` | bake 纯函数契约 + **raster 方向回归（RASTER_Y_AXIS_CONTRACT）** |
| `frontend/src/components/VehicleMarker.vue` | **生产 Battle Playback 正式单车 marker**（dedicated/generic 渲染 + hull/turret 旋转） |
| `frontend/src/vehicle-models/runtime.js` | **生产 runtime 资产解析**（tankId→modelKey→资产、战局级 preload、单车 fallback；动态 import 保 bundle 分离） |
| `frontend/scripts/bake-tier-x-topview.mjs` | **正式 baker**（`--model-key` / `--tank-id`，唯一网络点；依赖 python + PIL） |
| `frontend/scripts/texture-bake-lib.mjs` | bake 纯函数库（z-buffer / barycentric UV / alpha test / Y-flip 投影 / 中性化） |
| `frontend/scripts/extract-tier-x-model.mjs` | **Legacy/debug extractor**（SVG 输出仅供开发者 visual QA，非正式资产） |
| `frontend/scripts/extractor-lib.mjs` | 提取纯函数库（correctZYTuple / 凸包 / fit / SVG） |
| `frontend/scripts/protos/models.proto` | BlitzKit model_definitions.proto（官方字段号，勿改） |
| `frontend/scripts/check-bundle-separation.mjs` | 构建后 bundle 分离检查（CI 强制） |
| `frontend/scripts/check-webp-orientation.mjs` | 正式 WebP 方向校验（developer-only，python + PIL） |
| `frontend/scripts/blitzkit-references.mjs` | inventory + 参考图下载（kind 核验依据） |
| `frontend/src/assets/tank-portraits/tier-x/<tankId>.webp` | Details Panel 车型透视图（85 辆 Tier X，BlitzKit big icon） |
| `frontend/src/vehicle-portraits/runtime.js` | Details Panel 按 tankId 懒加载 + 缺图静默降级 |
| `frontend/scripts/validate-vehicle-models.mjs` | CLI validator（资产自检） |
| `frontend/scripts/.vehicle-model-refs/` | BlitzKit 数据缓存（gitignored：model.glb / models.pb / tanks.pb / 参考图 / debug PNG） |
| `docs/assets/tier-x-models/svg-generation-spec.md` | 全局资产生成规范（正式 WebP 契约 + Legacy/debug extractor） |
| `docs/assets/tier-x-models/tier-x-inventory.md` | 85 辆 Tier X inventory（脚本生成） |

## Baker 用法（正式资产）

```bash
cd frontend
node scripts/bake-tier-x-topview.mjs --model-key maus        # 生成 assets/maus/
node scripts/bake-tier-x-topview.mjs --tank-id 6929          # 等价
node scripts/bake-tier-x-topview.mjs --model-key maus --out-dir ../tmp/maus  # 试运行
```

网络失败显式报错（[FAIL]），**不 fallback** 到 AI 生成或 placeholder。
production / Battle Playback / backend / CI 均不访问 BlitzKit。
依赖 python + PIL（仅 developer 环境；CI 不执行 baker）。

## BlitzKit 模型契约（源码 + Maus 实测，2026-08-17）

- **模型源是 `model.glb`**（`/tanks/{id}/model.glb`）：视觉模型，节点分层契约（复刻 TankModel.tsx）：
  `hull`（精确名）+ `chassis_track_{L,R}` + `chassis_wheel_*` → hull 层；`turret_{model_id:02d}` → turret 层；
  `gun_{model_id:02d}` + `gun_{model_id:02d}_mask` → gun 层。
  （注意：`collision.glb` 是装甲碰撞网格 `{part}_armor_{N}`，不含 track/wheel，**不是**车型分层模型。）
- **坐标**：GLB 顶点 = 模型坐标（x宽 / y长 forward=+y / z高）；models.pb origin = 引擎坐标（x宽 / y高 / z长 forward=-z）；
  `correctZYTuple(x,y,z) = (x, z, y)`（BlitzKit useTankTransform 复刻）；俯视投影 = (x, y)。
- **方向契约（RASTER_Y_AXIS_CONTRACT）**：raster projection 做 Y flip——**model +Y → 图片 top**
  （0° = 车头/炮管朝 12 点）；hull.webp 与 turret.webp 同一 orientation；logical 坐标与 raster 一致
  （`logicalY = -modelY * scale + ty`）；`turretRaster.pivotX/pivotY` 指向 WebP 内真实座圈像素。
- **默认配置**（BlitzKit tankToDuelMember）：`tank.turrets.at(-1)` / `turret.guns.at(-1)` / `tank.tracks.at(-1)`。
- **turretPivot**：`turret_origin` → correctZYTuple → 投影 → 同一 fit 变换，自动计算，无人工猜测。

## Asset Handoff（生成交接清单）

### A. Tier X inventory

85 辆完整清单（tankId / display name / baseModelKey / turreted|turretless / class / nation /
kind 核验依据 / BlitzKit 参考链接）见 `tier-x-inventory.md`（脚本从 Tankopedia + mapping.js 生成，权威）。
2 组合并（skin/特殊版本复用基础模型）：`sheridan` / `kpz-70`。`type-5-heavy` 与 `type-5-h-zetsu` 使用不同真实 BlitzKit source asset。

**kind 核验（全 83 modelKey 逐组完成）**：官方 tankopedia / fandom wiki / 结构知识；
修正 3 项：minotauro → turreted、foch-155 → turretless、xm66f → turreted。每行依据见 inventory 表。

**confirmPending 已全部清零（2026-08-19，contract 冻结）**：AC Teichos (22129)、NC 70
Błyskawica (19585) 与 SPHT (29985) 均经 BlitzKit 真实模型数据确认 **turreted** 并生成正式资产——
SPHT / AC Teichos：GLB turret_01 + gun_01 + gun_01_mask、models.pb turret 模块无 yaw 限位；
NC 70 Błyskawica：GLB turret_01 为 1-triangle stub（casemate 主体在 hull_nc_01，属 hull 层；
旋转层实际 = gun_01 + gun_01_mask，yaw ±10° limited-traverse，同 grille-15 处理）。
三车 turretPivot 均通过 scene-graph 独立反推验证（err≤0.0002m，见 scripts/verify-pivot-independent.mjs）。

Zmije (23425) 经 BlitzKit 当前真实数据确认 **turreted**：GLB 含 `turret_01`、`gun_01_mask`、
`gun_01`，`tanks.pb` 选择 turret=33409、gun=38785，`models.pb` 提供可解析的
`turretOrigin`；已由正式 baker 生成 hull/turret WebP 与 metadata/bake-report。

### B. 目标路径（正式）

```
frontend/src/vehicle-models/assets/<modelKey>/
├── hull.webp          # 必填（640×640 physical / 320×320 logical）
├── turret.webp        # 仅 turreted（turret + mantlet + 完整 gun，raster overflow contract）
├── metadata.json      # 必填（source.provider=blitzkit；method=blitzkit-model-topdown-texture-bake）
└── bake-report.json   # 必填（生成记录：modules/bounds/pivot/rasterOrientation/bytes）
frontend/scripts/.vehicle-model-refs/                      # gitignored 数据缓存
frontend/src/vehicle-models/mapping.js                     # mapping（已就绪，勿改）
docs/assets/tier-x-models/svg-generation-spec.md           # 全局规范（已就绪）
```

### C. 正式资产契约

统一 320×320 logical（viewBox `0 0 320 320`）；0° = 车头朝 12 点（model +Y → 图片 top）；
hull 绕画布中心 (160,160) 旋转；turret 装配随 hull 旋转（座圈 P' = C + rotate(P-C, H)），
turret image 绕 metadata `turretRaster.pivotX/pivotY`（image-local）旋转
`(turretWorldDeg - hullDeg)`——最终 world yaw = turretWorldDeg；长炮管允许溢出（raster overflow
contract，turret.webp 画布 = turret+mantlet+完整 gun 的 logical bounds）。
**完整规则见 `svg-generation-spec.md`。**

### D. Metadata schema（Source-faithful PBR top-view asset）

顶层键：`modelKey / kind / source / turretPivot / turretRaster / generation`
（turretPivot + turretRaster 仅 turreted；validator 拒绝多余键）；
`source.provider` 正式资产必须为 `blitzkit`（validator 强制）；`generation.method` 必须为
`blitzkit-model-topdown-texture-bake`。示例：`assets/maus/metadata.json`（Maus 实样）。

### E. Mapping contract

`types.js` discriminated union：`TurretedVehicleModelAsset { modelKey, kind:'turreted', hull, turret, turretPivot, turretRaster }` |
`TurretlessVehicleModelAsset { modelKey, kind:'turretless', hull }`。mapping 已含 85 辆 → 83 组，**生成时不要改 mapping**。

### F. BlitzKit data

- 模型：`https://api.blitzkit.app/tanks/{tankId}/model.glb`（baker 下载缓存）。
- 定义：`https://api.blitzkit.app/definitions/models.pb` + `tanks.pb`（缓存）。
- 参考图：`https://api.blitzkit.app/tanks/{tankId}/icons/big.webp`（缓存已下载 85 张，QA 用）。
- Type 5 变体证据：8033 使用 turret/gun/track `12641/12129/13921` 与 `J20_Type_2605_*`；9057 使用 `13921/13921/15457` 与 `J39_Type_5_Exp_*`，两者 turret raster 分别为 `185×466` 与 `210×488`，因此必须使用独立 modelKey/资产。

Details Panel 的车型图由
`node frontend/scripts/blitzkit-references.mjs --emit-portraits` 从同一 `big.webp` 端点确定性生成到
`frontend/src/assets/tank-portraits/tier-x/` 并提交；production 不访问 BlitzKit。

### G. Validation commands（资产生成后）

```bash
node frontend/scripts/validate-vehicle-models.mjs   # 全量自检（含 source 契约，退出码门禁）
cd frontend && pnpm test                             # CI 同口径（coverage + validate + extractor + bake 方向回归）
cd frontend && pnpm run build && node scripts/check-bundle-separation.mjs  # bundle 分离（CI 强制）
cd frontend && node scripts/check-webp-orientation.mjs                     # 真实 WebP 方向校验（developer-only）
```

### H. 生成范围（83 个正式资产，confirmPending = 0）

83 个 modelKey 已生成正式 WebP 资产（maus / leopard-1 / grille-15 / fv4005 / ho-ri / minotauro /
xm66f / sheridan 等结构差异最大化组 + 其余批量组；spht / ac-teichos / nc-70-blyskawica 于
2026-08-19 BlitzKit 数据确认 turreted 后加入，无 pending）。

**turretPivot source-of-truth**：yaw 旋转中心 = BlitzKit useTankTransform 契约——
`modelPivot = correctZYTuple(trackOrigin) + correctZYTuple(turretOrigin)`（hullOrigin + turretOrigin
向量和；运行时 `turretPosition = R_init(R_yaw(-modelPivot)) + modelPivot`）。bake-report 记录
`pivotSource`（origins + modelPivot）供 invariant 测试与审计；initial_turret_rotation 只影响
初始朝向角，不影响顶视 pivot。`scripts/verify-pivot-independent.mjs` 通过独立 scene-graph 反推验证
当前 turreted 资产的 pivot，不依赖待验证的 `computeTurretModelPivot` 结果。