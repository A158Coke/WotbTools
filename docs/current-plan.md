# Battle Playback HD Basemap Runtime Sharpness

## 状态

IMPLEMENTATION COMPLETE — review blocker 0；build validation blocked by pre-existing local-asset guard

### 执行记录（2026-09-05）

- 已从最新 `origin/main` 建立 `fix/playback-hd-runtime-sharpness`，未触碰地图原图、HD WebP 或 manifest。
- Step 0：使用同一 Faust HD 资源完成 Chrome fixture 的 SVG raster / 直接 HTML raster A/B 诊断；两者在相同父层 compositor scale 下视觉等价，因此按计划进入 layout-scaled camera fallback。当前环境没有可复用的已认证真实 replay 会话，故未宣称完成真实 replay 的 fit/2×/4× 截图证据；browser gate 使用真实 manifest WebP 和生产布局 CSS。
- Step 1：新增 `mapRasterDensity()` 纯诊断 helper，覆盖 768 CSS px、1×/2×/4×、DPR 1/2；不参与渲染决策、不改变最大缩放。
- Step 2：`BattleMap.vue` 将 HD 底图移为独立 `.pb-basemap` `<img>`，overlay SVG 改为透明 vector-only layer；basemap、SVG、markers 共享 `mapView.W/H` 对应的 `.pb-viewport` frame。
- Step 3：`BattlePlayback.vue` 保留 `view.scale`、anchor、pan、projection 和交互语义，以 layout width + translation 实现 source-resolution-aware camera；车辆 marker 保留既有地图缩放与屏幕恒定 overlay 语义。
- Step 4：focused DOM/interaction tests、fullscreen CSS test 与 Chrome 8-scenario geometry gate 均通过；Chrome gate 验证 manifest natural dimensions、fit density、4× required device pixels 和非正方形 frame 同框。
- Step 5：已同步 feature contract、technical/product changelog、`versions.json` 2.12.75 三语 fix 条目和本计划。
- 验证结果：受影响回归 11 files / 206 tests 通过；补充回归 4 files / 148 tests 通过；`npm run typecheck` 通过；`git diff --check` 通过；`npm run test:browser-layout` 8/8 通过。
- 审查结果：`ocr delegate preview` 识别 6 个 reviewable 文件、8 个按工具规则排除文件；已逐文件完成人工 Layer A/B/C 审查。发现并修复 1 个 overlay 实色背景覆盖 basemap 的正确性问题；review-fix / review-with-docs / code-smell 当前 blocker count 为 0。fallow CLI 的旧技能调用形式失败后按当前 CLI 语法重试，结果仅报告既有未使用 export/type/dependency 基线，未发现本次新增 helper 的死引用。
- 未完成项：`npm run build` 在 Vite 编译前被仓库既有 fail-closed guard 阻止，因为工作区存在 `common/assets/map-3d-local` 本地研究资产；该目录是明确的 DEV/local-research-only 非目标，未删除、未绕过 guard。真实 authenticated replay 的视觉 before/after 截图也待具备该会话后补充。
- PR review repair：修正 `BattleMap3D` 对 Three.js `^0.185.1` 不存在的 `renderer.capabilities.maxRenderBufferSize` 假设；现在从活动 WebGL context 读取标准 `MAX_RENDERBUFFER_SIZE`，并以 focused regression 覆盖成功、缺失与 context 异常路径。该修复不改变既有 camera、basemap 或 2.5D 交互契约。

## 需求确认单

### 目标

修复 Battle Playback 运行时的 HD 底图清晰度问题：同一张约 4048×4048 的 `maps-hd` 资源必须在真实页面中按可用源像素渲染，2×/4× 放大时明显保留更多细节，同时保持底图、车辆、基地、出生点、轨迹、炮线和标注严格对齐。

### 范围

- 从最新 `origin/main` 建立独立修复分支；不从已合并的 PR256 分支分支。
- 先在真实 Playback 中复现并测量 fit / 2× / 4× 的加载尺寸、CSS frame、DPR 与有效栅格密度。
- 用同一张 HD 资源完成当前 SVG `<image>` 路径与直接 HTML `<img>` 路径的 A/B 对照；只有证据支持时才替换渲染架构。
- 首选把 HD 底图移到 `.pb-viewport` 下的独立 `.pb-basemap` `<img>`，SVG 只保留 vector overlays；继续由同一个 camera parent 统一平移/缩放。
- 保持 `mapView.W/H`、`coordinateBounds`、`createMapView()`、terrain projection、现有 1×→4× camera math 与用户交互不变。
- 更新 BattleMap focused tests、浏览器几何回归、相关文档与 `frontend/src/data/versions.json` 的 2.12.75 fix 条目。

### 非目标

- 不重新生成、重编码、锐化或修改 29 张原图/HD WebP，不修改 manifest hash。
- 不改地图语义、terrain attitude、replay parser、backend、OpenAPI、AI Review、3D 地图/坦克或 Replay Workspace 结构。
- 不用 CSS filter、`image-rendering: pixelated` 或降低最大缩放来伪造/隐藏清晰度问题。
- 不在本 PR 做 `mapImages.width/height` → `logicalWidth/logicalHeight` 的广泛重命名；只补充其“逻辑 render frame、不是 intrinsic raster size”的说明。

### 验收标准

- 真实浏览器确认 Playback 加载的是 manifest 对应的约 4048×4048 HD 资源。
- A/B 对照完成；若 SVG 嵌入路径是瓶颈，运行时底图不再嵌入 `BattleMap` 的 `.pb-svg`。
- fit 不劣化；源像素密度足够时 2× 明显比当前 main 清晰，4× 明显减少 compositor-like blur。
- `.pb-basemap`、overlay SVG、marker layer 在 Desktop / Tablet / Mobile 的 frame 一致；已知基地、spawn、车辆和标注无漂移。
- wheel zoom、cursor/midpoint anchor、pinch、drag pan、Reset View、fullscreen 和 marker/label/HP 行为保持回归通过。
- 29 个 `maps-hd/*.webp` 与 29 个 `maps/*.webp` 字节不变；`mapHdAssets.test.js` 继续通过。
- `versions.json` 只新增一个顶层 2.12.75 `fix` 条目，zh/en/ru 完整；文档与实现区分 intrinsic asset resolution、logical frame、runtime raster resolution。
- targeted tests、`npm run test:browser-layout`、`npm run typecheck`、`npm run build` 通过；实现后 review-fix / review-with-docs / code-smell blocker 为 0。

### 关键假设与默认决策

- 默认从 `origin/main` 开始，在新分支 `fix/playback-hd-runtime-sharpness` 上完成一个独立 PR。
- 默认选用 Faust、Desert Sands、Himmelsdorf 作为 A/B 样本，分别覆盖既有 QA 敏感图、细节地形图和城市/硬边缘图；若实际代码或资源映射不符合，则使用现存且可加载的等价样本并记录原因。
- 默认优先保留 `.pb-viewport` 作为唯一 camera transform owner；只有 A/B 证明“HTML `<img>` + parent CSS scale”仍在源密度足够时模糊，才进入 layout/source-resolution-aware fallback。
- 默认将截图作为 PR 证据产物保存于仓库外/PR 附件，不把大尺寸诊断截图或临时 replay 写入仓库。
- 2.12.75 的日期使用实际实现日期；不改历史版本。

### 待确认项

- 阻塞性：无。附件已明确目标、非目标、决策门和验收。
- 可默认：A/B 后是否采用 preferred split 或 fallback，由同一任务中的浏览器证据决定；不得在证据不足时宣称修复完成。

---

## 开发方案单

### 可落地性核对

| 事实 | 证据 | 方案影响 |
|---|---|---|
| Playback 已使用 HD URL，但底图嵌在 SVG | `frontend/src/components/BattleMap.vue:158-170` 的 `.pb-viewport` / `.pb-svg` / `<image href=...>` | A/B 必须区分 SVG raster path 与 HTML raster path；不能仅凭 URL 判断 HD 生效 |
| `mapImages` 尺寸是逻辑 render frame | `frontend/src/data/mapImages.js:36-68` 的 754–783 × 762–780 配置与 `frontend/src/utils/mapView.js:6-25` | 保留 W/H 参与坐标映射；不能盲改成 4048 |
| 逻辑 frame 同时驱动 overlay 与 camera | `frontend/src/components/BattlePlayback.vue:496-504, 883-903, 1928-1931` | basemap、SVG、markers 必须共享 W/H 对应的同一 DOM frame |
| camera 交互由父组件统一持有 | `frontend/src/components/BattlePlayback.vue:727, 1000-1130`、`frontend/src/utils/battlePlayback.js:350-395` | 首选只换图层结构，不重写 zoom/pan/anchor 数学 |
| 现有测试锁定 transform 和层行为 | `frontend/src/components/BattleMap.test.js:60-330, 400-680` 及 `BattlePlayback*.test.js` | 更新 raster 结构断言，保留全部 camera/marker/annotation 回归 |
| 现有 browser gate 只验证 shell/layout | `frontend/scripts/browser-playback-layout.mjs` | 扩展同一 gate，增加真实 raster、frame 和 fit/4× 几何断言；不以 happy-dom 冒充浏览器布局 |
| manifest 是资源真实性基准 | `frontend/src/assets/maps-hd/manifest.json` 与 `frontend/src/data/mapHdAssets.test.js` | 运行时 natural size 断言与静态 hash/尺寸 gate 分开；不修改资产 |

### Reuse Audit

- 已搜索 `naturalWidth`、`naturalHeight`、`devicePixelRatio`、`requiredDeviceWidth`、raster density 等现有实现，未发现可复用的 runtime density helper。
- 继续复用 `mapView` 的逻辑 W/H、`mapRenderRect()`、`screenToSemantic()`、`svgToScreen()` 与 `zoomViewAt()`；不创建第二套坐标/相机 owner。
- 如实现确实需要纯诊断计算，新增最小的 `frontend/src/utils/mapRasterDensity.js` + focused test；该 helper 只计算 capacity/density，不参与渲染决策、不伪造清晰度。

### 分步计划

#### 0. 基线、复现与 A/B 决策门

文件/产物：不先修改生产代码；使用真实 Playback、现有浏览器工具链和仓库外诊断截图。

- 从最新 `origin/main` 运行代表性 Playback，记录 asset URL、`naturalWidth/Height`、fit CSS frame、`view.scale`、DPR、`requiredDeviceWidth` 和 `effectiveSourcePxPerDevicePx`。
- 在 fit、2×、4× 截取同一 replay/map 的 before 图，检查道路、建筑边缘、岩石轮廓、细小地形纹理和地图边界。
- 用完全相同的 HD WebP 做 A（现有 SVG `<image>` + parent transform）与 B（HTML `<img>` + 等价 frame/transform），覆盖 Faust、Desert Sands、Himmelsdorf 的 1×/2×/4×。
- 若 natural size 不为 manifest 的 enhanced size，先修复实际资源加载/构建问题并停止架构替换；若 `<img>` 路径仍同样模糊且源密度足够，进入步骤 3 fallback；否则进入步骤 2 preferred split。

#### 1. 建立 HD 密度诊断契约

预计文件：`frontend/src/utils/mapRasterDensity.js`、对应 `*.test.js`（仅在 Reuse Audit 确认无现有实现后新增）。

- 提供 `requiredDeviceWidth = renderedCssWidth × view.scale × devicePixelRatio` 及等价 density/capacity 计算。
- 同时支持 height 或明确记录以宽度为主的约束；对非正数/缺失 natural size 返回可诊断的 unavailable，而不是制造 0 或无限容量。
- 单测覆盖 768 CSS px 在 1×/2×/4×、DPR 1/2、4048 source 的容量判断；明确 6144 required device px 超过 4048 是物理 source limit，不是 renderer failure。
- 诊断只供 browser/QA 和测试读取，不改变最大 zoom，不把 density 当作 sharpness 保证。

#### 2. Preferred：拆分 HTML basemap 与 vector overlay

预计文件：

- `frontend/src/components/BattleMap.vue`
- `frontend/src/styles/playback-shared.css`（仅当现有 fullscreen `.pb-svg { height:auto }` 覆盖新 frame 时修改）
- `frontend/src/components/BattleMap.test.js`

- 在 `.pb-viewport` 下先渲染 `.pb-basemap` `<img>`，再渲染 overlay-only `.pb-svg`；二者 `position:absolute; inset:0; width:100%; height:100%`，图片 `object-fit:fill`，SVG 保持 `viewBox="0 0 W H"` 与 `preserveAspectRatio="none"`。
- 让 `.pb-viewport` 通过 `mapView.W / mapView.H` 建立与旧 SVG frame 相同的 aspect；不让 4048×4048 intrinsic ratio 替换既有非正方形逻辑 frame。
- 保持 `.pb-markers` 与其他 map feedback overlay 在同一 camera parent 下；继续使用 `projectSemantic()`、`projectTerrainPoint()`、`mapView.W/H` 和现有 `viewScale` 处理 marker offset/line width。
- 保持 `BattlePlayback.vue` 的 `viewportStyle`、`mapRenderRect()`、`fitScale()`、`semanticPoint()`、annotation 与 transient feedback 数学不变；只在实际 layout 需要时调整 DOM frame 取值。
- 更新 fullscreen/shared CSS 中针对 `.pb-svg` 的 stale `height:auto` 规则，避免覆盖 100% overlay frame；作用域限定于普通 2D BattleMap，不能改写 `BattleMap3D` 非本任务路径。
- 不把 HD intrinsic width/height 写回 `mapImages.width/height`；仅补充逻辑尺寸注释。

#### 3. 条件 fallback：只有 A/B 证实 compositor scaling 仍为瓶颈时执行

预计影响：`BattleMap.vue`、必要时 `BattlePlayback.vue` 的 frame/geometry adapter、`battlePlayback`/annotation 相关 focused tests；不默认实施。

- 用固定 clipping viewport + 按 `baseFrame × view.scale` 的 camera content layout，或同等浏览器已证明方案，让 requested visual scale 反映实际 raster render dimensions，pan 只负责 translation。
- 以现有 `view.scale` 为 camera SSOT；同步审计 `screenToSemantic`、marker size、HP/label inverse-scale、hitbox 和 pointer anchor，确保只修必要换算。
- 保留 1×→4× 上限和所有 wheel/pinch/pan/reset 语义；不通过降级 max zoom 规避源分辨率上限。
- 若 A/B 无法证明该 fallback 能改善真实画面，则停止并报告证据，不合并 cosmetic-only DOM refactor。

#### 4. 单测与浏览器几何回归

预计文件：`frontend/src/components/BattleMap.test.js`、必要的 `BattlePlayback*.test.js`、`frontend/scripts/browser-playback-layout.mjs`。

- `BattleMap.test.js` 改为断言 `.pb-basemap` `<img>` 存在且 `src` 为传入 HD asset；`.pb-svg` 不含 raster `<image>`，仅保留 bases/spawns/trails/tracers/annotations；加入“HD basemap 不得嵌套在 pb-svg”的结构守卫。
- 保留基地、spawn、tracer、annotation、selected marker、marker rotation/size、zoom scale、wheel anchor、pinch anchor、pan、click suppression、reset 的现有断言，不弱化为“函数被调用”。
- 扩展现有 Chrome fixture：使用真实 manifest 对应 HD WebP，验证 `complete`、natural dimensions 与 manifest enhanced dimensions；在至少一个非正方形 logical frame 中验证 basemap/SVG/markers `getBoundingClientRect()` 在 fit 和 4× 仍同框。
- Desktop、Tablet、Mobile（适用时）都检查 frame、overflow、fullscreen safe inset；截图/视觉对照与结构 gate 分开，避免 happy-dom 或 static source regex 代替真实浏览器证据。

#### 5. 文档、版本与 PR 证据

预计文件：

- `docs/features/battle-playback.md`
- `docs/CHANGELOG.md`
- `docs/CHANGELOG-PRODUCT.md`
- `frontend/src/data/versions.json`
- `docs/current-plan.md`

- 专题文档新增 runtime rendering contract：HD asset intrinsic resolution、logical map coordinate/render frame、runtime raster density 三者分开；说明 basemap 是 HTML raster layer、SVG 是 vector overlay，且不改变 semantic/world mapping。
- 技术 changelog 记录 root-cause evidence、A/B gate、geometry/runtime density 约束；产品 changelog 记录实际用户可见的 Playback HD zoom 清晰度修复。
- 在 `versions.json` 顶部只加入 2.12.75 / `fix` / 实际日期 / zh-en-ru 三语文案，不改 2.12.74 及历史项。
- PR 描述附 fit/2×/4× before-after、natural dimensions、DPR/density、geometry regression、tests、changed files、29+29 assets byte-identical 与 blocker count。

### 影响面清单（wotb-sync）

| 层 | 结果 | 说明 |
|---|---|---|
| Replay parser / canonical facts | ✓ 无影响 | 不改 replay 解码、timeline、terrain authority 或车辆事实 |
| Domain / model | ✓ 无影响 | 不改后端模型、map semantics、WORLD_BOUNDS_300 |
| HTTP / OpenAPI | ✓ 无影响 | 不改 endpoint、DTO、generated transport 或 API contract |
| Frontend rendering | ✓ 需改 | BattleMap raster/overlay DOM 与 frame CSS；保留现有 camera/coordinate SSOT |
| Frontend locale | ✓ 无新增 locale key | 2.12.75 三语文案放在既有 `versions.json` 版本记录格式，不改变 API/locales contract |
| Export / Java columns | ✓ 无影响 | 不涉及数据列或导出 |
| Static map assets | ✓ 必须不变 | 不触碰 `frontend/src/assets/maps/*.webp`、`maps-hd/*.webp`、manifest |
| Tests | ✓ 需改 | focused DOM invariant、density helper（如新增）、Chrome frame/natural-size regression |
| Docs / changelog | ✓ 需改 | feature contract、technical/product changelog、current-plan |
| Build / deploy | ✓ 需验证 | 不改构建配置；由于运行时 asset/render path 变化需 typecheck/build，PR CI 为最终权威 |

### 不做清单

- 不改 `mapImages` logical dimensions 为 4048，不改 `coordinateBounds` 或 projection 公式。
- 不把 SVG overlays、markers、feedback 拆成第二个 camera owner；不复制 `view.scale` 或 semantic mapping。
- 不修改 `BattleMap3D.vue` 的 3D raster path。
- 不新增 8K/多分辨率资产、不改变 WebP quality/hash、不扩大 4× zoom。
- 不把截图锐化、对比度、filter、pixelated 当作修复。
- 不扩展到 backend、contracts、parser、AI、HUD redesign、historical versions 或无关 `mapImages` rename。

### 验证路径

1. 基线与 A/B：真实 Chrome/Playback，Faust + Desert Sands + Himmelsdorf，fit/2×/4×，保留可复核截图与测量值。
2. 修改后 targeted：
   `cd frontend; npx vitest run src/components/BattleMap.test.js src/data/mapHdAssets.test.js`，加上实际新增/受影响的 density、coordinate、BattlePlayback focused suites。
3. 浏览器：`cd frontend; npm run test:browser-layout`，覆盖 Desktop/Tablet/Mobile frame 与 natural-size/4× geometry assertions。
4. 构建边界：`cd frontend; npm run typecheck; npm run build`。
5. 变更后执行 `review-fix`、`review-with-docs`、`code-smell`；针对发现的每个问题重新运行失效的最小测试，不重复无关全量测试。
6. 资产保护：`git diff --name-only -- frontend/src/assets/maps frontend/src/assets/maps-hd frontend/src/assets/maps-hd/manifest.json` 必须为空；配合 `mapHdAssets.test.js` 的 hash/尺寸 gate。
7. PR CI 作为 repository-wide final authority；PR 描述逐项回答加载真 HD、是否仍嵌入 SVG、1×/2×/4×密度、视觉改善、对齐、交互回归、资产字节、版本条目与 blocker count。

### 完成定义

只有在 A/B 证据支持的实现路径完成、真实浏览器在源密度允许处看到清晰度改善、所有 geometry/interaction/asset/docs/version/test/review 条件满足后，才把本计划标记为完成并创建标题为 `fix(playback): preserve HD basemap detail during zoom` 的单独 PR。

---
# Battle Playback HD Basemaps + 2.5D Vehicle Terrain Attitude

## 状态

IMPLEMENTED — REAL PLAYBACK A/B COMPLETE — SOURCE DETAIL CEILING CONFIRMED

Repair update: the collision-offset unit regression is fixed and the 2.5D renderer now
sizes its drawing buffer from measured layout CSS pixels with source/GPU ceilings. Local
real Playback A/B at the same map/position/zoom found WebGL and direct HD raster visually
equivalent, so the remaining softness is classified as the current 4048×4048 source-detail
ceiling. The mip filter remains the existing trilinear mipmap policy because this A/B did
not prove a visual improvement; no 8K asset generation is in scope.

## 范围

- 29/29 HD basemap 均由对应原图独立生成，原图永久保留为 rollback/source-of-truth。
- HD 资源增加 deterministic gate：coverage、SHA-256、实际 WebP 尺寸、严格 2× frame、无 crop/aspect drift、mapImages import coverage、单图 5 MiB / 4× growth budget。
- terrain attitude 继续复用 authoritative heightfield + canonical hull yaw + 真实车辆 footprint；不伪造 replay Z。
- 新增 yaw=90°、反向 sign、45° diagonal 的局部轴回归测试。
- [x] 29/29 source ↔ HD 已完成 side-by-side + macro-edge overlay 人工 QA：未发现 crop/warp、道路/建筑整体位移、岸线或主要地形轮廓漂移。最低 diagnostic macro-edge F1 为 Faust 0.9312、Desert Sands 0.9318；人工对照确认差异来自纹理/锐化边缘密度，而非战术拓扑重排。`geometryTransform=NONE` 仍只描述 pipeline，不单独作为真实性证明。
- [x] 资源预算验证：最大单图 Canyon 4,666,308 B < 5 MiB；最大 growth Faust 3.748× < 4×。

---
# Battle Playback 2.5D Vehicle Terrain Attitude

## 状态

IMPLEMENTED — READY FOR PR REVIEW

## 范围

- 保持现有 2D hull/turret 与 Tier X dedicated top-view assets，不引入 3D 坦克模型。
- 复用 2.5D authoritative terrain heightfield，在车辆 footprint 的前/后/左/右采样地面高度。
- hull yaw 仅负责把 terrain slope 转到车辆局部轴；pitch/roll 只作用于 `.pb-graphics`。
- HP、标签、hitbox、selected/recorder、碰撞布局继续 screen-aligned，不随车体倾斜。
- 视觉 pitch/roll 做轻度放大并分别 clamp ±14° / ±10°；不伪造 replay Z。

## 验收

- [x] 上坡/下坡可见车头抬起/下压；横坡可见轻微 roll。
- [x] flat terrain = 0° attitude。
- [x] marker 真实 footprint 继续来自现有 `vehicleMarkerSizing` SSOT。
- [x] 无 heightfield 或无可靠 hull yaw 时退化为原 2D marker，不猜方向。
- [x] targeted unit tests 覆盖 pitch/roll/clamp 与 graphics-only transform。

---
# Team AI Tactical Review v0.1

## 状态

IMPLEMENTED IN WORKTREE — READY FOR REVIEW

## 范围

- 保留现有 Canonical BattleTimeline → deterministic evidence → Team Call #2 → grounding validator 架构。
- 通过 `AiPromptLibrary` include 注入 team-execution、position-tempo、hp-trades、mode-objectives 四个紧凑模块。
- 修正 `primaryDiagnosis`：表示本场最重要结论，不强制制造错误；保留 JSON 字段避免无关契约变更。
- 明确 Strategic Prior 只是战略基线/可能性空间，不是实际队伍计划；禁止推断语音、call、通信或指挥责任。
- 复用现有中性 timeline/evidence（进入时序、空间分离、局部人数、信息更新、点数与交火），不建立第二套 episode 或后端战术 verdict。
- 增加三语 prompt contract、golden cases、validator/no-fault 回归，并同步 AI 架构与 Team Review 文档。

## 验收标准

1. Team prompt 含四个模块，EN/RU 本地化不残留中文模块规则。
2. Prompt 明确 evidence-insufficient → skip、operation vs decision、position > kill、HP/gun value、commitment/half-commit、rotation/tempo 及模式目标经验规则。
3. Prompt 不把最新到达者自动定责，不把 Strategic Prior 当实际计划，不推断 communication/call。
4. `primaryDiagnosis` 可自然表达无明显确认错误/关键成功因素/对手处理更好；validator 仍要求结构完整与 grounding。
5. Golden cases A–H 注册并通过 deterministic prompt harness；相关单测通过。
6. 文档与实现一致；不新增 backend tactical verdict。

## 实施与验证记录

- [x] 从 `main` 建立独立 worktree `feature/team-ai-tactical-review-v01`。
- [x] 添加四个模块化 ZH prompt 资源与 EN/RU localization anchors。
- [x] 更新 Team prompt、主诊断/Strategic Prior 契约与核心 envelope 文档。
- [x] 更新 docs/architecture/ai-review.md 与 docs/features/team-ai-review.md。
- [x] 添加/更新 deterministic tests 与 golden cases。
- [x] 运行 targeted Maven tests（Web 15/15、Core validator 80/80）。
- [x] 完成 review-fix / code-smell / review-with-docs 自审闭环；OCR workspace preview 识别 11 个 reviewable 文件，未发现 blocker。

## 结果边界

- 本 worktree 未执行 DeepSeek live provider evaluation；该项仅作未来手动诊断工具，默认永远 skip，不进入 CI 或 PR 合并条件。A–H 的 deterministic static prompt/evidence contract 是本 PR 的 merge gate；live scenario 只提供 facts，expected behavior 仅存在于 assertions。
---
# 3D Battle Playback First — PR1 Client Map Research

## 状态

**COMPLETE / PR1 GATE PASS / PR247 REVIEW FIXES APPLIED / PR2 HANDOFF READY**

PR #247 已完成 Client Map Research 主目标，并闭环 review 发现的 2 个 MAJOR + 1 个 MINOR，以及复审发现的 raw `.sc2` default-discovery BLOCKER。

## 核心 contract

```text
SC2 Entity
  -> RenderComponent
  -> Mesh
  -> RenderObject initial visibility
  -> active RenderBatch (LOD/switch, shared -1)
  -> rb.datasource
  -> companion SCG
  -> unique PolygonGroup #id
  -> vertices / indices
```

### Canal / `18_canal_cn`

- recursive SC2 entities：2,725
- SCG PolygonGroups：237
- datasource exact match：237 / 237
- unmatched / unreferenced：0 / 0
- schema v3 geometry：70
- Mesh instances：590
- positions：85,028 / 1,020,336 bytes
- indices：156,543 / 626,172 bytes
- invisible RenderObject skipped：363
- selected diagnostic State 0：347
- selected diagnostic State 1：0
- mutually-exclusive overlap：0

### Port Bay / `14_port_pt`

- recursive SC2 entities：3,890
- SCG PolygonGroups：217
- datasource exact match：217 / 217
- unmatched / unreferenced：0 / 0
- schema v3 geometry：80
- Mesh instances：1,326
- positions：65,291 / 783,492 bytes
- indices：123,054 / 492,216 bytes
- invisible RenderObject skipped：713
- selected diagnostic State 0：596
- selected diagnostic State 1：0
- mutually-exclusive overlap：0

## DAVA selection semantics

```text
(batch.lodIndex == requestedLod OR batch.lodIndex == -1)
AND
(batch.switchIndex == requestedSwitch OR batch.switchIndex == -1)
```

```text
RenderObject::VISIBLE = 1 << 0
explicit ro.flags -> require bit 0
missing ro.flags  -> visible by RenderObject::Load default
```

Production selector 不读取 `State 0` / `State 1` filename。

## PR247 review closure

### MAJOR 1 + 复审 BLOCKER — raw `.sc2`

- `.dvpl` member 才调用 `decode_dvpl`；
- raw `.sc2` 直接传给 `read_sc2`；
- 默认 exact main discovery 同时支持 `.sc2.dvpl` / `.sc2`；
- exact main 不存在时，fallback discovery 同时支持 `.sc2.dvpl` / `.sc2`；
- `inspect_map_scene.py` 与 `inspect_map_state_switchers.py` 使用相同 discovery contract；
- state-switcher inspector 新增 `--scene`，多 SC2 场景可显式选择；
- regression test 覆盖 raw `.sc2` exact、raw fallback、state explicit override；
- `inspect_map_scene.main()` 端到端测试验证不传 `--scene` 时 `Maps/99_test/99_test.sc2` raw bytes 原样进入 `read_sc2`。

### MAJOR 2 — duplicate PolygonGroup id

- `wotb_scg.read_scg()` 在共享 parser boundary 校验所有可解码 `#id` 唯一；
- duplicate id 直接 `Sc2ParseError` fail-fast；
- 错误包含 duplicate id 与两个 PolygonGroup index；
- exporter 使用共享 `polygon_groups_by_id()`，不再静默覆盖；
- SCG inspector 同样无法让 duplicate id 进入 set-based cross-check；
- regression test 覆盖 duplicate id。

### MINOR — nested scene entities

- scene inspector 改为 recursive `#hierarchy` traversal；
- report schema v3；
- `sceneTraversal.mode = recursive #hierarchy`；
- target component sample 包含 `entityPath`；
- regression test 覆盖 nested RenderComponent / CollisionTypeComponent。

## PR2 handoff

```text
SC2 + companion SCG + heightmap + existing map semantics
  -> deterministic renderer-neutral manifest
  -> shared local static geometry buffers
  -> initially-visible instance transforms
  -> terrain representation
  -> canonical world bounds / coordinate metadata
  -> transformed world-AABB sanity report
```

Canal + Port Bay 继续作为双地图 gate。

## Collision / nav 边界

- `CollisionTypeComponent` metadata 已证明；独立 gameplay collision mesh 未证明；
- `.mkm/.lka` 与 TerrainData association 已证明；navmesh/passability semantics 未证明；
- visual PR2 不消费未经证明的数据。

## PR1 DoD

- [x] Maps.zip inventory
- [x] terrain + coordinate baseline
- [x] SCPG / PolygonGroup parser
- [x] recursive SC2 datasource ↔ SCG exact link
- [x] vertex/index decoder
- [x] unique PolygonGroup id invariant
- [x] RenderBatch shared `-1` contract
- [x] initial RenderObject visibility contract
- [x] raw `.sc2` / `.sc2.dvpl` decode + default discovery + fallback
- [x] state-switcher explicit scene override
- [x] recursive scene inspector
- [x] Canal schema v3 final gate
- [x] Port Bay schema v3 final gate
- [x] collision/nav research boundary
- [x] PR247 review findings closure

**PR1 blocker = 0. PR2 handoff ready.**

---

# Team AI Review v0.3：降低过度压缩，提升完整战术解释

## 状态

IMPLEMENTED — TARGETED TESTS PASS — LIVE PROVIDER NOT RUN

## 执行记录

- [x] 从最新 `origin/main` 创建独立 worktree 与 `feat/ai-review-v03-complete-explanation` 分支。
- [x] 审计 Team prompt、reasoning contract、三语 localizer 与 Team Call #2 输出上限；未修改 backend tactical inference。
- [x] 将输出目标调整为 selective but complete：关键 episode 完整解释 Information/Objectives/Local/Propagation 因果，保留反 timeline-dump 约束。
- [x] 将「重点复查」与「高贡献者」明确为有 structural evidence 时才输出的可选 section，并同步三语 prompt contract。
- [x] 将 Team Call #2 默认专用输出上限调整为 8192 tokens，并更新 deterministic prompt tests 与三份指定文档。
- [x] targeted tests：139 tests pass；首轮使用项目 settings.xml 遇到 Aliyun TLS PKIX，改用本机 Maven cache 后完成验证。
- [x] review-fix / review-with-docs / code-smell：OCR reviewable 2/2，excluded 文件人工审查，Blocker count 0。
- [x] commit / push / PR：`4c5ead50` 已推送，PR #258 已创建。

---

# Team AI Review Quality Harness v1

## 状态

IMPLEMENTED IN WORKTREE — TARGETED TESTS PASS — LIVE PROVIDER NOT RUN

## 执行记录

- [x] 从 `origin/main` 创建独立 worktree 与 `feat/team-ai-review-quality-harness-v1` 分支。
- [x] 添加 additive `evidenceBasis`、推理顺序和 deterministic shortcut contract。
- [x] 添加 6 个真实回放 gold case 与 production-chain offline harness。
- [x] 添加显式 opt-in real-replay benchmark、runs/report/baseline metadata 约定及 0-token isolation guard。
- [x] 更新 AI 架构、Team review、evaluation operations 与 changelog 文档。
- [x] targeted Maven tests 通过；未调用 DeepSeek / ai-live。

---

# Team AI Review v0.4：强化信息链、禁止魔法距离、重做个人复查逻辑

## 状态

COMPLETED — TARGETED TESTS PASS — LIVE PROVIDER NOT RUN

## 执行记录

- [x] 从合并 PR #258 后的 `origin/main` 创建独立 worktree 与 `feat/team-ai-review-v04-information-chain` 分支。
- [x] 完成 Team prompt、三语 reasoning contract、quality shortcut validator 与既有 deterministic contract tests 的 delta audit。
- [x] 完成 Information decision chain、supportability、state trigger、Objectives obligation 与 episode-bound individual review contract。
- [x] 运行 targeted 0-token tests，完成 review-fix / review-with-docs / code-smell 闭环。
- [x] 提交、push 并创建 PR：[#260](https://github.com/A158Coke/WotbTools/pull/260)。
