# Tier X 专属俯视车型 SVG — 全局生成规范（Global Generation Spec）

> 本文是仓库正式文档：未来 ChatGPT / AI 重新生成或修复车型时**唯一**的全局规则来源。
> 单车型 metadata.json 只记录车型特异内容，禁止每辆车复制一整份大 prompt（计划 §40）。
> 系统总览与交接清单见同目录 `README.md`。

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
  小尺寸车型（如 Leopard 1 细长车体）允许加宽比例以保可辨（见 §6），
  但**禁止运行时按 bounds 自动缩放**——视觉重量由设计阶段归一化：
  - Maus 仍然宽、重；Leopard 1 仍然细长；但 20–30px 下都必须可识别。
- 炮管允许略微超出 viewBox；超出部分不参与 label collision bounds 与 click hitbox。

## 5. 视觉语言（所有车型统一）

- **模型本体完全中性**，不承担阵营语义：hull 用 neutral tone（灰阶系），
  turret 用与 hull 略有不同的 neutral brightness，差异必须克制。
- **Tracks**：保留简化左右履带轮廓，neutral，不承担 team color。
- **结构线**：每车大约只保留 1–3 个真正有辨识价值的结构特征，例如：
  turret contour、engine deck、特征装甲分区、特殊 casemate / superstructure。
- **禁止堆砌**：road wheels、track links、微小舱盖、微小机械结构——20–30px 下只会形成噪声。
- 阵营（friendly/enemy）、选中、录像者、阵亡、最后已知全部由运行时 UI overlay 表达，
  禁止烘焙进 SVG（同现有 tank-marker PNG 契约）。

## 6. 小尺寸辨识度（优先级高于严格真实比例）

为辨识度允许（每车在 metadata.json 的 `intentionalExaggeration` 里如实记录）：

- 适度夸张 hull 长宽比；
- 强化典型 turret 轮廓；
- 适度调整 gun 长度；
- 强化车型最有代表性的结构；
- 舍弃小尺寸无意义细节。

**但必须基于真实车型参考**（BlitzKit 参考图/页面），不允许凭印象随便画。
`metadata.json` 必须记录：BlitzKit 参考、3–5 个 top-down distinctive features、
为 20–30px 做过的 intentional exaggeration、model-specific generation notes、
必须保留/禁止丢失的结构。

## 7. metadata.json 契约

```json
{
  "modelKey": "maus",
  "kind": "turreted",
  "blitzkitReference": "https://api.blitzkit.app/tanks/6929/icons/big.webp",
  "turretPivot": { "x": 160, "y": 165 },
  "distinctiveFeatures": ["宽大方形车体", "厚重前甲", "后置引擎甲板"],
  "intentionalExaggeration": ["加宽车体保证小尺寸辨识度"],
  "generationNotes": "……",
  "mustKeepStructures": ["……"]
}
```

- `kind`：`turreted`（必须 `turretPivot`）/ `turretless`（禁止 `turretPivot`）；
  必须与 `frontend/src/vehicle-models/mapping.js` 中该 modelKey 的声明一致。
- `turretPivot`：x/y ∈ [0, 320] 的有限数字。
- `blitzkitReference`：http(s) URL；`""` 仅允许契约样例（sample）。
- 顶层键只能是上表 8 个，禁止自定义键（validator 拒绝）。
- 完整 schema 与示例见 `frontend/src/vehicle-models/assets/sample/metadata.json`。

## 8. 文件命名与 modelKey

- modelKey 全部 kebab-case（`^[a-z0-9]+(?:-[a-z0-9]+)*$`），以
  `frontend/src/vehicle-models/mapping.js` 的 `MODEL_DEFINITIONS` 为准。
- 文件名固定：`hull.svg` / `turret.svg` / `metadata.json`，大小写敏感。

## 9. 验收

放回仓库后运行：

```bash
node frontend/scripts/validate-vehicle-models.mjs   # 全量自检（与 CI 同逻辑）
```

CI（`frontend/src/vehicle-models/coverage.test.js` + `validate.test.js`）强制：
Tier X 100% mapping 覆盖、metadata 契约、SVG 技术契约、turreted/turretless 资产完整性。
