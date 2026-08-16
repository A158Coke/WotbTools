# Tier X 专属俯视车型 SVG — 全局生成规范（Global Generation Spec）

> 本文是仓库正式文档：车型 SVG 由 **BlitzKit extractor 确定性生成**（`frontend/scripts/extract-tier-x-model.mjs`），
> 几何必须来自真实模型（model.glb + models.pb），**禁止 AI / 人工绘制 geometry**。
> 人工/ChatGPT 只做 visual QA；发现错误 → 修 extractor → 重新生成，禁止人工 patch SVG path。
> 系统总览与生成交接见同目录 `README.md`。

## 1. 文件结构与分层契约

```
frontend/src/vehicle-models/assets/<modelKey>/
├── hull.svg          # 必填
├── turret.svg        # 仅 turreted；turret + 完整炮管 = 刚性 layer
└── metadata.json     # 必填（与资产同批就位）
```

- 禁止独立 `gun.svg` / gun layer（炮管永远属于 turret 或 hull）。
- turretless 车型只有 `hull.svg`，gun 直接属于 hull；**禁止为了统一代码伪造 turret**。
- 目录内不允许出现任何其他文件（validator 拒绝）。

## 2. SVG 技术契约（validator 强制）

- 根元素 `<svg>`，统一 `viewBox="0 0 320 320"`（所有车型固定，禁止改）。
- 禁止：`<script>`、`<foreignObject>`、`<image>`、`xlink:href`、`onload/onerror`、
  外部 `href="https?://..."`。
- 不需要 `width/height` 属性（运行时按容器缩放）。
- 不需要 `overflow` 属性；渲染层允许溢出可见，长炮管可以超出 viewBox。
- 文件编码 UTF-8；标签闭合（`<svg>` 与 `</svg>` 各恰好一个）。

## 3. 坐标与朝向契约

- 0° = hull 车头朝 12 点（屏幕上方）；turret / gun 朝车体正前。
- **hull 中心 = viewBox 中心 (160, 160)**；hull 绕画布中心旋转。
- turret 使用车型自己的真实 turret-ring pivot：metadata.json 的 `turretPivot`，
  viewBox 绝对坐标（x 向右、y 向下，左上 (0,0)）。
- 渲染时 hull 绕 (160,160) 旋转；turret 绕 `turretPivot` 旋转（pivot 平移 + rotate）。
- pivot 与车体/炮塔的几何关系必须真实：旋转 0° 时炮塔正确覆盖炮塔座圈，
  90°/180°/270° 旋转不得绕圈或漂移。

## 4. 画布与视觉重量

- 车辆主体（hull + 履带）应稳定位于标准画布内，充分利用 320×320；
  **禁止运行时按 bounds 自动缩放**——视觉重量来自真实几何的比例本身：
  - Maus 仍然宽、重；Leopard 1 仍然细长；比例由 extractor 从真实模型保持。
- 炮管允许略微超出 viewBox；超出部分不参与 label collision bounds 与 click hitbox。

## 5. 视觉语言（所有车型统一）

- **模型本体完全中性**，不承担阵营语义：hull 用 neutral tone（灰阶系），
  turret 用与 hull 略有不同的 neutral brightness，差异必须克制。
- **Tracks**：真实履带网格随 hull 层投影，neutral，不承担 team color。
- **结构线 / 内部细节**：全部来自真实网格（extractor 显式支持），禁止凭空添加。
- **不按 20–30px 过滤真实 detail**：小尺寸可读性由未来 runtime LOD 处理，
  asset 本身保留信息（extractor 默认排除 chassis_wheel_* 与 *_hide_elements*）。
- 阵营（friendly/enemy）、选中、录像者、阵亡、最后已知全部由运行时 UI overlay 表达，
  禁止烘焙进 SVG（同现有 tank-marker PNG 契约）。

## 6. 几何来源与 fidelity 规则（HIGH-FIDELITY ASSET，替代 AI 手绘路线）

> **Asset fidelity first. Runtime readability handled later.**
> 正式资产 = 高保真俯视资产（真实比例 + visible top-view structure 默认保留），
> Battle Playback 小尺寸显示由未来 runtime LOD 决定（本 PR 不实现 runtime LOD）。

- **几何比例必须忠实**（faithful geometry scale）：hull 长宽比 / track 宽度 / turret 尺寸与位置 /
  gun 长度 / mantlet / hatch / cupola / deck feature 位置与相对尺寸全部来自真实模型投影。
  禁止 intentional exaggeration（放大炮塔 / 缩短车体 / 加宽炮管 / 移动 hatch 等一切人工改比例）。
- **silhouette 必须来自真实 geometry**（projected triangle polygon union，保留凹轮廓与洞），
  禁止 convex hull 回退、禁止 AI 重新设计 silhouette。
- **细节默认保留**（visible top-view structural detail retention target ≥ 90%）：
  真实 top-view 可见结构默认保留；只删除 sub-pixel 微小 / hidden / internal / duplicate /
  LOD & extraction artifact / 极小 bolt-hook-handle / 单个微小 track tooth / 无视觉贡献的 mesh seam。
- **视觉表面合并**（mergeVisualSurfaces，Blocker 1/2/4）：model.glb 的 triangle tessellation /
  low-poly topology 按「共享 3D 边 + 法线差 ≤ mergeAngleDeg(20°) + 高度差 ≤ mergeHeightDeltaM(0.4m)」
  合并为视觉连续表面——连续 roof / deck / 环带斜面是一个/少量 polygon，绝不输出三角马赛克
  （Maus turret ring 61 面 → 6 表面、roof 297 面 → 34 表面、deck 205 面 → 79 表面；
  合并后再经遮挡过滤 → turret 19 表面、hull 31 表面）。
  只有真实结构分离才拆：height step / vertical wall / physical gap / node boundary /
  strong normal discontinuity / isolated raised-recessed feature。
- **遮挡过滤**（filterOccludedSurfaces）：俯视可见性 = 顶层优先——被更高处表面完全覆盖的
  hidden geometry（甲板下方的裙板固定件等）剔除；部分可见的表面保留。
- **凸起/面板**：真实 hatch / cupola / 台阶带 / 面板 = 合并后与主面分离的独立表面
  （自然分离，无需 zMean 切斜面）；不做 relative-ratio 过滤（真实 hatch 只占屋顶 3–5% 也保留）。
- **结构边**：真实 component / height / normal boundary 默认保留（无数量上限）；
  删除 duplicate / overlapping / tessellation 对角线 / 内部三角剖分线。
  surface-edge 需要显著壁高（> heightDeltaM）——低模斜面网格的面片台阶壁不算。
- **detail-level grouping**：SVG 按 <g class="vehicle-primary / vehicle-secondary /
  vehicle-micro-detail"> 分组输出，为未来 runtime LOD 准备结构（primary = silhouette/tracks/
  body/mantlet/gun/大型 deck-roof；secondary = 大型 hatch/cupola/vents/engine deck plates/
  major panel boundaries；micro = 小型 hatch/small roof features/minor structures）。
- **simplifyRing 退化修复**：polygon-clipping 输出的 ring 可能含相邻/闭合重复点，先去重再简化，
  防止真实角点被误删导致带状结构塌成细条/发丝线；asset-space 过滤基于简化后的 ring。
- **绘制顺序**：hull = 轮廓 → 主面（按 z 升序）→ 履带（深色侧带）→ 结构边。
- 阈值全集记录在 metadata.json 的 generation.detailThresholds（非 Maus 专属）。

## 7. metadata.json 契约（geometry-source schema，任务 12）

```json
{
  "modelKey": "maus",
  "kind": "turreted",
  "source": {
    "provider": "blitzkit",
    "tankId": 6929,
    "collisionModel": "https://api.blitzkit.app/tanks/6929/model.glb",
    "modelDefinitions": "https://api.blitzkit.app/definitions/models.pb"
  },
  "turretPivot": { "x": 160, "y": 193.23 },
  "generation": {
    "method": "blitzkit-model-topdown-extraction",
    "fidelity": "high",
    "geometryScale": "faithful",
    "visibleDetailRetentionTarget": 0.9,
    "viewBox": "0 0 320 320",
    "hullBounds": { "min": [-1.86, -4.44], "max": [1.86, 4.6] },
    "turretBounds": { "min": [...], "max": [...] },
    "gunBounds": { "min": [...], "max": [...] },
    "detailMethod": "top-surface-and-major-edge-extraction",
    "detailThresholds": { ... },
    "notes": "确定性提取自 BlitzKit model.glb（HIGH-FIDELITY：真实比例 + visible structure 默认保留）"
  }
}
```

- 顶层键只能是 `modelKey / kind / source / turretPivot / generation` 5 个（validator 拒绝多余键）。
- `source.provider`：正式资产（mapping 内 modelKey）必须为 `blitzkit`；`source.tankId` 必须为正整数；
  `collisionModel` / `modelDefinitions` 必须为 http(s) URL。
- `generation.method`：正式资产必须为 `blitzkit-model-topdown-extraction`。
- **HIGH-FIDELITY 契约（正式资产强制）**：`generation.fidelity='high'`、
  `geometryScale='faithful'`、`visibleDetailRetentionTarget ∈ (0,1]`（contract target，非测量值）。
- `turretPivot`：turreted 必填、x/y ∈ [0, 320]；turretless 禁止。
- 完整校验见 `frontend/src/vehicle-models/validate.js`（validateMetadata）。
## 8. 文件命名与 modelKey

- modelKey 全部 kebab-case（`^[a-z0-9]+(?:-[a-z0-9]+)*$`），以
  `frontend/src/vehicle-models/mapping.js` 的 `MODEL_DEFINITIONS` 为准。
- 文件名固定：`hull.svg` / `turret.svg` / `metadata.json`，大小写敏感。

## 9. 生成与验收

生成：

```bash
cd frontend && node scripts/extract-tier-x-model.mjs --model-key <modelKey>
```

放回仓库后运行：

```bash
node frontend/scripts/validate-vehicle-models.mjs   # 全量自检（与 CI 同逻辑）
cd frontend && npm test                             # CI 同口径
```

CI（coverage.test.js + validate.test.js + extractor.test.js）强制：Tier X 100% mapping 覆盖、
metadata source 契约、SVG 技术契约、turreted/turretless 资产完整性、turretPivot 稳定性。
CI 不访问 BlitzKit 网络（任务 17）。
