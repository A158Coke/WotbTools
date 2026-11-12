# 测试效力复测（2026-11-11，main `7b4285870`，Issue #827 Step 0）

本文是 Issue #827 的当前 baseline 重建设，替代 `2026-11-test-effectiveness.md`（基线 `1cefa174c`，dated 证据）作为**当前**参照；不修改旧文档的历史结论。

## 工具（已提交，可重复）

| 脚本 | 作用 |
|---|---|
| `scripts/testing/classify-source-text-tests.mjs` | 结构化扫描 frontend/src 全部 `*.test.*`，按用例粒度分类「引用生产源码文本」的断言；输出逐例清单 JSON。判定方式为用例切块 + 词法引用匹配（非完整 AST，逐例处置仍需人工复核，见台账）。 |
| `scripts/testing/source-text-probes.mjs` | 对每个「生产源文件 → 读取方测试集合」执行语义变异探针（FLIP_CMP 比较符翻转 / NUM_OFF 数值 ±1，变异点必须落在注释/字符串区间外）与等价重命名探针（未导出局部标识符重命名）。固定 seed=827；变异点先随机洗牌再截取；未变异基线必须全绿否则跳过该源并如实记录。 |
| `scripts/testing/source-text-inventory.json` | 分类器输出快照（生成于 2026-11-11）。 |
| `scripts/testing/probe-matrix-*.json` | 探针原始矩阵（scene / css / vue 三组）。 |

复现方式：干净 checkout → `node scripts/testing/classify-source-text-tests.mjs` → `node scripts/testing/source-text-probes.mjs --inventory ... --out ...`。探针在独立检出上运行（会临时改写生产源文件），不要在未提交工作区运行。

快照口径：`source-text-inventory.json` 与台账基于 Wave 1 Pilot 之前的树（181 例）；Pilot 已删除 seekPointer.test.js 的 2 个文本用例并新增行为测试，当前树重跑为 179 例。baseline 探针矩阵同样基于 Pilot 前状态。可复现性已验证（css 簇重跑两次输出一致；scene/vue 全量重跑因运行时长未做，确定性由固定 seed 保证）。

## 规模与裁剪说明

- 本轮每源文件探针上限：语义 6、重命名 3（旧审计为 40+15，按本会话运行时长裁剪；脚本可用 `--max-semantic/--max-rename` 调高，结论梯度见 Known Risks）。原审计「每模块簇 ≥20 语义 + 10 重命名」的下限在 per-source 视角下由 scene 簇聚合近似覆盖（scene 簇含 ~26 个源文件）。
- 探针范围：`src/scene/` 读取的生产源、`.css`、`.vue`。数据契约（读 `.json` 产物）、`api/*` 与 ownership/config 守卫不在范围。

## Inventory 结果（当前 main）

- 扫描 411 个测试文件；69 个读取生产源码；其中 **181 个用例**的断言引用源码文本。
- 集中地：`scene/sceneryMaterials.test.js`（48）、`components/AgentArmorView.dom-contract.test.js`（22）、`scene/playbackScene.occlusion.test.js`（18）、`MapPreview3DPane.wiring.test.js`（8）、`scene/labelOcclusion.test.js`（7）、`scene/playbackScene.staticFreeze.test.js`（7）等。完整清单见 `scripts/testing/source-text-inventory.json` 与台账草稿 `2026-11-11-disposition-ledger-draft.md`。
- 旧审计 251 例与本轮 181 例的差值来源：#820 拆分后部分守卫已随 #888 迁移为模块行为测试；部分文件（如 tankViewer.distance/cameraPreset）已是混合行为测试；分类口径差异（本轮为「用例体引用源码文本变量 + 断言形态」）。**181 不与 251 直接可比**。

## 探针 Baseline（本轮，seed=827）

| 簇 | 探测源 | 跳过（baselineRed） | 语义捕获 | 等价重命名误报 |
|---|---|---|---|---|
| scene | 20 | 12 | **29/118（24.6%）** | **12/60（20.0%）** |
| css | 2 | 0 | 1/12（8.3%） | 0/0（.vue/.css 跳过重命名探针） |
| vue | 20 | 0 | **0/114（0.0%）** | 0/0 |
| 合计 | 42 | 12 | 30/244（12.3%） | 12/60（20.0%） |

逐源矩阵：`scripts/testing/probe-matrix-{scene,css,vue}.json`。要点：

- **组件源（.vue）的文本断言对语义变异捕获为 0/114**——变异点（数值偏移）落在模板/样式内，没有任何测试变红：组件源码字面量守卫目前对数值语义零保护。
- scene 簇捕获率 24.6% 显著高于旧审计的 7.5%：口径不同（本轮只含比较符翻转与数值偏移两类算子、只测读取方测试文件），不可直接对比；重命名误报 20.0% 与旧 28% 同量级。
- 被杀最多的源：`playback/boundary.ts` 6/6、`sceneryMaterials.ts` 1/6、`battleRuntime.ts` 1/6、`labelsRuntime.ts` 2/6、`renderer.ts` 2/5——多为常量/守卫数值，文本断言抓得到；而接线类语义（调用存在性）多数存活。
- **baselineRed 12 源定性：负载超时**——全部由同一批用例（`飞行段时长 = 真实飞行时长`、`mirrorShotData 镜像` 等重型 façade import 用例）在探针连续 vitest 进程下 5s 超时导致（单跑该用例 5160ms 边缘超时），非语义失败。这些源的守卫本轮无法评估，台账需单独标注；后续批次可在空载环境补测。

## Wave 1 Pilot 结果（seek 游标语义）

- 新增 `scene/playback/battleRuntime.seek.test.ts`（运行生产代码：真实 createBattleRuntime + 真实 transientFeedback3d）：seek 编排后不补播历史（壁钟反馈清空）、seek 后新事件仍触发且恰好一次（伤害 hpLoss=30 / 击毁 bursts=1）。
- `seekPointer.test.js`：删除已接替的源码文本守卫（transient/battle 内部实现断言），保留一条带 F3 标注的 façade glue Integration Contract 守卫；`buildBoundary 空边界`改为 createBoundaryBand 行为测试。
- **故障注入验证**：移除 `battleRuntime.clearEffects()` 中的 `transients.clear()` → 新测试立即变红（`hasActive()` 预期 false 实际 true），还原后复绿。证明新测试对 PR #411 P0 故障模式有真实捕获能力。
- 台账 validation_status：`seekPointer:59/66/79` 置 DONE（见 ledger-stats 重新生成）。

## Wave 2 sceneryMaterials 拆解结果

- `sceneryMaterials.test.js` 删除 23 个源码文本用例（含 1 个 describe 块），其余按 F3 窄化为带标注的 Integration Contract / K-shader 公式守卫；接替者为 10 个新行为测试文件（`sceneryMaterials.materials.test.ts`、`mapWorld.behavior.test.ts`、`groundPass.behavior.test.ts`、`playback/{battleRuntime.fx,hudFeed.behavior,labelsRuntime.gating,markers.toneMapped,sessionLifecycle.prewarm,util.behavior,vehicleRuntime.pose}.test.ts`），均直接 import 生产模块、不读源码；本批无生产代码改动。
- **故障注入验证（5 项，临时改生产源 → 跑接替测试 → 还原）**：

  | # | 注入 | 接替测试 | 结果 |
  |---|---|---|---|
  | 1 | `sessionLifecycle.startPlayback` 删 `deps.prewarmShaders()` | sessionLifecycle.prewarm | 变红 |
  | 2 | `mapWorld` 会话拆除不 dispose IBL 环境贴图 | mapWorld.behavior | 变红 |
  | 3 | `hudFeed.updateScore` team 1 阵亡不计分 | hudFeed.behavior | 首轮**存活**（fixture 只有 team 2 阵亡）→ 补 team 1 阵亡 fixture 后变红 |
  | 4 | `applyGlbToggle(false)` 不释放悬挂克隆几何 | vehicleRuntime.pose | 变红 |
  | 5 | 悬挂部件恒不挂载（`collectSuspensionParts` → null） | vehicleRuntime.pose | 变红 |

- 台账 `sceneryMaterials.test` 56 行回填 DONE / PARTIAL（PARTIAL = 宿主闭包无注入点，窄化保留接线子句）。

## 台账

逐例处置（改写 / 保留 / 删除 + 接替者）见 `2026-11-11-disposition-ledger.md`（人工映射全文）；统计与 D 项门禁见 `2026-11-11-ledger-stats.md`（由 `scripts/testing/ledger-stats.mjs` 自动生成，稳定 ID）。

## Known Risks / 诚实降级

- 分类器为结构化扫描非完整 AST：fixture 读取（如 `texture-bake.test.js` 读 bake-report.json）会进入清单，由台账人工剔除；`it.each` 按块计 1 例。
- 小样本探针（6+3）对单源的检测率方差大，单源数字只用于排序优先级；簇级汇总才可与旧基线对比。
- 语义探针只含两类算子（比较符翻转、数值偏移），少于旧审计的 40 个手工语义改动；捕获率是**下限**估计。
- Windows 上通过 `shell:true` 调用 vitest；exit code 语义已在冒烟中人工验证（变异后测试红→exit≠0）。
- baselineRed 的源被跳过，其守卫效力无法用本工具评估，台账需单独标注。
