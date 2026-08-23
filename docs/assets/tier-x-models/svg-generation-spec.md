# Tier X 专属俯视车型资产 — 全局生成规范（Global Generation Spec）

> **正式契约（2026-08-19 迁移，PR91 Review 收敛）**：车型资产 = **Source-faithful PBR top-view
> asset**（texture-baked RGBA WebP，由 `frontend/scripts/bake-tier-x-topview.mjs` 确定性生成）。
> 视觉信息全部来自 BlitzKit `model.glb` 的真实 LOD0 geometry + 内嵌材质/纹理
> （baseColor / normal / occlusion / alpha），**禁止 AI / 人工绘制 geometry / 纹理**、
> 禁止 intentional exaggeration、禁止 fake detail。
> 几何上限 = BlitzKit/WoTB LOD0 source；runtime 可读性由 PR2 LOD/outline/label 解决。
> 旧 `hull.svg / turret.svg`（extractor CLI 输出）仅为 **Legacy/debug extractor** 产物，不属于正式契约。

## 1. 文件结构与分层契约（正式）

```
frontend/src/vehicle-models/assets/<modelKey>/
├── hull.webp         # 必填（固定 640×640 physical / 320×320 logical，RGBA 透明背景）
├── turret.webp       # 仅 turreted；turret + mantlet + 完整炮管 = 刚性 layer；physical 尺寸可变
├── metadata.json     # 必填（Source-faithful PBR 契约，validator 强制）
└── bake-report.json  # 必填（生成记录：modules/bounds/pivot/orientation/bytes）
```

- **尺寸契约（RASTER_SIZE_RUNTIME_CONTRACT）**：hull.webp **固定 640×640**（320 logical）；
  turret.webp physical canvas **尺寸可变**（按 turret + mantlet + complete gun bounds 动态扩展），
  authoritative size / placement / pivot 一律来自顶层 `metadata.turretRaster`——
  runtime 与后续 PR2 禁止假设 turret.webp 是 640×640（例：Grille 15 为 160×1010）。
- turretless 车型只有 `hull.webp`，gun/mantlet/casemate 已 bake 进 hull；**禁止为了统一代码伪造 turret**。
- 目录内不允许出现任何其他文件（validator 拒绝）。
- bake 契约：turreted = hull 场景（hull + tracks）+ turret 场景（selected turret + mantlet + gun）
  独立 z-buffer/bake（旋转 turret 不暴露 hull 空洞）；turretless = 单 hull 场景（全部结构）。
- **raster overflow contract（RASTER_GUN_CLIPPING 修复）**：hull.webp 固定 640×640
  （320 logical 画布）；turret.webp 画布 = turret + mantlet + **完整 gun** 的 logical bounds
  （保持同一 fit.scale，主体不缩放；透明 canvas 可超出 320 画布，避免长炮管裁切）。
  metadata 记录 **顶层** `turretRaster`（logicalMin/Max、pixelWidth/Height、pivotX/pivotY——
  pivot 相对 turret.webp 原点的逻辑坐标；authoritative runtime geometry contract，generation
  内禁止重复）；runtime 加载 turret 层时按 raster 原点定位 + raster 内 pivot 旋转。
- 模块选择数据驱动（tanks.pb + models.pb：turrets/tracks/guns 数组最后），不依赖 display name。

## 2. 坐标与朝向契约（正式，RASTER_Y_AXIS_CONTRACT）

- 模型坐标：x=宽、y=长（**forward=+y**）、z=高（GLB 顶点；models.pb origin 经 correctZYTuple）。
- **model +Y（车头/炮管 forward 端）→ 图片 top（screen up）**：raster projection 做 Y flip
  （`pixelY = (bounds.maxY - modelY) * scale`），与 logical 坐标一致（`logicalY = -modelY * scale + ty`）。
- **hull.webp 与 turret.webp 使用同一 orientation**（0° = 车头/炮管朝 12 点）。
- **hull 中心 = viewBox 中心 (160, 160)**；hull 绕画布中心旋转 hullWorldDeg。
- turret 使用车型自己的真实 turret-ring pivot：metadata.json 的 `turretPivot`（viewBox 绝对坐标）。
- **OFF_CENTER_TURRET_HULL_COMPOSITION（嵌套 transform，禁止 translate 平移近似）**：
  - P = turretPivot，C = 车辆中心 (160,160)，H = hull world rotation；
  - hull 旋转后炮塔座圈屏幕位置 `P' = C + rotate(P - C, H)`——座圈随车体围绕 C 移动，
    不是固定不动的 screen point（非中心炮塔：Grille 15 后置 pivot 等）；
  - turret assembly 父层：`rotate(H)` around C；turret image 子层：
    `rotate(turretWorldDeg - H)` around image-local pivot（raster.pivotX/pivotY）——
    最终 turret world yaw = authoritative turretWorldDeg；
  - 旋转数学统一在 `frontend/src/vehicle-models/pivot.js`（改数学先改 pivot.test.js）。

## 3. metadata.json 契约（正式）

顶层键只能是 `modelKey / kind / source / turretPivot / turretRaster / generation`
（validator 拒绝多余键；turretPivot + turretRaster 仅 turreted）。

```json
{
  "modelKey": "maus",
  "kind": "turreted",
  "source": {
    "provider": "blitzkit",
    "tankId": 6929,
    "modelGlb": "https://api.blitzkit.app/tanks/6929/model.glb",
    "modelDefinitions": "https://api.blitzkit.app/definitions/models.pb"
  },
  "turretPivot": { "x": 160, "y": 193.23 },
  "turretRaster": {
    "logicalMinX": 112.19, "logicalMinY": -19.64, "logicalMaxX": 207.81, "logicalMaxY": 267.24,
    "pixelWidth": 191, "pixelHeight": 574, "pivotX": 47.81, "pivotY": 212.87
  },
  "generation": {
    "method": "blitzkit-model-topdown-texture-bake",
    "viewBox": "0 0 320 320",
    "hullPhysicalPixelSize": [640, 640],
    "hullBounds": { "min": [-1.8601, -4.4380], "max": [1.8601, 4.5955] },
    "turretBounds": { "min": [-1.5338, -3.5188], "max": [1.5338, 1.0040] },
    "gunBounds": { "min": [-0.2543, 1.0314], "max": [0.2429, 5.6839] },
    "selectedModules": { "turretId": 11537, "gunId": 266513, "trackId": 14609 },
    "texturesUsed": ["Maus_mtr", "Maus_track_mtr"],
    "desaturate": 0.25,
    "fidelity": "high",
    "geometryScale": "faithful",
    "visibleDetailRetentionTarget": 0.9,
    "notes": "Source-faithful PBR top-view asset：真实 LOD0 geometry + 内嵌纹理确定性 bake"
  }
}
```

> 示例数值 = **真实 Maus 资产**（assets/maus/ 当前 bake 输出）：turretRaster 是 expanded
> raster（191×574 px，logical bounds 超出 320 画布）——不是 640×640，不是画布全覆盖。

- `source.provider`：正式资产（mapping 内 modelKey）必须为 `blitzkit`；`source.tankId` 正整数；
  `modelGlb`（视觉 model.glb，非 collision.glb）/ `modelDefinitions` 必须为 http(s) URL。
- `generation.method`：正式资产必须为 `blitzkit-model-topdown-texture-bake`。
- `generation.hullPhysicalPixelSize`：hull.webp 固定 physical 尺寸 `[640, 640]`；
  turret.webp 的尺寸请读 `turretRaster.pixelWidth/pixelHeight`（variable-size canvas，
  **不得**从 generation 推断 turret 尺寸）。
- **fidelity 契约（正式资产强制）**：`generation.fidelity='high'`、`geometryScale='faithful'`、
  `visibleDetailRetentionTarget ∈ (0,1]`（visual QA target，非几何保留保证）。
- **desaturate 语义**（Blocker 3 修复）：`neutralize` 的 amount = 去色强度（0=原色，1=纯灰），
  公式 `rgb*(1-amount) + luma*amount`；bake 默认 `0.25` = 75% 原色 + 25% luma。
- `turretPivot`：turreted 必填、x/y ∈ [0, 320]；turretless 禁止。
- `turretRaster.pivotX/pivotY` 必须指向 WebP 内真实 turret ring pixel（raster 与 logical
  同一坐标系后由 bake 直接给出；校验见 validate.js 与 check-webp-orientation.mjs）。
- 完整校验见 `frontend/src/vehicle-models/validate.js`（validateMetadata）。

## 4. 画布与视觉重量（正式）

- 车辆主体（hull + 履带）稳定位于标准画布内，充分利用 320×320；
  **禁止运行时按 bounds 自动缩放**——视觉重量来自真实几何的比例本身。
- 炮管允许略微超出 viewBox；超出部分不参与 label collision bounds 与 click hitbox。

## 5. 视觉语言（正式 bake 语义）

- 模型本体完全中性：真实纹理经 luminance / restrained desaturation（0.75 原色 + 0.25 luma）
  保留局部对比（grille/panel/vent/AO/relief），不制造阵营色。
- 阵营（friendly/enemy）、选中、录像者、阵亡、最后已知全部由运行时 UI overlay 表达，
  禁止烘焙进资产（同 tank-marker PNG 契约）。
- 无 dynamic light / shadow / reflection / gloss / outline / fake bevel。

## 6. 生成与验收（正式）

生成（baker，唯一网络点 = BlitzKit developer CLI；依赖 python + PIL）：

```bash
cd frontend
node scripts/bake-tier-x-topview.mjs --model-key maus          # 生成 assets/maus/
node scripts/bake-tier-x-topview.mjs --tank-id 6929            # 等价
node scripts/bake-tier-x-topview.mjs --model-key maus --out-dir ../tmp/x  # 试运行
```

放回仓库后运行：

```bash
node frontend/scripts/validate-vehicle-models.mjs              # 全量自检（与 CI 同逻辑）
cd frontend && npm test                                        # CI 同口径
cd frontend && npm run build && node scripts/check-bundle-separation.mjs
cd frontend && node scripts/check-webp-orientation.mjs         # 真实 WebP 方向校验（developer-only）
```

CI（coverage.test.js + validate.test.js + extractor.test.js + texture-bake.test.js）强制：
Tier X 100% mapping 覆盖、metadata source/method 契约、资产完整性、turretPivot 稳定性、
**raster 方向（RASTER_Y_AXIS_CONTRACT 指纹）**。CI 不访问 BlitzKit 网络。

---

## Legacy/debug extractor（非正式契约）

> 以下内容仅描述旧的 debug 工具链（`extract-tier-x-model.mjs` + SVG 输出），
> 输出 `hull.svg / turret.svg` 只用于开发者 visual QA 对比，**不是正式资产契约**。
> 正式资产一律走 §1–§6 的 texture bake 管线。

- 提取：`tankId → model.glb + models.pb + tanks.pb → 节点分组 → 俯视投影 → 分组凸包 silhouette
  → fit 320×320 → hull.svg / turret.svg / metadata.json`（debug 输出到 gitignored 缓存）。
- 节点契约：`hull` + `chassis_track_{L,R}` + `chassis_wheel_*` → hull 层；`turret_{model_id:02d}` →
  turret 层；`gun_{model_id:02d}` + `gun_{model_id:02d}_mask`（mantlet 归 turret 层）→ gun 层；
  `*_hide_elements*` 子树**保留**（属于真实视觉模型——BlitzKit 实际渲染，audit 2026-08-19
  源码确认；最终可见性由真实 z-buffer 决定）。
- SVG 技术细节（validator 不校验 SVG——正式资产已无 SVG）：统一 viewBox 320×320、
  禁止 script/foreignObject/外部引用、detail-level grouping（vehicle-primary/secondary/micro-detail）。
- 生成命令（仅 debug）：`node scripts/extract-tier-x-model.mjs --model-key <modelKey>`。
