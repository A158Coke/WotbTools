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
- **结构线 / 内部细节**：默认 silhouette-only（真实几何凸包）；内部结构线仅在
  extractor 显式支持后按真实网格输出，禁止凭空添加。
- **禁止堆砌**：road wheels、track links、微小舱盖、微小机械结构——20–30px 下只会形成噪声
  （extractor 默认排除 chassis_wheel_* 与 *_hide_elements*）。
- 阵营（friendly/enemy）、选中、录像者、阵亡、最后已知全部由运行时 UI overlay 表达，
  禁止烘焙进 SVG（同现有 tank-marker PNG 契约）。

## 6. 几何来源与简化规则（替代 AI 手绘路线）

- **silhouette 必须来自真实 geometry**（extractor 俯视投影 + 分组凸包），禁止 AI 重新设计 silhouette。
- 允许确定性几何简化：凸包分组（hull+tracks / turret / gun 分别投影）与路径输出；
  tolerance 明确由 extractor 参数控制（凸包点即输出点，不做美化）。
- 禁止添加现实模型中不存在的结构（hatch / grille / muzzle brake 等一律不添加）。
- 内部结构线、履带细节等：仅当真实网格提供且经 extractor 显式支持才输出；默认 silhouette-only。
- 颜色保持 neutral vehicle asset contract（hull/turret 中性灰阶，tracks neutral，不承担阵营色）。

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
    "method": "collision-glb-topdown-projection",
    "viewBox": "0 0 320 320",
    "hullBounds": { "min": [-1.86, -4.44], "max": [1.86, 4.6] },
    "turretBounds": { "min": [...], "max": [...] },
    "gunBounds": { "min": [...], "max": [...] },
    "notes": "确定性提取自 BlitzKit model.glb（hull + tracks + selected turret/gun 节点）"
  }
}
```

- 顶层键只能是 `modelKey / kind / source / turretPivot / generation` 5 个（validator 拒绝多余键）。
- `source.provider`：正式资产（mapping 内 modelKey）必须为 `blitzkit`；`source.tankId` 必须为正整数；
  `collisionModel` / `modelDefinitions` 必须为 http(s) URL。
- `generation.method`：正式资产必须为 `collision-glb-topdown-projection`。
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
