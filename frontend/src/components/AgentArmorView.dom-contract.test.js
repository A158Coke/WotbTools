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

describe('AgentArmorView ↔ tankViewer DOM 契约', () => {
  const template = read('./AgentArmorView.vue')
  const kernel = read('../scene/tankViewer.js')

  it('内核 getElementById 的静态 ID 全部由模板提供', () => {
    const kernelLookups = new Set([...kernel.matchAll(/getElementById\('([^']+)'\)/g)].map((m) => m[1]))
    expect(kernelLookups.size).toBeGreaterThan(30)   // 防契约测试自身空跑
    const kernelCreated = new Set([
      ...[...kernel.matchAll(/\.id\s*=\s*'([^']+)'/g)].map((m) => m[1]),
      ...[...kernel.matchAll(/id="([^"]+)"/g)].map((m) => m[1]),
    ])
    const templateIds = new Set([...template.matchAll(/id="([^"]+)"/g)].map((m) => m[1]))
    const missing = [...kernelLookups]
      .filter((id) => !templateIds.has(id) && !kernelCreated.has(id))
      .sort()
    expect(
      missing,
      '内核按 ID 查找的节点在模板里不存在——该路径会静默失效（控件点了没反应）',
    ).toEqual([])
  })
})


// 生命周期所有权守卫：登录门卸载场景后，迟到 continuation 不得再启动资产或访问移除的 DOM。
// WebGL 画面由人工验收；此处只锁定 async 边界的销毁接线。
describe('armor destroyed scene async ownership', () => {
  const kernel = read('../scene/tankViewer.js')
  it('guards every bootstrap continuation before the next asset or DOM step', () => {
    for (const step of [
      'const list = normalizeTankCache(await fetchTankEncyclopedia());',
      'const data = await fetchTankData(tid);',
      'const data = await fetchShells(tid);',
      'await populateTankLists(initTargetId, initShooterId);',
      'await loadShooter(initShooterId);',
      'await loadTarget(initTargetId);',
    ]) {
      const start = kernel.indexOf(step)
      expect(start, step).toBeGreaterThan(-1)
      expect(kernel.slice(start + step.length).trimStart().startsWith('if (destroyed) return;'), step).toBe(true)
    }
  })
})

// The host now reuses this component for adjacent shots: old async work must never own its new DOM.
describe('armor adjacent-shot teardown ownership', () => {
  const kernel = read('../scene/tankViewer.js')
  it('guards shot handoff, shooter models and delayed callbacks after scene disposal', () => {
    expect(kernel).toMatch(/const shotGen = loadGen;\s*const currentShot = \(\) => !destroyed && shotGen === loadGen;/)
    expect(kernel).toMatch(/fetchReplayShots\(\)\.then\(d => \{\s*if \(!currentShot\(\)\) return;/)
    expect(kernel).toMatch(/const sd = arr\[0\], gltf = arr\[1\];\s*if \(!currentShot\(\)\) \{ disposeDetachedModel\(gltf\?\.scene\); return null;/)
    expect(kernel).toContain('if (!destroyed) callback();')
    expect(kernel).toContain('pendingTimers.forEach(globalThis.clearTimeout)')
    expect(kernel).toMatch(/function showShotError\(msg\) \{\s*if \(destroyed\) return;/)
  })
})

// dolly-zoom 作用域守卫（review P2）：两车 world 总览按射手/目标取景，不适用单车 dolly-zoom。
// 修前每帧无条件应用：reviewer 实测 400m 直线回放相机 (-200,88,120) 对两车中点（距 249.3m），
// FOV 50°→6.4238°，受击锚点 NDC-y 0.317→2.633（出视锥）。
describe('dolly-zoom world-overview scope guard', () => {
  const kernel = read('../scene/tankViewer.js')
  it('animate 按 worldOverviewMode 门控（命中/脱靶 world 同置）；关闭态还原原生 50°', () => {
    expect(kernel).toMatch(/applyLongRangeCompensation\(!worldOverviewMode\)/)
    expect(kernel).not.toMatch(/applyLongRangeCompensation\(!window\.__worldPenMode\)/)   // 旧门控仅命中置位，MISS 漏置
    expect(kernel).toMatch(/if \(!enabled\) \{[\s\S]*?fov = OVERVIEW_BASE_FOV;[\s\S]*?near = 0\.1;[\s\S]*?far = Math\.max\(1000, d \* 3\);/)
  })
  it('单车装甲检视与 shot replay 共用 Armor Inspector 实测标定', () => {
    expect(kernel).toMatch(/const ARMOR_REF_DIST = 15;/)
    expect(kernel).toMatch(/const ARMOR_BASE_FOV = 18\.75;/)
    expect(kernel).toMatch(/const ARMOR_MAX_FOV = 40;/)
    expect(kernel).toMatch(/const ARMOR_MIN_FOV = 0\.5;/)
    expect(kernel).toMatch(/const ARMOR_FAR_PRODUCT_GAIN = 0\.0128;/)
    expect(kernel).toMatch(/const ARMOR_FAR_PRODUCT_MAX = 2\.8;/)
    expect(kernel).toMatch(/camera\.position\.set\(0, 0, -ARMOR_REF_DIST\);/)
    expect(kernel).toMatch(/controls\.minDistance = 3;/)
    expect(kernel).toMatch(/controls\.maxDistance = 500;/)
    expect(kernel).toMatch(/fov = dollyZoomFov\(d, true, ARMOR_BASE_FOV, ARMOR_REF_DIST, ARMOR_MIN_FOV, ARMOR_MAX_FOV, ARMOR_FAR_PRODUCT_GAIN, ARMOR_FAR_PRODUCT_MAX\);/)
    expect(kernel).toMatch(/near = 0\.05 \* d;/)
    expect(kernel).toMatch(/far = d \+ 30;/)
    expect(kernel).toMatch(/controls\.target\.set\(aimCenter\.x, aimCenter\.y, aimCenter\.z\);/)
    expect(kernel).toMatch(/camera\.position\.set\(aimCenter\.x, aimCenter\.y, aimCenter\.z - ARMOR_REF_DIST\);/)
    expect(kernel).toMatch(/controls\.target\.set\(0, P\.ty, 0\);/)
    expect(kernel).toMatch(/const camView = QP\.get\('camview'\) \|\| \(CAMERA_VIEW_PRESETS\.has\(view\) \? view : null\);/)
  })
  it('场景风格跟随网页 UI：透明画布、无地面网格、半球光主题表面色', () => {
    const view = read('./AgentArmorView.vue')
    expect(kernel).not.toContain('GridHelper')
    expect(kernel).toContain('scene.background = null;')
    expect(kernel).toContain('antialias: true, alpha: true')
    expect(kernel).toContain("readThemeColor('--color-surface-2'")
    expect(view).toContain('background: var(--color-canvas);')
  })
  it('worldOverviewMode 命中/脱靶分支同置、每发重置（MISS 早返回回归）', () => {
    // 脱靶分支入口置位（结构锚点：isMiss 分支首行）——此前 MISS 在弹道标注后提前返回，漏置
    const missStart = kernel.indexOf('const isMiss = !s.target_name;')
    expect(missStart).toBeGreaterThan(-1)
    expect(kernel.slice(missStart, missStart + 400)).toContain('worldOverviewMode = true;')
    // 命中 world 路径同置（紧随穿透判定标志）
    expect(kernel).toMatch(/window\.__worldPenMode = true;\s*worldOverviewMode = true;/)
    // 每发进入射击复现重置
    expect(kernel).toMatch(/window\.__worldPenMode = false;\s*worldOverviewMode = false;/)
  })
  it('mirrorShotData 导出且镜像 via：折线长度在镜像前后不变（点击/热力图共用长度源）', async () => {
    const { mirrorShotData } = await import('../scene/tankViewer.js')
    const { shotBallisticLength } = await import('../scene/agentData.js')
    const shot = {
      ball_a: [12, 1.5, 4], ball_b: [-90, 0.4, 30],
      via: [[180, 22, -6], [-3.5, 8, 12]],
    }
    const before = shotBallisticLength(shot)
    expect(before).toBeGreaterThan(0)
    mirrorShotData(shot)
    expect(shot.via[0][0]).toBeCloseTo(-180, 9)   // via 确实随镜像（review：曾只镜像端点）
    expect(shot.via[1][0]).toBeCloseTo(3.5, 9)
    expect(shotBallisticLength(shot)).toBeCloseTo(before, 9)
  })
  it('dollyZoomFov 纯函数与视锥锚点回归', async () => {
    const { dollyZoomFov } = await import('../scene/tankViewer.js')
    expect(dollyZoomFov(30, true)).toBeCloseTo(50, 6)       // 基准距离 = 原生视角
    expect(dollyZoomFov(249.3, false)).toBeCloseTo(50, 6)   // world 总览恒原生
    // 默认参数（base 50/ref30）：d<30 也走 dolly-zoom（shot 旧 0-30m 原生分支已移除）。
    expect(dollyZoomFov(15, true)).toBeGreaterThan(50)
    // 单车装甲检视 / shot replay：15m/18.75° 基准，d<15 变宽；6.5m 处 40° 封顶；
    // product 从 15m 的 ≈2.477 随距离 +0.0128/m 增大（28.35m≈2.648），远距车体略小；
    // product 封顶 2.8（500m 仍 2.8，比 15m 小约 12%），不再让车体尺寸完全恒定。
    const armorFov = (d) => dollyZoomFov(d, true, 18.75, 15, 0.5, 40, 0.0128, 2.8)
    expect(armorFov(15)).toBeCloseTo(18.75, 6)
    expect(armorFov(6.5)).toBeCloseTo(40, 6)
    const armorProduct = (d) => Math.min(2.8, Math.tan(18.75 * Math.PI / 360) * 15 + Math.max(0, d - 15) * 0.0128)
    const armorFov30 = 2 * Math.atan(armorProduct(30) / 30) * 180 / Math.PI
    expect(armorFov(30)).toBeCloseTo(armorFov30, 6)
    expect(armorFov(30)).toBeLessThan(11)
    expect(armorFov(28.35)).toBeCloseTo(10.67, 1)       // Armor Inspector 实测点
    expect(armorFov(28.35)).toBeLessThan(armorFov(15))  // 远距车体略小
    expect(armorFov(8.94)).toBeGreaterThan(18.75)
    expect(armorFov(8.94)).toBeLessThan(40)
    const armorFov500 = 2 * Math.atan(2.8 / 500) * 180 / Math.PI
    expect(armorFov(500)).toBeCloseTo(armorFov500, 6)
    expect(armorFov(500)).toBeGreaterThan(0.5)
    expect(armorFov(500)).toBeLessThan(0.7)
    expect(armorFov(500)).toBeLessThan(armorFov(15))
    expect(dollyZoomFov(15, false)).toBeCloseTo(50, 6)
    const fovOn = dollyZoomFov(249.3, true)
    expect(fovOn).toBeCloseTo(6.4238, 2)                    // reviewer 实测值（k=8.31）
    // 垂直 NDC-y = tan(偏心角)/tan(fov/2)：同一 8.41° 偏心锚点，原生在视锥内、误套补偿越界
    const ndcY = (offDeg, fovDeg) => Math.tan(offDeg * Math.PI / 180) / Math.tan(fovDeg * Math.PI / 360)
    expect(ndcY(8.41, 50)).toBeLessThan(1)                  // ≈0.317（reviewer 实测）
    expect(ndcY(8.41, fovOn)).toBeGreaterThan(2)            // ≈2.63（越界）
  })
})

// 结果卡片是 position:fixed，left/top 是视口坐标；投影必须基于画布实际矩形。
// 若用 window.innerWidth/Height，页面/容器滚动或窗口缩放时画布移动而卡片停在旧视口位置。
describe('traj-info canvas anchoring', () => {
  const kernel = read('../scene/tankViewer.js')
  it('按画布 getBoundingClientRect 投影，而不是视口尺寸', () => {
    const start = kernel.indexOf('function updateTrajInfoPos()')
    expect(start).toBeGreaterThan(-1)
    const end = kernel.indexOf('div.style.transform', start)
    expect(end).toBeGreaterThan(start)
    const fn = kernel.slice(start, end)
    expect(fn).toMatch(/getElementById\('canvas-container'\)/)
    expect(fn).toMatch(/getBoundingClientRect\(\)/)
    expect(fn).toMatch(/const x = rect\.left \+ \(v\.x \* 0\.5 \+ 0\.5\) \* rect\.width;/)
    expect(fn).toMatch(/const y = rect\.top \+ \(-v\.y \* 0\.5 \+ 0\.5\) \* rect\.height;/)
    expect(fn).not.toMatch(/\(v\.x \* 0\.5 \+ 0\.5\) \* window\.innerWidth/)
    expect(fn).not.toMatch(/\(-v\.y \* 0\.5 \+ 0\.5\) \* window\.innerHeight/)
  })
})

// 交战距离结果行本地化（review P3）：标签/单位走 labels（三语），不用硬编码中文。
describe('engagement-distance result line localization', () => {
  const kernel = read('../scene/tankViewer.js')
  const view = read('./AgentArmorView.vue')
  it('结果卡距离行插值 L.shotDistance / L.distanceUnit', () => {
    expect(kernel).toMatch(/\$\{escapeText\(L\.shotDistance\)\}: \$\{fmtNum\(distVal\)\} \$\{escapeText\(L\.distanceUnit\)\}/)
    expect(kernel).not.toMatch(/交战距离: \$\{fmtNum/)
  })
  it('labels 装配与三语键在位（en/ru 结果卡不再出中文）', () => {
    expect(view).toContain("shotDistance: t('armor.distance')")
    expect(view).toContain("distanceUnit: t('armor.distance_unit')")
    const locales = JSON.parse(read('../locales/feature-messages.json'))
    expect(locales.en.armor.distance).toBe('Engagement distance')
    expect(locales.ru.armor.distance).toBe('Дистанция боя')
    expect(locales.en.armor.distance_unit).toBe('m')
    expect(locales.ru.armor.distance_unit).toBe('м')
  })
})

// 间隙板首层跳弹上屏：SPACED_FRAG 写 G=间隙甲层标记；主装甲独立套用自身 normalization/2×
// （BlitzKit 逐层规则）。PBR 直接累加逐层 normalized R，状态通道只负责最近层跳弹/续飞。
describe('gap-armor first-layer ricochet surfacing (heatmap)', () => {
  const kernel = read('../scene/tankViewer.js')
  const pen = read('../scene/penetration.js')
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
    // B 不再承载转正差额（R 已逐层归一化），保持 0。
    expect(state).toMatch(/rcContinue\(wPosR, reflR, penetration \* RC_RICO_MUL/)
    expect(state).not.toMatch(/losThick|normThick|delta/)
    expect(state).toMatch(/gl_FragColor = vec4\(ricocheted \? 1\.0 : 0\.0, bCode, 0\.0, 0\.0\);/)
    // 名义被挡但概率 1–99%：G 编码概率带而不是硬红 1.0；PBR 就地续飞同理。
    expect(state).toMatch(/float pct = floor\(p \* 100\.0 \+ 0\.5\);/)
    expect(state).toMatch(/bCode = \(pct >= 1\.0 && pct <= 99\.0\) \? 0\.2 \+ 0\.6 \* p : 1\.0;/)
    expect(kernel).toMatch(/if \(pct >= 1\.0 && pct <= 99\.0\) penChance = p;/)
    const packSrc = read('../scene/armorCollisionPack.js')
    expect(packSrc).toMatch(/pct >= 1 && pct <= 99 \? p : 0/)
    expect(kernel).toMatch(/function spacedStateMaterial[\s\S]{0,420}?depthWrite: true, depthTest: true, blending: THREE\.NoBlending,/)
    // 外部模块状态：只写 A=1，RGB 保留；自定义混合 RGB src=0/dst=1、A src=1/dst=0；
    // PBR 用 A 抑制其后间隙板跳弹。
    expect(kernel).toMatch(/function moduleStateMaterial\(clip\)/)
    expect(kernel).toMatch(/blendSrc: THREE\.ZeroFactor, blendDst: THREE\.OneFactor/)
    expect(kernel).toMatch(/blendSrcAlpha: THREE\.OneFactor, blendDstAlpha: THREE\.ZeroFactor/)
    const stateScene = kernel.slice(kernel.indexOf('function buildSpacedStateScene'), kernel.indexOf('function buildPrimaryArmorScene'))
    expect(stateScene).toMatch(/primaryMeshes\.forEach/)
    expect(stateScene).toMatch(/addClone\(spacedStateScene, node, moduleStateMaterial\(/)
    // PBR：RT0.R 已是逐层 normalized effective；直接累加，不再用 RT1.B 做最近层差额。
    expect(kernel).toMatch(/highp float totalConsume = spacedSatBlocked \? 1\.0 : max\(0\.0, rawTotal\);/)
    expect(kernel).not.toMatch(/spacedState\.b/)
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
  it('热力图用 flat vNormal 面法线（不用屏幕空间导数；移动端 mediump 回归）', () => {
    // 装甲几何在 loadModels 中 toNonIndexed + computeVertexNormals ⇒ 每个三角形的
    // vNormal 已是几何面法线，与点击判定 hit.face.normal 同源。3.13.0 的
    // dFdx/dFdy(vViewPos) 在移动端 mediump(fp16) 下逐像素导数量化/退化，导致热力图错乱
    // （2026-10-19 修复）；这里锁定三个热力图 shader 都使用 flat vNormal。
    expect(kernel).toMatch(/toNonIndexed\(\)/)
    expect(kernel).toMatch(/computeVertexNormals\(\)/)
    expect([...kernel.matchAll(/vec3 nFace = normalize\(vNormal\);/g)]).toHaveLength(3)
    expect(kernel).not.toMatch(/dFdx\(vViewPos\)/)
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
    expect(rtFn).toMatch(/renderer\.extensions\.has\('EXT_color_buffer_float'\)/)
    expect(rtFn).toMatch(/renderer\.extensions\.has\('EXT_color_buffer_half_float'\)/)
    // 两个 RT（厚度 + 状态）同格式：半浮点优先，回退 8 位
    expect(rtFn).toMatch(/spacedRTFloatCapable\(\) \? THREE\.HalfFloatType : THREE\.UnsignedByteType/)
    expect((rtFn.match(/type: rtType,/g) || []).length).toBe(2)
    // 回退守卫：PBR uniform 默认 0（浮点语义），注入点按实际格式置 0/1
    expect(kernel).toMatch(/spacedSatGuard: \{ value: 0 \},/)
    expect(kernel).toMatch(/spacedSatGuard\.value = rtIsFloat \? 0 : 1;/)
    expect(kernel).toMatch(/const rtIsFloat = spacedRTFloatCapable\(\);/)
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
    const packSrc = read('../scene/armorCollisionPack.js')
    expect(packSrc).not.toMatch(/armorIdx|hitIdx/)
    expect(packSrc).toMatch(/highp float normR = twoCal/)
    expect(packSrc).toMatch(/const normR = twoCal/)
  })
  it('点击链：每个非外部层独立转正（BlitzKit）', () => {
    // 几何规则已收敛到 resolveLayerGeometry，确定性与概率链共用。
    expect(pen).toMatch(/function resolveLayerGeometry\(ah, thickness, ctx\)/)
    expect(pen).toMatch(/const effNormalization = normalization/)
    expect(pen).not.toMatch(/armorLayerCount/)
    expect(pen).toMatch(/const noRicochet = threeCalibersRule \|\| ctx\.layerIndex > 0 \|\| !ctx\.allowRicochet/)
    // overmatch 字段只报真实 3× 口径，不再用 layerIndex/allow_ricochet 冒充
    expect(pen).toMatch(/const threeCalibersRule = ctx\.caliber > thickness \* 3\.0\r?\n/)
  })
  it('主热力图按确定性 1× 等效厚度消耗（与判定一致，不再用 3× 概率模型）', () => {
    expect(kernel).toMatch(/pMin -= totalConsume \* penetration;/)
    expect(kernel).toMatch(/pMax -= totalConsume \* penetration;/)
    expect(kernel).not.toMatch(/3\.0 \* spacedEff/)
    expect(kernel).toMatch(/highp float sigma = max\(\(pMax - pMin\) \/ 6\.0, 1e-4\);/)
  })
  it('判定/热力图由确定性等效厚度决定；Armor Inspector 概率只做 1–99% 补充显示', () => {
    // 概率 0/100 不得覆盖确定性 PENETRATION/BLOCKED；否则 252AP 打
    // 21.5+207mm 的确定性穿透会被 3× 概率误判成未击穿。
    expect(kernel).not.toMatch(/chanceOutcome/)
    expect(kernel).toMatch(/const title = partial \? L\.mayPenetrate : L\.resultName\(st\);/)
    expect(kernel).toMatch(/const chanceHtml = partial/)
    // 概率链与确定性链同一收集边界：停在首个 Primary（含），不把其后的车体/履带算进去。
    expect(pen).toMatch(/const probabilityHits = collectFilteredHits\(req\.hits\)/)
    expect(pen).not.toMatch(/collectFilteredHits\(req\.hits, false\)/)
    expect(pen).toMatch(/buildProbabilityLayers\(probabilityHits, \{/)
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
describe('tank-picker cover crop wiring (shared TankCatalogMenu)', () => {
  const menu = read('./TankCatalogMenu.vue')

  it('卡片盒是固定 8:5 比例、无固定高度尺寸', () => {
    expect(menu).toMatch(/\.tp-media[^}]*aspect-ratio:\s*8\s*\/\s*5/)
    expect(menu).not.toMatch(/\.tp-media[^}]*block-size:\s*[0-9.]+rem/)
  })
  it('共享菜单以同一比例常数应用内容框变换，并驱动迟到表补样式', () => {
    expect(menu).toMatch(/const ICON_BOX_ASPECT = 8 \/ 5/)
    expect(menu).toMatch(/tankIconCropTransform\(iconCrops\.value\?\.\[String\(id\)\], ICON_BOX_ASPECT\)/)
    expect(menu).toMatch(/loadTankIconCrops\(\)\.then/)
    expect(menu).toMatch(/:style="iconCropStyle\(tank\.id\)"/)
  })
})
