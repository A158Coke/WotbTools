# Tier X 专属俯视车型系统（Battle Playback Vehicle Marker System V2）

> 总计划：docs/current-plan.md（PR1–PR4）。本目录是 PR1 的系统文档与资产生成交接清单。
> 当前状态：**BLITZKIT_EXTRACTION_READY（Maus 端到端通过）** —— 正式车型 SVG 由 BlitzKit
> extractor 从真实模型确定性生成；人工/ChatGPT 只做 visual QA，不绘制 geometry。

## 业务目标（一句话）

> WotBTools Tankopedia 中所有 Tier X 基础车型都拥有自己可辨识的专属俯视战术模型，
> 并在真实 Battle Playback 中使用；非 Tier X 继续使用当前通用 marker。

## 生成路线（重要变更：确定性提取，替代 AI 手绘）

```
tankId
  ↓
model.glb（BlitzKit 视觉模型，节点分层）
+ models.pb（ModelDefinition：origins / selected ids）
+ tanks.pb（默认配置：turrets/tracks/guns 数组最后）
  ↓
extract-tier-x-model.mjs（复刻 BlitzKit TankModel 节点契约 + correctZYTuple）
  ↓
真实 hull / turret / gun 几何 → 俯视投影 → 分组凸包 silhouette
  ↓
统一 fit 320×320 → hull.svg / turret.svg / metadata.json（turretPivot 自动计算）
```

**为什么不是 AI 手绘**：车型几何必须来自真实数据（结构/比例/炮塔座圈精确）；
AI 只做 visual QA；发现错误 → 修 extractor → 重新生成，禁止人工 patch SVG path。

## 系统结构

| 路径 | 职责 |
|---|---|
| `frontend/src/vehicle-models/types.js` | discriminated union 类型契约 + 统一 viewBox + metadata schema（geometry-source） |
| `frontend/src/vehicle-models/mapping.js` | 集中静态 Tank ID → baseModelKey（84 辆 → 81 组） |
| `frontend/src/vehicle-models/assets/<modelKey>/` | 正式 SVG 资产（hull.svg / turret.svg / metadata.json，extractor 生成） |
| `frontend/src/vehicle-models/validate.js` | validator（CI 与 CLI 共用；正式资产强制 source.provider=blitzkit） |
| `frontend/src/vehicle-models/coverage.test.js` | Tier X 100% 覆盖门禁（新增 Tier X 无 mapping → CI FAIL） |
| `frontend/src/vehicle-models/pivot.js` | 图层旋转数学（transform-origin = pivot） |
| `frontend/src/vehicle-models/extractor.test.js` | extractor 契约测试（坐标/fit/资产/确定性，CI 不联网） |
| `frontend/src/components/VehicleModelPreviewPage.vue` | 隐藏 admin QA 页（`?view=vehicle-models`，仅 wotbtools-admin；异步 chunk） |
| `frontend/scripts/extract-tier-x-model.mjs` | **BlitzKit 车型提取器**（`--tank-id` / `--model-key`，唯一网络点） |
| `frontend/scripts/extractor-lib.mjs` | 提取纯函数库（correctZYTuple / 凸包 / fit / SVG / metadata） |
| `frontend/scripts/protos/models.proto` | BlitzKit model_definitions.proto（官方字段号，勿改） |
| `frontend/scripts/check-bundle-separation.mjs` | 构建后 bundle 分离检查 |
| `frontend/scripts/blitzkit-references.mjs` | inventory + 参考图下载（kind 核验依据） |
| `frontend/scripts/validate-vehicle-models.mjs` | CLI validator（资产自检） |
| `frontend/scripts/.vehicle-model-refs/` | BlitzKit 数据缓存（gitignored：model.glb / models.pb / tanks.pb / 参考图） |
| `docs/assets/tier-x-models/svg-generation-spec.md` | 全局 SVG 生成规范（正式文档） |
| `docs/assets/tier-x-models/tier-x-inventory.md` | 84 辆 Tier X inventory（脚本生成） |
| `docs/assets/tier-x-models/manual-draft/` | AI 手绘时代草稿（仅历史参考，不参与正式流程） |

## 提取器用法

```bash
cd frontend
node scripts/extract-tier-x-model.mjs --model-key maus        # 生成 assets/maus/
node scripts/extract-tier-x-model.mjs --tank-id 6929         # 等价
node scripts/extract-tier-x-model.mjs --model-key maus --force  # 刷新 BlitzKit 缓存
node scripts/extract-tier-x-model.mjs --model-key maus --out-dir ../tmp/maus  # 试运行
```

网络失败显式报错（[FAIL]），**不 fallback** 到 AI 生成或 placeholder。
production / Battle Playback / backend / CI 均不访问 BlitzKit（任务 17）。

## BlitzKit 模型契约（源码 + Maus 实测，2026-08-17）

- **模型源是 `model.glb`**（`/tanks/{id}/model.glb`）：视觉模型，节点分层契约（复刻 TankModel.tsx）：
  `hull`（精确名）+ `chassis_track_{L,R}` + `chassis_wheel_*` → hull 层；`turret_{model_id:02d}` → turret 层；
  `gun_{model_id:02d}` + `gun_{model_id:02d}_mask` → gun 层；`*_hide_elements*` 排除。
  （注意：`collision.glb` 是装甲碰撞网格 `{part}_armor_{N}`，不含 track/wheel，**不是**车型分层模型。）
- **坐标**：GLB 顶点 = 模型坐标（x宽 / y长 forward=+y / z高）；models.pb origin = 引擎坐标（x宽 / y高 / z长 forward=-z）；
  `correctZYTuple(x,y,z) = (x, z, y)`（BlitzKit useTankTransform 复刻）；俯视投影 = (x, y)，SVG y = -y（车头朝 12 点）。
- **默认配置**（BlitzKit tankToDuelMember）：`tank.turrets.at(-1)` / `turret.guns.at(-1)` / `tank.tracks.at(-1)`。
- **silhouette（Blocker 1）**：projected triangle polygon union（polygon-clipping）——保留全部凹轮廓与洞；
  convex hull 已禁用（会把 Maus 压成矩形）。`*_hide_elements*` 子树排除；`gun_{id}_mask`（mantlet 炮盾）
  归入 turret 层（静态 0° 属于炮塔正面轮廓），gun 层仅炮管。
- **结构细节（Layer B，2026-08-17）**：top-facing major surfaces（法线 z 阈值 + 高度层聚类 → 区域色块，
  含主甲板/屋顶/裙板层）+ major structural edges（surface-edge 平台边缘 / height 高度差 / normal 辅助，
  全部 ≥ minEdgeLenM 且经屏幕空间过滤 minDetailPx=0.8 ≈ 1px@28px）——Maus hull.svg 含履带独立区域、
  主甲板层（带真实炮塔座圈凹口）、前装甲带与 28 条结构边；turret.svg 含屋顶层、炮盾独立区域与炮管。
  阈值通用（非 Maus 专属），见 metadata.generation.detailThresholds。
- **turretPivot**：`turret_origin` → correctZYTuple → 投影 → 同一 fit 变换（与 hull/turret.svg 完全相同），自动计算，无人工猜测。

## Asset Handoff（生成交接清单）

### A. Tier X inventory

84 辆完整清单（tankId / display name / baseModelKey / turreted|turretless / class / nation /
kind 核验依据 / BlitzKit 参考链接）见 `tier-x-inventory.md`（脚本从 Tankopedia + mapping.js 生成，权威）。
3 组合并（skin/特殊版本复用基础模型）：`sheridan` / `kpz-70` / `type-5-heavy`。

**kind 核验（全 81 modelKey 逐组完成）**：官方 tankopedia / fandom wiki / 结构知识；
修正 3 项：minotauro → turreted、foch-155 → turretless、xm66f → turreted。每行依据见 inventory 表。

**视觉确认待定（confirmPending，contract 未冻结）**：SPHT (29985)、AC Teichos (22129)、
NC 70 Błyskawica (19585)——生成前须对照 BlitzKit 模型确认 kind（这三辆不在第一批生成清单内）。

### B. 目标路径

```
frontend/src/vehicle-models/assets/<modelKey>/
├── hull.svg          # extractor 生成
├── turret.svg        # 仅 turreted；extractor 生成
└── metadata.json     # extractor 生成（source.provider=blitzkit）
frontend/scripts/.vehicle-model-refs/                      # gitignored 数据缓存
frontend/src/vehicle-models/mapping.js                     # mapping（已就绪，勿改）
docs/assets/tier-x-models/svg-generation-spec.md           # 全局规范（已就绪）
```

### C. SVG contract

统一 `viewBox="0 0 320 320"`；0° = 车头朝 12 点；hull 中心 = (160,160)；
turret 绕 metadata `turretPivot` 旋转；neutral 灰阶；长炮管允许溢出（Maus 已实测）；
禁止 script/foreignObject/外部引用/独立 gun 层。**完整规则见 `svg-generation-spec.md`。**

### D. Metadata schema（geometry-source，任务 12）

顶层 5 键：`modelKey / kind / source / turretPivot / generation`；
`source.provider` 正式资产必须为 `blitzkit`（validator 强制）；`generation.method` 必须为
`blitzkit-model-topdown-extraction`。示例：`assets/maus/metadata.json`（Maus 实样）。

### E. Mapping contract

`types.js` discriminated union：`TurretedVehicleModelAsset { modelKey, kind:'turreted', hull, turret, turretPivot }` |
`TurretlessVehicleModelAsset { modelKey, kind:'turretless', hull }`。mapping 已含 84 辆 → 81 组，**生成时不要改 mapping**。

### F. BlitzKit data

- 模型：`https://api.blitzkit.app/tanks/{tankId}/model.glb`（extractor 下载缓存）。
- 定义：`https://api.blitzkit.app/definitions/models.pb` + `tanks.pb`（缓存）。
- 参考图：`https://api.blitzkit.app/tanks/{tankId}/icons/big.webp`（缓存已下载 84 张，QA 用）。

### G. Validation commands（资产生成后）

```bash
node frontend/scripts/validate-vehicle-models.mjs   # 全量自检（含 source 契约，退出码门禁）
cd frontend && npm test                             # CI 同口径（coverage + validate + extractor）
cd frontend && npm run build && node scripts/check-bundle-separation.mjs  # bundle 分离
```

### H. 第一批生成建议（8 辆，结构差异最大化，全部非 confirmPending）

| modelKey | tankId | 覆盖结构 |
|---|---|---|
| maus | 6929 | giant heavy，宽大方形车体（**已生成，端到端证据**） |
| leopard-1 | 14609 | narrow medium，细长车体 + 长炮 |
| grille-15 | 19217 | turreted TD，后置炮塔 + 超长炮管（溢出验证） |
| ho-ri | 3937 | turretless casemate TD（固定战斗室） |
| minotauro | 10369 | limited-traverse 后置炮塔 TD |
| xm66f | 28705 | 前置 non-fully-rotating turret TD |
| fv4005 | 18001 | 巨大炮塔（barn） |
| sheridan | 20257 | light tank，导弹变体共享（21793 同模型） |

批 1 视觉语言稳定后再生成剩余 73 组（含 3 个 confirmPending 车型需先确认 kind）。

## 状态流转

```
BLITZKIT_EXTRACTION_READY（当前：Maus 端到端通过）
  → 人工/ChatGPT visual QA Maus（admin 预览页验证 pivot/方向/结构）
  → 修 extractor（如需要）→ 重新生成 Maus
  → Maus Gate 通过 → 小批量车型自动生成 → 人工 QA
  → Tier X 全覆盖（ASSET_GENERATION_COMPLETE，CI 全绿 + admin 全车型可预览）
  → PR1 合入 → PR2 Battle Playback 集成 → PR3 状态视觉重设计 → PR4 标签与碰撞
```

## 变更记录

- PR1（本 PR）：inventory / mapping / kind 核验 / validator / coverage CI / admin 预览 /
  **BlitzKit extractor（确定性提取替代 AI 手绘）** / Maus 端到端资产 / 全局 spec / metadata geometry-source schema。
- 之后 PR（计划 §55）：PR2 dedicated models in Battle Playback；PR3 状态视觉重设计；
  PR4 玩家/坦克标签与碰撞。
