# Information-Loss Audit — Maus model.glb（真实 GLB 数据实测）

> 2026-08-19 · 前置 blocker `VISUAL_DETAIL_FIDELITY_INSUFFICIENT` 的取证审计。
> 所有数字均来自实际缓存的 BlitzKit `model.glb`（`frontend/scripts/.vehicle-model-refs/models/6929.glb`，
> 3.36MB，hash 与 PR head 一致）与其内嵌纹理解码，无猜测。
> 审计脚本（gitignored debug 目录）：`_inspect-glb*.mjs` / `_dump-geometry.mjs` /
> `_dump-hide-tagged.mjs` / `_textured-render.py` / `_svg-compare.py` /
> `_final-audit.py` / `_boundary-split.py`；渲染产物 `_textured-topview-320.png` /
> `_svg-raster-320.png` / `_audit-composite.png`（gt | svg | 边缘覆盖红=缺绿=命中）。

## 1. 视觉细节到底存在哪里（GLB 实际内容）

| 维度 | 实测 |
|---|---|
| 节点/网格 | 77 节点；37 个单 primitive mesh（均名 `RenderBatch`）；180 accessor |
| 三角形总数 | 6,513（含 `mask_01` 重复 mesh 518）；BlitzKit 实际渲染 5,835（`mask_01` 不在 TankModel 任何 layer） |
| 材质 | 2 个：`Maus_mtr`（OPAQUE）、`Maus_track_mtr`（MASK cutoff 0.05，doubleSided） |
| 纹理 | **8 张全内嵌 WEBP**：Maus_mtr = baseColor 2048² + normal 1024² + metallicRoughness 2048² + occlusion 2048²（828KB/160KB/1.08MB/783KB）；Maus_track_mtr = baseColor 256² RGBA(alpha) + normal/MR/occlusion 256² |
| 顶点属性 | 全部 primitive：POSITION + NORMAL + TEXCOORD_0；车体类另有 **TEXCOORD_1**（第二 UV 集）；**无 COLOR_0、无 tangent** |
| 材质边界 | 仅 2 组（车体/履带）——履带正上方被车体完全遮挡，俯视无可见材质边界 |

**顶视可见几何（法线 z>0.35，含遮挡前）**：hull 571 三角（其中 `*_hide_elements*` 子树 121）、
turret 383（其中 hide 25）、mantlet 172、gun 19、tracks 36。
**纹理分辨率 vs 几何分辨率（实测 UV 覆盖密度）**：

| 部件 | texel 密度 | 几何面中位尺寸 | 差距 |
|---|---|---|---|
| hull 甲板 | 5.6mm/texel | 8.3cm（最大单面 12.46 m²） | ~15× |
| turret 屋顶 | 3.7mm/texel | 5.2cm | ~14× |
| mantlet | 4.7mm/texel | — | ~10× |
| gun | 3.0mm/texel | — | ~17× |
| tracks | 1.8mm/texel | — | ~40× |

**结论 1**：Maus 是**低模 + 全纹理**模型（整车 ~5.8k 三角）。grille 栅条、panel line、
引擎甲板图案、AO 阴影等**毫米级**信息只可能存在于纹理（baseColor/normal/occlusion），
不可能存在于面中位 5-8cm 的几何。

## 2. extractor 使用 / 丢弃清单

**使用**：POSITION + INDEX（NORMAL 由叉积重算）。
**完全丢弃**：TEXCOORD_0（UV）、TEXCOORD_1、NORMAL 属性、全部 8 张纹理
（baseColor/normal/metallicRoughness/occlusion）、材质边界（仅 2 组，影响小）、
**`*_hide_elements*` 子树**（hull 351 三角/121 顶面、turret 68/25）。

**hide_elements 语义（BlitzKit 源码确认）**：`TankModel.tsx`（main 分支）按顶层节点名匹配
（`hull`/`chassis_wheel_*`/`chassis_track_*`/`turret_{id}`/`gun_{id}`/`gun_{id}_mask`），
匹配后用 `jsxTree(node)` **渲染整个子树，无任何 hide 过滤**——即 BlitzKit 视图中
`hull_hide_elements` 与 `turret_01_hide_elements` **默认可见**。extractor 的跳过与 ground truth 背离
（影响量见 §4.1）。`mask_01` 节点 BlitzKit 不渲染，extractor 排除正确。

## 3. 真值渲染（从 GLB 数据重建的 320px 正交俯视）

- 1cm/px z-buffer 遮挡渲染：每像素取最高面，颜色 = baseColor × occlusion(AO) × normal-z 起伏着色
  （`Maus_track_mtr` 走 alpha 测试）→ 降采样到 fit 变换下的 320px。
- 一致性验证：silhouette 宽高比 0.418 vs 真实 3.72/9.04=0.412；ASCII 布局正确
  （炮管条/炮盾/炮塔块/甲板）；BlitzKit 官方 icon（references/6929.webp）是 3/4 视角
  （aspect 1.22）不可直接比对，但其内部边缘密度 0.52 证实 BlitzKit 渲染纹理满载
  ——本真值渲染是保守（低对比）代理，真实渲染细节只会更多。
- **正上方真正可见面积（z-buffer）**：hull 19.44 m²、turret 13.07 m²、mantlet 1.07 m²、gun 0.62 m²、
  **hull hide 0.24 m²（占 hull 可见 1.2%）**、turret hide 0.06 m²（0.4%）、**tracks 0.00 m²（完全被甲板遮挡）**。

## 4. 320px 结构分解与丢失阶段

gt 边缘（梯度>18）共 **3,041 px**，构成：
silhouette 边界 303（10%，SVG 命中 71%）、部件色界 532（17.5%，命中 46.1%）、
**内部细节 2,377（78%，命中 41.8%）**——丢失集中在内部细节。

**Stage-by-stage recall（gt 边缘 2px 邻域命中率）**：

| 阶段 | recall | 说明 |
|---|---|---|
| raw source（808 三角） | 18.7% | 三角马赛克边缘是噪声 |
| merged（122+22 表面） | 18.7% | merge 只去 tessellation，无 gt 损失 |
| occlusion 后（retained） | 30.8% | 遮挡剔除的是 gt 中不存在的假边缘 → recall 上升（行为正确） |
| tiny/sliver 过滤后 | — | **被删区域内含 15.5% 的 gt 边缘**（见 §4.2） |
| final SVG | 42.2% | 结构边 stroke + micro path 补回一部分 |

**纹理 vs 几何拆分**：gt 边缘中几何驱动 937（30.8%）、**纹理独有 2,104（69.2%）**
（AO 阴影/panel line/格栅/涂装）。SVG 对几何驱动命中 40.4%、对纹理独有命中 43.0%
（纹理边缘常与几何边界重合）。

区域细节密度（gt 边缘/覆盖 px）：甲板前部 0.071、**甲板中部 0.168（最高：舱盖/附件/panel）**、
**引擎甲板 0.134（格栅区）**、炮塔顶 0.063（光滑）。

### 4.1 收集阶段：hide_elements 被跳过（BlitzKit 实际渲染）
可见贡献：0.30 m²（1.2% 车体顶面积）、gt 边缘 53 px（1.7%）。真实但小。
且当前冻结的 zMean 遮挡过滤会把大部分 hide 面（zMean 低于甲板）二次滤掉（合并后 235 面 → 遮挡后 22）。

### 4.2 tiny/sliver 过滤：删掉的是真实长条结构（最大可恢复几何损失）
removed-tiny-details.svg 共 41+ 条 path，**全部为长条**：110.87×2.77、110.87×2.76、
109.1×1.68、30.4×1.57 units（≈3.5m×8.7cm）——即甲板缘条/分带条，320px 下为
110×2.7px 可见线条。合计覆盖 4,195 px（车辆面积的 13%），**内含 15.5% 的 gt 边缘**。
sliver 规则（宽高比>12 且窄边<0.15m）本意删 polygon-clipping 伪影，误删真实长条。

### 4.3 投影阶段：2D union 过绘（结构偏差，非丢失）
- tracks：2D union 画了深色履带条，但正上方 z-buffer 显示履带可见面积为 **0**；
- mantlet：画完整 2D 轮廓，而顶视只见其上表面 → mantlet 区域 gt recall **0%**（127 边缘）；
- gun：整根炮管 2D 轮廓对圆柱恰等于顶视，但 muzzle/下缘过绘。
修正过绘本身能提升 fidelity（属"不再画顶视不可见结构"，不是恢复信息）。

## 5. 结论：GEOMETRY_ONLY_FIDELITY_LIMIT_REACHED

对用户列出的细节逐项判定（依据 §1 密度证据 + §4 拆分）：

| 细节 | 存在位置 | 判定 |
|---|---|---|
| grille 栅条 / vent | 纹理（AO+baseColor） | **纹理独有 → 超几何上限** |
| panel line | 纹理 | **纹理独有 → 超几何上限** |
| engine-deck pattern | 纹理（0.134 密度区） | **纹理独有 → 超几何上限** |
| roof detail（涂装/刻线） | 纹理 | **纹理独有 → 超几何上限** |
| mechanical fixture 的阴影/细节 | 纹理为主 | **纹理独有 → 超几何上限** |
| hatch boundary（几何凸起） | 几何（hide 121 面 + 主网格凸起） | 几何可恢复，但量小（1.7%） |
| 甲板缘条/分带条 | 几何（removed-tiny 41+ 条） | **几何可恢复（15.5% 边缘）** |
| 2D union 过绘（履带/mantlet） | 几何（画多了） | 修正后提升 fidelity |

**几何-only 的现实上限**：当前 42.2%；即使恢复全部可恢复几何损失
（removed-tiny 15.5% + hide 1.7% + 过绘修正），乐观估计 ≈55-65%——
**无法达到 90% 目标**。剩余 ~35-45% 是纯纹理信息（AO/panel line/格栅/涂装），
任何 geometry heuristic 都无从恢复。

**按用户指令：不再用更多 geometry heuristics 假装恢复不存在的信息。**
本轮不改 pipeline、不调 threshold、不扩展 audit 框架；冻结项全部不动。

## 6. 可选方向（待用户决策，本轮未实施）

1. **纹理投影渲染资产**（texture baking 到 SVG 光栅或低分辨率纹理色块）——把
   baseColor/normal/occlusion 的确定性采样结果写进资产，可达到 ~90%+ 视觉 fidelity，
   但改变资产形态（不再是纯几何 SVG），需要新契约与 validator 变更；
2. 仅恢复几何可恢复项（removed-tiny 放宽 + hide 纳入 + 过绘修正），fidelity ≈55-65%，
   保持纯几何 SVG 架构；
3. 接受几何上限，把 90% 目标改为"几何可恢复部分 90%"（当前几何驱动 937 边缘中
   SVG 命中 40.4% → 可提升至 ~90%）。
