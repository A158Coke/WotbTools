// 装甲查看器 ↔ 场景内核的 DOM 契约守卫（审计 3D-14 移动端重排的护栏）。
//
// tankViewer.js 不看 props、不响应组件状态：它按固定 ID 在 .armor-view 子树里查节点
// （getElementById），查不到时静默跳过（null 保护）——重排布局、搬动/删除元素时漏一个 ID，
// 表现只是「某个控件点了没反应」，没有任何报错。这里锁定：内核查找的每个静态 ID 都必须由
// 组件模板提供；内核自己创建的节点（调试面板 / 世界模式滑块等）不属于模板契约。
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const read = (rel) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8')
const judgmentResult = read('../scene/viewer/judgmentResult.ts')
const heatmapPass = read('../scene/viewer/heatmapPasses.ts')
const plateModel = read('../scene/viewer/armorPlateModel.ts') + '\n' + read('../scene/viewer/armorPenetrationScenes.ts')
// 板分类/配置选择/穿透场景构建的共享实现（装甲查看器与 3D 回放同用）

describe('gap-armor first-layer ricochet surfacing (heatmap)', () => {
  // 穿透材质族 2026-10-24 出仓 viewer/armorShaders.js（Step B2）：着色器模式断言
  // 拼接读取两份源（not.toMatch 同时约束两侧；RT/注入点等留在 tankViewer 的代码两处都可命中）
  const kernel = [read('../scene/tankViewer.js'), read('../scene/viewer/turretRig.ts'), read('../scene/viewer/modelLifecycle.ts'), read('../scene/viewer/heatmap.ts'), read('../scene/viewer/judgment.ts'), read('../scene/viewer/trajectoryCard.ts'), read('../scene/viewer/diagnosticProbe.ts'), read('../scene/viewer/shotReplay.ts'), read('../scene/viewer/shotReplayMiss.ts'), read('../scene/viewer/debugUi.ts'), read('../scene/viewer/equipmentState.ts'), read('../scene/viewer/collisionView.ts'), read('../scene/viewer/viewerMath.ts'), read('../scene/viewer/dataLoader.ts'), read('../scene/viewer/aimInput.ts')].join('\n') + '\n' + [read('../scene/viewer/armorShaders.ts'), read('../scene/viewer/armorPrimaryShader.ts')].join('\n')
  const pen = read('../scene/penetration.js')
  const penGeometry = read('../scene/penetrationGeometry.ts')
  it('逐层归一化：SPACED_FRAG 写每层最终等效厚度，PBR 直接累加', () => {
    const thickness = kernel.slice(kernel.indexOf('const SPACED_FRAG'), kernel.indexOf('const SPACED_STATE_FRAG'))
    const state = kernel.slice(kernel.indexOf('const SPACED_STATE_FRAG'), kernel.indexOf('function spacedCommonUniforms'))
    // 厚度通道：每块间隙板独立计算 2×/normalization 后的 finalThick；不得含深度/首层推断。
    expect(thickness).toMatch(/bool twoCal = caliber > thickness \* 2\.0 && thickness > 0\.0;/)
    expect(thickness).toMatch(/float finalNorm = twoCal/)
    // 掠射角余弦必须有 1e-6 下界（与 resolveLayerGeometry 一致），防 inf/负厚度。
    expect(thickness).toMatch(/float finalThick = thickness \/ max\(cos\(max\(0\.0, angle - finalNorm\)\), 1e-6\);/)
    expect(thickness).toMatch(/gl_FragColor = vec4\(finalThick \/ penetration, 1\.0, 0\.0, 1\.0\);/)
    // 跳弹只在 RT1 最近板状态通道判定；RT0 不得把后续高倾角板写成 R=1。
    expect(thickness).not.toMatch(/angle >= ricochet/)
    expect(thickness).not.toMatch(/isFirstSpaced|linState|stateD|camNear|camFar|0\.05/)
    // 状态通道：精确最近层独占（NoBlending+depthWrite）+ R=跳弹标志 / G=续飞编码；
    // B 不承载转正差额（R 已逐层归一化）；它传递可在 8-bit RT 往返的续飞退出码。
    expect(state).toMatch(/rcContinue\(wPosR, reflR, penetration \* RC_RICO_MUL/)
    expect(state).not.toMatch(/losThick|normThick|delta/)
    expect(state).toMatch(/gl_FragColor = vec4\(ricocheted \? 1\.0 : 0\.0, bCode, rcDiag \/ 255\.0, 0\.0\);/)
    expect(kernel).toMatch(/rcDiag = floor\(spacedState\.b \* 255\.0 \+ 0\.5\);/)
    // 名义被挡但概率 1–99%：G 编码概率带而不是硬红 1.0；PBR 就地续飞同理。
    expect(state).toMatch(/float pct = floor\(p \* 100\.0 \+ 0\.5\);/)
    expect(state).toMatch(/bCode = \(pct >= 1\.0 && pct <= 99\.0\) \? 0\.2 \+ 0\.6 \* p : 1\.0;/)
    expect(kernel).toMatch(/if \(pct >= 1\.0 && pct <= 99\.0\) penChance = p;/)
    const packSrc = read('../scene/armorCollisionPack.ts')
    expect(packSrc).toMatch(/pct >= 1 && pct <= 99 \? p : 0/)
    expect(kernel).toMatch(/function spacedStateMaterial[\s\S]{0,420}?depthWrite: true, depthTest: true, blending: THREE\.NoBlending,/)
    // 外部模块状态：只写 A=1，RGB 保留；自定义混合 RGB src=0/dst=1、A src=1/dst=0；
    // PBR 用 A 抑制其后间隙板跳弹。
    expect(kernel).toMatch(/function moduleStateMaterial\(clip: Plane \| null \| undefined\): ShaderMaterial \{/)
    expect(kernel).toMatch(/blendSrc: THREE\.ZeroFactor, blendDst: THREE\.OneFactor/)
    expect(kernel).toMatch(/blendSrcAlpha: THREE\.OneFactor, blendDstAlpha: THREE\.ZeroFactor/)
    const stateScene = plateModel.slice(plateModel.indexOf('function populateSpacedStateScene'), plateModel.indexOf('function populatePrimaryArmorScene'))
    expect(stateScene).toMatch(/meshes\.primary\.forEach/)
    // 状态 clone 先用 moduleStateMaterial 建材质（再按源材质 side 设双面），再 addClone
    expect(stateScene).toMatch(/const sm = mats\.moduleStateMaterial\(/)
    expect(stateScene).toMatch(/sm\.side = node\.userData\.moduleDoubleSided \? THREE\.DoubleSide : THREE\.FrontSide/)
    expect(stateScene).toMatch(/addClone\(scene, node, sm, 3\)/)
    // PBR：RT0.R 已是逐层 normalized effective；直接累加，不再用 RT1.B 做最近层差额。
    expect(kernel).toMatch(/highp float totalConsume = spacedSatBlocked \? 1\.0 : max\(0\.0, rawTotal\);/)
    // B 的唯一消费者是上方锁定的诊断解码，不参与厚度或穿深计算。
    expect(kernel.match(/spacedState\.b/g)).toHaveLength(1)
    expect(kernel).toMatch(/float spacedThick = totalConsume \* penetration;/)
    expect(kernel).toMatch(/bool moduleInFront = spacedState\.a > 0\.5;/)
    expect(kernel).toMatch(/bool gapRicochet = underSpaced && spacedState\.r > 0\.5 && !moduleInFront;/)
    // BlitzKit：主装甲无论前面有无间隙甲，都独立套用自身 normalization/2×；
    // 3× overmatch 只表示真实口径规则，跳弹抑制另外由 underSpaced 承担。
    expect(kernel).not.toMatch(/hasSpacedArmor/)
    expect(kernel).toMatch(/bool threeCal = caliber > thickness \* 3\.0;/)
    expect(kernel).not.toMatch(/bool threeCal = caliber > thickness \* 3\.0 \|\| underSpaced;/)
    expect(kernel).toMatch(/bool noRicochet = threeCal \|\| underSpaced;/)
    expect(kernel).toMatch(/float norm = twoCal/)
    // 间隙甲作为整体参与 CDF（单层精确；GPU additive 只有聚合厚度）；外部模块 B=flat。
    expect(kernel).toMatch(/gl_FragColor = vec4\(thickness \/ penetration, 0\.0, thickness \/ penetration, 1\.0\);/)
    expect(kernel).toMatch(/if \(spacedEff > 0\.0\)/)
    const gapStart = kernel.indexOf('if (gapRicochet) {')
    expect(gapStart).toBeGreaterThan(-1)
    const gapSeg = kernel.slice(gapStart, gapStart + 900)
    expect(gapSeg).toMatch(/float code = spacedState\.g;/)
    expect(gapSeg).not.toContain('rcContinue')
  })
  it('热力图用 flat vNormal 面法线 + highp 视线方向（移动端 mediump 回归）', () => {
    // 装甲几何在 loadModels 中 toNonIndexed + computeVertexNormals ⇒ 每个三角形的
    // vNormal 已是几何面法线，与点击判定 hit.face.normal 同源。3.13.0 的
    // dFdx/dFdy(vViewPos) 在移动端 mediump(fp16) 下逐像素导数量化/退化，导致热力图错乱
    // （2026-10-19 修复）；这里锁定三个热力图 shader 都使用 flat vNormal。
    // 视线方向必须 highp：500 m 处 mediump length(vViewPos) 在平方时溢出，角度会坏。
    expect(plateModel).toMatch(/toNonIndexed\(\)/)
    expect(plateModel).toMatch(/computeVertexNormals\(\)/)
    expect([...kernel.matchAll(/highp vec3 nFace = normalize\(vNormal\);/g)]).toHaveLength(3)
    expect([...kernel.matchAll(/varying highp vec3 vViewPos;/g)]).toHaveLength(5)
    expect([...kernel.matchAll(/highp vec3 viewDir = normalize\(vViewPos\);/g)]).toHaveLength(3)
    expect([...kernel.matchAll(/highp float angle = acos\(/g)]).toHaveLength(3)
    expect(kernel).not.toMatch(/dFdx\(vViewPos\)/)
    expect(kernel).not.toMatch(/length\(vViewPos\)/)
    expect(kernel).toMatch(/highp vec3 nVR = nFace;/)
    expect(kernel).not.toMatch(/extensions: \{ derivatives: true \},/)
  })
  it('管线消费模型 = Σ逐层归一化等效厚度（两块间隙板都转正；BlitzKit）', () => {
    // 两块 20mm@60°（相隔 0.02m）+ 100mm 主装甲@0°，AP 100/164/5°。
    // 每块间隙板 2× 增强转正 17.5° → 27.1268；RT0 累加两层的 finalThick/P；
    // 总 27.1268×2 + 100 = 154.25 < 164 → PENETRATION（不再只看最近层差额）。
    const twoCalNorm = (1.4 * 5 * 100) / (2 * 20)
    const normEach = 20 / Math.cos(Math.max(0, 60 - twoCalNorm) * Math.PI / 180)
    expect(Math.abs(normEach - 27.1268)).toBeLessThan(0.02)
    const pipeline = normEach + normEach
    expect(pipeline + 100).toBeLessThan(164)   // → PENETRATION（与 CPU/点击链同判）
  })
  it('累计格式：半浮点 RT 保留 >1 累计 + 能力检测 + 8 位回退饱和守卫（review 2026-10-13 P2）', () => {
    const rtFn = kernel.slice(kernel.indexOf('function spacedRTFloatCapable'), kernel.indexOf('function syncPenetrationRT'))
    // 能力检测：优先 EXT_color_buffer_float / EXT_color_buffer_half_float（RGBA16F 可渲染且可混合）
    expect(rtFn).toMatch(/getRenderer\(\)\.extensions\.has\('EXT_color_buffer_float'\)/)
    expect(rtFn).toMatch(/getRenderer\(\)\.extensions\.has\('EXT_color_buffer_half_float'\)/)
    // 两个 RT（厚度 + 状态）同格式：半浮点优先，回退 8 位
    expect(rtFn).toMatch(/spacedRTFloatCapable\(\) \? THREE\.HalfFloatType : THREE\.UnsignedByteType/)
    expect((rtFn.match(/type: rtType,/g) || []).length).toBe(2)
    // 回退守卫：PBR uniform 默认 0（浮点语义），注入点按实际格式置 0/1
    expect(kernel).toMatch(/spacedSatGuard: \{ value: 0 \},/)
    expect(heatmapPass).toMatch(/spacedSatGuard\.value = rtIsFloat \? 0 : 1;/)
    expect(heatmapPass.replace('spacedSatGuard.value = rtIsFloat ? 0 : 1;', '')).not.toMatch(/spacedSatGuard\.value = rtIsFloat \? 0 : 1;/)
    expect(heatmapPass).toMatch(/const rtIsFloat = spacedRTFloatCapable\(\);/)
    // 8 位 R 饱和 = 真实累计厚度未知，必须 fail-closed，不能当成恰好一份穿深算 CDF。
    expect(kernel).toMatch(/spacedSatBlocked = spacedSatGuard > 0\.5 && rawTotal >= 1\.0;/)
    expect(kernel).toMatch(/if \(spacedSatBlocked\) \{/)
  })
  it('累计格式：逐层 normalized R 可 >1；8 位饱和按整穿深保守处理', () => {
    // 两块 40mm 间隙甲均 @69°（相隔 0.2m）+ 25mm 主装甲 @0°，AP 100/100/5°。
    // 每层 2× 转正 8.75° → 80.609975mm；Σ normalized / pen = 161.22/100 = 1.6122 > 1。
    const pen = 100
    const twoCalNormDeg = (1.4 * 5 * 100) / (2 * 40)                 // 8.75°
    const normEach = 40 / Math.cos((69 - twoCalNormDeg) * Math.PI / 180)
    expect(Math.abs(normEach - 80.609975)).toBeLessThan(1e-3)
    const sumRatio = (normEach + normEach) / pen
    expect(sumRatio).toBeGreaterThan(1)                              // 逐层 normalized R 可 >1
    expect(normEach + normEach + 25).toBeGreaterThan(pen)            // 与点击链同判 BLOCKED
    // 8 位：逐次 additive 先钳到 1；PBR 的 saturated guard 按整穿深计，保守为 BLOCKED。
    const q8 = (x) => Math.round(Math.min(1, Math.max(0, x)) * 255) / 255
    const accumulate = (q) => { let acc = 0; for (let i = 0; i < 2; i++) acc = q(acc + q(normEach / pen)); return acc }
    expect(accumulate(q8)).toBe(1.0)
    const rem8 = pen - Math.max(0, Math.min(1, accumulate(q8))) * pen
    expect(rem8).toBeLessThan(25)
    // 半浮点：保留 >1 总量，同样被两层间隙甲耗尽。
    const rem16 = pen - (normEach + normEach)
    expect(rem16).toBeLessThan(25)
  })
  it('rcContinue 双实现：每个非外部层独立转正（BlitzKit）', () => {
    const packSrc = read('../scene/armorCollisionPack.ts')
    expect(packSrc).not.toMatch(/armorIdx|hitIdx/)
    expect(packSrc).toMatch(/float normR = twoCal/)
    expect(packSrc).toMatch(/const normR = twoCal/)
  })
  it('点击链：每个非外部层独立转正（BlitzKit）', () => {
    // 几何规则已收敛到 resolveLayerGeometry，确定性与概率链共用。
    expect(penGeometry).toMatch(/function resolveLayerGeometry\(ah: Hit, thickness: number, ctx: GeometryContext\)/)
    expect(penGeometry).toMatch(/const effNormalization = normalization/)
    expect(penGeometry.replace('const effNormalization = normalization', 'const effNormalization = 0')).not.toMatch(/const effNormalization = normalization/)
    expect(penGeometry).not.toMatch(/armorLayerCount/)
    expect(penGeometry).toMatch(/const noRicochet = \(contact \? contact\.three_calibers : threeCalibersRule\)\s*\n\s*\|\| ctx\.layerIndex > 0 \|\| !ctx\.allowRicochet/)
    // overmatch 字段只报真实 3× 口径，不再用 layerIndex/allow_ricochet 冒充
    expect(penGeometry).toMatch(/const threeCalibersRule = ctx\.caliber > thickness \* 3\.0\r?\n/)
  })
  it('主热力图按确定性 1× 等效厚度消耗（与判定一致，不再用 3× 概率模型）', () => {
    expect(kernel).toMatch(/pMin -= totalConsume \* penetration;/)
    expect(kernel).toMatch(/pMax -= totalConsume \* penetration;/)
    expect(kernel).not.toMatch(/3\.0 \* spacedEff/)
    expect(kernel).toMatch(/highp float sigma = max\(\(pMax - pMin\) \/ 6\.0, 1e-4\);/)
  })
  it('AP/APCR/HEAT 使用概率链统一判定；HE/跳弹保留确定性分支', () => {
    // 概率 0/100 不得覆盖确定性 PENETRATION/BLOCKED；否则 252AP 打
    // 21.5+207mm 的确定性穿透会被 3× 概率误判成未击穿。
    expect(kernel).not.toMatch(/chanceOutcome/)
    // 卡片 presentation（标题 partial / 概率行 / 层概率着色 / hasChance→满伤口径）
    // 已出仓 viewer/shotResultCard.ts（Wave B3A），对应行为断言在
    // src/scene/viewer/shotResultCard.test.ts；这里锁定内核侧的判定与接线。
    expect(kernel).toMatch(/evaluateProbabilityChain\(chancePen, probLayers\)/)
    expect(kernel).toMatch(/const probabilityMode = options\.probabilityMode === true && !blockedNoPrimary;/)
    // 无主装甲阻断是终态：概率/满伤不得回填。
    expect(kernel).toMatch(/allowChance = allowChance && !blockedNoPrimary/)
    expect(judgmentResult).toMatch(/!isHE && !blockedNoPrimary/)
    expect(judgmentResult.replaceAll('!isHE && !blockedNoPrimary', '')).not.toMatch(/!isHE && !blockedNoPrimary/)
    expect(kernel).toMatch(/const \{ chance: cardChance \} = resolveCardChance\(\{/)
    // HE 命中首个 Primary 也走概率卡；非 Primary 的间隙/模块保留首面爆炸分支。
    expect(judgmentResult).toMatch(/const heFirstPrimary = isHE && hitsForCheck\.length > 0/)
    expect(judgmentResult).toMatch(/heFirstPrimary && hasProbabilityChain\s*\n\s*&& hasPrimaryLayer\(res\.probability_layers\)/)
    expect(judgmentResult).toMatch(/heFirstPrimary && hePenChance > 0/)
    // 概率链与确定性链停在同一个收集边界（首个 Primary 含），该行为由
    // penetration.heat-origin.test.js「收集链」用例驱动 calculate() 验证；本文件只锁依赖关系。
  })
  it('HE 零/缺失 explosion_radius 不进入 generic probability card', () => {
    // 计算层已 fail-closed（BLOCKED / 0 damage / res.he=null）；UI 的概率卡还必须
    // 要求合法 splash data，否则 first Primary + chain 会把结果覆盖成
    // May penetrate / PENETRATION full damage。
    expect(judgmentResult).toMatch(/heInfo != null && heRadius > 0 && heFirstPrimary && hePenChance > 0/)
    expect(judgmentResult).not.toMatch(/\(!isHE \|\| \(heFirstPrimary && hePenChance > 0\)\)/)
  })

  it('HE 采样三态：samples:0 是权威零伤害、he_splash_error 显式 ERROR，不落单射线兜底', () => {
    // 判定层：采样结果（含 samples:0）优先；采样器跑不了时 ERROR，绝不回退单射线。
    expect(pen).toContain('he_splash_error')
    expect(pen).toMatch(/\(heData && heData\.unavailable\)\s*\n?\s*\?\s*'ERROR'/)
    expect(pen).toContain("source: 'sampler'")
    expect(pen).toContain('unavailable: true')
    expect(pen).toContain("source: 'single-ray'")
    // 视图层：三种失败原因都上抛 reason，网格失败不再静默。
    expect(kernel).toContain('he_splash_error: heSplashError')
    expect(kernel).toContain("'collision-pack:'")
    expect(kernel).toContain("'collision-grid:'")
    expect(kernel).toContain("'sampler:invalid-input'")
    // unavailable/原因展示随结果卡出仓 viewer/shotResultCard.ts（行为断言在
    // shotResultCard.test.ts）；内核侧锁 heInfo 原样交给 renderer。
    expect(kernel).toMatch(/renderShotResultCardHtml\(\{[\s\S]*?heInfo,/)
  })

  it('判定输入缺数据时 fail-closed：无 120mm 静默默认、未知弹种不落到 HE', () => {
    expect(kernel).not.toMatch(/sh\.caliber \|\| 120/)
    expect(kernel).not.toContain('shooterCaliber = 120')
    expect(kernel).toContain('function resolveCaliberFor')
    expect(kernel).toContain('resolveCaliberFor(sh)')
    expect(plateModel).toContain('未知弹种 fail-closed')
    expect(kernel).toContain('resolveShotCaliber() > 0')
  })

  it('爆炸弹间隙甲/模块耗尽穿深时仍走 SPLASH/BLOCKED 分支，不落进贯穿 CDF', () => {
    // review 2026-10-18：100mm HE 打 100mm 间隙甲 + 1mm 主甲，rem<=0 时
    // 不能落到通用高斯贯穿 CDF；canSplash 必须独立于 rem>0 处理。
    expect(kernel).not.toMatch(/isExplosive && rem > 0\.0/)
    expect(kernel).toMatch(/if \(isExplosive\) \{/)
    // HE canSplash 强制非贯穿；HEAT 仍做 gap 衰减并进入 CDF（区间正尾可穿）。
    expect(kernel).toMatch(/else \{\s*\/\/ HEAT gap decay/)
    expect(kernel).not.toMatch(/HEAT 被间隙甲耗尽/)
  })
  it('单间隙层 + 前置外部模块：间隙甲 CDF 使用模块平移后的区间', () => {
    // review 2026-10-18 反例：chassis20 → spaced80 → hull1，卡片 13.7%；
    // 旧 shader 用原始 penetration 算间隙层 CDF，得到 27.4%。
    // 均值保留符号：模块厚于穿深时仍可能有正向尾部，不得 max(0, ·) 截断。
    expect(kernel).toMatch(/spacedProbBase = moduleInFront \? \(penetration - moduleFlat\) : penetration;/)
    expect(kernel).not.toMatch(/max\(0\.0, penetration - moduleFlat\)/)
    expect(kernel).toMatch(/aiNormalCdf\(\(spacedProbBase - spacedEff\)/)
  })
})

// 坦克选择菜单封面图展示裁剪契约（2026-10-15；2026-10-17 起菜单改为与坦克百科共享
// TankCatalogMenu）：卡片图按逐车内容框缩放定位，盒比例是变换数学的契约——组件常数
// 与 .tp-media 的 aspect-ratio 必须一致，且盒子不再用固定高度（固定高会让比例随卡片
// 宽度漂移、内容框换算失准）。
describe('production gun_mask clip wiring (2026-10-21)', () => {
  // 穿透材质族 2026-10-24 出仓 viewer/armorShaders.js（Step B2）：uniform 注入断言拼接读取两份源。
  // 2026-10-28：保持 BlitzKit 口径——gun_mask 标量重建的裁切面每帧同步到续飞着色器。
  const kernel = [read('../scene/tankViewer.js'), read('../scene/viewer/turretRig.ts'), read('../scene/viewer/modelLifecycle.ts'), read('../scene/viewer/heatmap.ts'), read('../scene/viewer/judgment.ts'), read('../scene/viewer/trajectoryCard.ts'), read('../scene/viewer/diagnosticProbe.ts'), read('../scene/viewer/shotReplay.ts'), read('../scene/viewer/shotReplayMiss.ts'), read('../scene/viewer/debugUi.ts'), read('../scene/viewer/equipmentState.ts'), read('../scene/viewer/collisionView.ts'), read('../scene/viewer/viewerMath.ts'), read('../scene/viewer/dataLoader.ts'), read('../scene/viewer/aimInput.ts')].join('\n') + '\n' + [read('../scene/viewer/armorShaders.ts'), read('../scene/viewer/armorPrimaryShader.ts')].join('\n')
  it('PBR 与间隙甲状态材质都注入同一 rcClipPlane/rcClipEnabled，且每帧同步 gunClipPlane', () => {
    const occurrences = [...kernel.matchAll(/rcClipPlane:\s*rcUniforms\.rcClipPlane/g)]
    expect(occurrences).toHaveLength(2)
    expect(kernel).toContain('rcClipEnabled: rcUniforms.rcClipEnabled')
    expect(heatmapPass).toContain('rcUniforms.rcClipPlane.value.set(')
    expect(heatmapPass.replace('rcUniforms.rcClipPlane.value.set(', '')).not.toContain('rcUniforms.rcClipPlane.value.set(')
    expect(heatmapPass).toContain('rcUniforms.rcClipEnabled.value = true;')
    expect(kernel).toContain('clipPlane: hm.getGunClipPlane()')
  })
  it('无效 HE 概率行走 resolveCardChance fail-closed', () => {
    expect(kernel).toContain('resolveCardChance({')
    expect(kernel).toContain('const { chance: cardChance } = resolveCardChance({')
  })
  it('非跳弹的 0mm 板不显示“跳弹 (-25% 穿深)”子标签', () => {
    // 子标签行为随结果卡出仓 viewer/shotResultCard.ts（行为断言在 shotResultCard.test.ts）。
    expect(kernel).toMatch(/renderShotResultCardHtml\(\{[\s\S]*?result, layers(?:: displayLayers)?,[\s\S]*?partialChainLayers,/)
  })
  it('跳弹续飞 1–99% 的中段卡片显示满伤，而不是确定性 0', () => {
    // 满伤口径（chancePartial ? dmgVal : dmgDealt）的行为断言在 shotResultCard.test.ts；
    // 内核侧锁 chancePartial 的判定与传递。
    expect(kernel).toMatch(/renderShotResultCardHtml\(\{[\s\S]*?chancePartial, blockedNoPrimary,/)
  })
  it('跳弹续飞 1–99% 时最终段装甲板按概率链累计 chance 着色（可能击穿）', () => {
    // 概率链累计是领域计算，仍在内核执行后交给 renderer 着色；游标着色行为断言
    // 在 shotResultCard.test.ts。
    expect(kernel).toContain('const partialChainLayers = !probabilityMode && chancePartial')
    expect(kernel).toMatch(/partialChainLayers = !probabilityMode && chancePartial\s*\n\s*\? evaluateProbabilityChain\(chancePen, probLayers\)\.layers/)
  })
})

// 射击复现首帧取景回归（2026-10-26）：命中弹默认进入「查看弹着点」视角时，相机瞄准点
// 来自对目标装甲模型的 raycast。updateTurretGun 刚写入炮塔/炮管装甲板的局部矩阵，世界
// 矩阵要到下一帧 render 才传播——同一任务内的首帧 raycast 若不做传播会按旧姿态求交：
// 弦擦过炮管落空 → 瞄准点回退车体原点，坦克整体出现在画面上半部；下一帧后再点一次
// 「查看弹着点」才恢复。这里锁定：姿态写入函数返回前必须传播世界矩阵（与
// doPenetrationCheck 的首帧约定同源，勿只在单个调用点补）。
