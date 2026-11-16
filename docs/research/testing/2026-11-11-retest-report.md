# 测试效力复测（2026-11-11 baseline / 2026-11-16 复审更新，Issue #827 Step 0）

本文是 Issue #827 的 baseline 重建设，替代 `2026-11-test-effectiveness.md`（基线 `1cefa174c`，dated 证据）作为当前参照；不修改旧文档的历史结论。2026-11-16 复审在 PR #957 head（已合并最新 main）上重新生成 inventory 与三组探针矩阵，并修复了等价重命名、变异有效性分类、分类器正则切块与台账区间计数四处口径问题（见「评审跟进」）。

## 工具（已提交，可重复）

| 脚本 | 作用 |
|---|---|
| `scripts/testing/classify-source-text-tests.mjs` | 结构化扫描 frontend/src 全部 `*.test.*`，按用例粒度分类「引用生产源码文本」的断言；输出逐例清单 JSON。用例切块会跳过注释、字符串与正则字面量（源码守卫常用的 `/...\{.../` 不再截断用例体）；边界未闭合的用例记入 `parseAnomalies`，不静默判成非文本测试；Windows CRLF 检出统一归一为 LF。仍非完整 AST，逐例处置需人工复核（见台账）。 |
| `scripts/testing/source-text-probes.mjs` | 对每个「生产源文件 → 读取方测试集合」执行语义变异探针（FLIP_CMP / NUM_OFF，变异点必须落在注释/字符串区间外）与等价重命名探针。变异先过解析校验：不可解析的变异记 invalid，不计入捕获率；vitest 非零退出但无断言失败（转换/收集错误、超时）记 invalid/inconclusive。等价重命名按 TypeScript symbol 的绑定身份，只改声明与同 symbol 引用（保留关键字、属性键、字符串与对外导出名）；内置 `from` 负面控制自检（整词替换会破坏 import，绑定重命名不会）。固定 seed=827；未变异基线必须全绿否则跳过该源并如实记录。 |
| `scripts/testing/source-text-inventory.json` | 分类器输出快照（生成于 2026-11-16，PR #957 head）。 |
| `scripts/testing/probe-matrix-*.json` | 探针原始矩阵（scene / css / vue 三组，2026-11-16 在同一棵树重新生成）。 |

复现方式：干净 checkout → `node scripts/testing/classify-source-text-tests.mjs` → `node scripts/testing/source-text-probes.mjs --inventory ... --out ...`。探针在独立检出上运行（会临时改写生产源文件），不要在未提交工作区运行。

快照口径：本报告的数字以 PR #957 最终 head 的树为准（Wave 1–3 已改写 / 删除文本守卫后的树，且已合并最新 main）。inventory 重跑为 **444 个测试文件 / 69 个读取生产源码 / 231 个文本断言用例**（parseAnomalies=0；含 `.toContain`、`stripComments(readSrc(...))` 包装器与 `[read(...), ...].join()` 数组聚合读取变量）；矩阵在同一棵树上用 seed=827 重新生成。历史基线用同一分类器在历史提交 67fdb2be 的树上重建为 `scripts/testing/source-text-inventory-wave0.json`（300 个文本用例），只用于历史台账对齐，不与当前 231 例直接比较。

## 规模与裁剪说明

- 本轮每源文件探针上限：语义 6、重命名 3（旧审计为 40+15，按本会话运行时长裁剪；脚本可用 `--max-semantic/--max-rename` 调高，结论梯度见 Known Risks）。原审计「每模块簇 ≥20 语义 + 10 重命名」的下限在 per-source 视角下由 scene 簇聚合近似覆盖（scene 簇含 ~26 个源文件）。
- 探针范围：`src/scene/` 读取的生产源、`.css`、`.vue`。数据契约（读 `.json` 产物）、`api/*` 与 ownership/config 守卫不在范围。

## Inventory 结果（PR #957 head，2026-11-16）

- 扫描 444 个测试文件；69 个读取生产源码；其中 **231 个用例**的断言引用源码文本（parseAnomalies=0）。
- 集中地：`components/AgentArmorView.dom-contract.test.js`（57）、`scene/sceneryMaterials.test.js`（52）、`scene/playbackScene.occlusion.test.js`（15）、`scene/groundPass.test.js`（13）、`vehicle-models/extractor.test.js`（7）、`app/navigationPressedFeedback.test.js` / `scene/pickDebug.test.js` / `styles/light-theme-source-regression.test.js`（各 5）等。完整清单见 `scripts/testing/source-text-inventory.json` 与台账草稿 `2026-11-11-disposition-ledger-draft.md`。
- 旧审计 251 例、早期分类器快照 181 例与重建后的历史基线 300 例不是同一口径：181 与 300 是**同一历史树（67fdb2be）**上的分类器前后结果，181→300 的增量来自漏判修正（正则切块截断用例体、缺 `.toContain`、`stripComments(readSrc(...))` 包装器与 `[read(...), ...].join()` 数组聚合读取未登记）；251 是更早审计的独立口径，不与二者直接比较。当前树 231 例则是 Wave 1–3 改写/删除文本守卫后的剩余（部分文件如 tankViewer.distance/cameraPreset 已是混合行为测试）。三组数字只在各自口径内使用。

## 探针 Baseline（PR #957 head，seed=827，2026-11-16 重生成）

| 簇 | 探测源 | 跳过（baselineRed） | 语义捕获（有效变异） | invalid | inconclusive | 等价重命名误报 |
|---|---|---|---|---|---|---|
| scene | 42 | 0 | **11/213（5.2%）** | 34 | 0 | **14/126（11.1%）** |
| css | 4 | 0 | 1/24（4.2%） | 0 | 0 | 0/0（.css 跳过重命名探针） |
| vue | 20 | 0 | **0/114（0.0%）** | 0 | 0 | 0/0（模板引用不在同一 AST，跳过） |
| 合计 | 66 | 0 | 12/351（3.4%） | 34 | 0 | 14/126（11.1%） |

逐源矩阵：`scripts/testing/probe-matrix-{scene,css,vue}.json`。要点：

- 本表是 **Wave 1–3 改写后的剩余源码文本断言** 的效力，不是新行为测试的效力；scene 探测源 42、文本用例 231（含 `.toContain`、包装器读取变量与数组聚合读取），与旧 24.6% 不可直接对比。
- **组件源（.vue）仍零捕获（0/114）**：模板/样式内的字面量语义没有读取方文本守卫（新增的 `.toContain` 读取方均未被语义变异杀死）。
- scene 被杀最多的源：`heSplash.ts` 3/5、`viewer/viewerMath.ts` 3/6、`viewer/trajectoryCard.ts` 2/5；`groundPass.js` / `playback/renderer.ts` / `viewer/armorShaders.ts` 各 1；其余源本轮 0 捕获（`materialDispose.ts` 6 个语义候选全部 parse-invalid，记 0/0——**无有效证据，不解释为受保护**）。接线类语义（调用存在性）多数存活。
- 等价重命名误报 14/126（11.1%）：`playback/cameraRuntime.ts` 2/3，`groundPass.js` / `materialDispose.ts` / `penetration.js` / `playback/labelsRuntime.ts` / `playback/mapAssets.ts` / `playback/mapWorld.ts` / `playback/renderer.ts` / `playback/vehicleRuntime.ts` / `sceneryAssembly.ts` / `tankViewer.js` / `viewer/judgment.ts` / `viewer/trajectoryCard.ts` 各 1/3——说明这些读取方测试仍依赖局部标识符的**名字**（例如源码正则里出现变量名），不是行为断言；`AgentArmorView.dom-contract.test.js` 的 `kernel` 是多个 scene 源的聚合文本，其文本守卫同时关联轨迹/结果卡等源，是新增误报的主要来源（聚合读取的过近似见 Known Risks）。含 shorthand / 无别名 export 的候选已整条跳过，不进入分母。
- **invalid 34 个变异**（parse 校验失败，未计入捕获率）：`materialDispose.ts` 6、`sceneryAssembly.ts` 4、`playback/mapWorld.ts` 3，`playback/battleRuntime.ts` / `sceneryInstancing.ts` / `viewer/equipmentState.ts` 各 2，其余 15 个源各 1（`groundGeometryData` / `heSplash` / `armorHighlight` / `labelsRuntime` / `mapAssets` / `pickReport` / `renderer` / `vehicleRuntime` / `viewer/aimInput` / `viewer/armorShaders` / `viewer/dataLoader` / `viewer/diagnosticProbe` / `viewer/resultCardPosition` / `viewer/shotReplay` / `viewer/trajectoryCard`）。全部是 FLIP_CMP 命中 TS 泛型/类型实参（`<T>` 被当作比较符），解析校验正确拒收；这些位点不进入分母，也不记为“存活”。
- 本轮 66 个源的读取方基线全部全绿（baselineRed=0、inconclusive=0）；失败探针都能归入断言失败 / 解析失败两类。

## 评审跟进（2026-11-16）

- **等价重命名改为 TypeScript symbol 绑定重命名**：只改声明与同 symbol 引用，属性名 / 对外导出名 / import 关键字 / 字符串不动。shorthand（`{ name }`）与无别名 `export { name }` 的 checker symbol 不是变量绑定，必须在 symbol 相等判断**之前**用 `getShorthandAssignmentValueSymbol` / `getExportSpecifierLocalTargetSymbol` 解析，命中即保守跳过整条绑定；`export { local as publicName }` 只改 local、保留对外名。内置 `from` 负面控制（整词替换会产出 `import * as THREE from__r 'three'` 且 parse 失败）+ shorthand / 无别名 export / 有别名 export 三个独立反例，见矩阵 `selfCheck.negativeControl` 与 `selfCheck.bindingSafety`。
- **变异有效性分类**：变异先过 TS/SFC 解析校验；不可解析记 invalid，vitest 非零退出但无断言失败（转换/收集错误、超时）记 invalid/inconclusive；只有真实断言失败计 killed。本轮 scene invalid=34、inconclusive=0。
- **分类器**：用例切块跳过注释 / 字符串 / 正则字面量；`setSpeed 只接受档位表内的值`（正则里含 `\{`）重新分类为 `textAssertion=true`（`usesVars=[src]`）；新增 `.toContain` / `.toContainEqual`，识别 `stripComments(readSrc(...))` 这类包装器读取变量（`lblSrc` / `vehSrc` 等），并识别 `[read('a'), read('b')].join(...)` 数组聚合读取——数组里每个目标都登记到接收变量（`kernel`），否则整个文件的源码守卫会漏采（`AgentArmorView.dom-contract.test.js` 29→57 例）。历史树重建 181→300，当前树 231；`light-theme-source-regression` 2→5，`groundPass.test` 历史树上 5→13。未闭合边界会进 `parseAnomalies`（当前 0）；Windows CRLF 检出归一为 LF。
- **台账统计**：对齐基线改为用**修正后的分类器**在历史提交 67fdb2be 的树上重建的快照 `source-text-inventory-wave0.json`（300 个文本用例，保留历史行号）；映射使用完整 baseline cases（含改写后的行为测试），floor 距离超出容差即未映射，不再先过滤 `textAssertion` 再向前借 case。review 指定三例已加断言：`1128→sceneryMaterials:1127`、`1306→sceneryMaterials:1305`、`1375→sceneryMaterials:1373`。当前台账：R=136 / K=160 / D=79（处置覆盖），唯一 case=373，跨处置冲突=2，未映射单行=0，映射到行为 case 128 行（单列人工确认），scope 缺口 17 / 300。详见重新生成的 `2026-11-11-ledger-stats.md`。
- **Wave 2 被删守卫接替**：新增真实 extras 解析链路（`resolveSceneryExtras` → `makeTexResolvers` → 装配，含漏登记负向对照）、GLB 根四元数三轴断言、prewarm 等待未完成 GLB Promise、roster reset 后旧行不被 stale 投影写入。

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

- 分类器仍为结构化扫描而非完整 AST：fixture 读取（如 `texture-bake.test.js` 读 bake-report.json）会进入清单，由台账人工剔除；`it.each` 按块计 1 例。用例切块已跳过注释/字符串/正则，但模板字符串里的 `${}` 仍按字符串整体处理。
- 数组聚合读取（如 `kernel = [read(a), read(b)].join()`）按「用例引用接收变量 → 关联数组内所有源」归类，属于**过近似**：单个断言无法区分它实际针对哪个源，探针可能把只改写其他源文本的变异记为 killed（或 reverse：断言匹配到别的源而存活）。矩阵已按此口径重跑；此类来源的逐源捕获率只能当上限/排序用，不能当单源精确效力。
- 小样本探针（6+3）对单源的检测率方差大，单源数字只用于排序优先级；簇级汇总才可与旧基线对比。探针只跑「读取生产源码文本」的读取方测试，**不评估新行为测试**；捕获率是剩余文本守卫的下限估计。
- 语义探针只含两类算子（比较符翻转、数值偏移），少于旧审计的 40 个手工语义改动；解析不可表示的变异记 invalid，不进入分母。
- 等价重命名只在单文件内按 TS symbol 重命名；`.vue` 跳过（模板引用不在同一 AST），跨文件导出名不改。shorthand / 无别名 export / 新名冲突的绑定整条 fail-closed 跳过，**不进入 rename 分母**；有别名 export 只改 local、保留对外名（见 `selfCheck.bindingSafety`）。
- Windows 上通过 `shell:true` 调用 vitest；超时/转换错误与断言失败已分开记录（invalid/inconclusive），不再把非零退出一律计 killed。
- baselineRed 的源仍会被跳过（本轮 0）；其守卫效力无法用本工具评估，台账需单独标注。
