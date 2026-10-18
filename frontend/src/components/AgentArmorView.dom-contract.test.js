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

// 间隙板首层跳弹上屏（用户 2026-10-13 报告）：SPACED_FRAG 写 G=间隙甲层标记，PBR_FRAG 据此
// 区分「间隙甲已消耗首层」与「只穿外部模块」；主装甲在后者仍保留首层转正（用户 2026-10-17）。
describe('gap-armor first-layer ricochet surfacing (heatmap)', () => {
  const kernel = read('../scene/tankViewer.js')
  const pen = read('../scene/penetration.js')
  it('无阈值首层：厚度通道零身份推断（全板裸 LOS），状态通道独占最近层并携带转正差额（review 2026-10-13 blocker）', () => {
    const thickness = kernel.slice(kernel.indexOf('const SPACED_FRAG'), kernel.indexOf('const SPACED_STATE_FRAG'))
    const state = kernel.slice(kernel.indexOf('const SPACED_STATE_FRAG'), kernel.indexOf('function spacedCommonUniforms'))
    // 厚度通道：只写裸 LOS + 间隙甲层标记 G（外部模块只写 R/coverage，G 恒 0）；
    // 不得含任何首层身份/容差推断（任何"距最近层 < δ"都会被合法小层距击穿）
    expect(thickness).toMatch(/float losThick = thickness \/ max\(cos\(angle\), 1e-6\);/)
    expect(thickness).toMatch(/gl_FragColor = vec4\(losThick \/ penetration, 1\.0, 0\.0, 1\.0\);/)
    expect(thickness).not.toMatch(/isFirstSpaced|linState|stateD|camNear|camFar|0\.05/)
    // 状态通道：精确最近层独占（NoBlending+depthWrite）+ R=跳弹标志 / G=续飞编码 / B=转正差额
    expect(state).toMatch(/rcContinue\(wPosR, reflR, penetration \* RC_RICO_MUL/)
    expect(state).toMatch(/float delta = max\(0\.0, losThick - normThick\) \/ max\(penetration, 1\.0\);/)
    expect(state).not.toMatch(/delta = clamp\(/)   // 差额不上钳：>1 须精确参与 r−b 恒等（review 2026-10-13 P2）
    expect(state).toMatch(/gl_FragColor = vec4\(ricocheted \? 1\.0 : 0\.0, bCode, delta, 0\.0\);/)
    expect(kernel).toMatch(/function spacedStateMaterial[\s\S]{0,420}?depthWrite: true, depthTest: true, blending: THREE\.NoBlending,/)
    // 外部模块状态：只写 A=1，RGB 保留（模块在前的间隙甲转正差额不被覆盖）；自定义混合
    // RGB src=0/dst=1、A src=1/dst=0——单一来源，PBR 用 A 抑制其后间隙板跳弹。
    expect(kernel).toMatch(/function moduleStateMaterial\(clip\)/)
    expect(kernel).toMatch(/blendSrc: THREE\.ZeroFactor, blendDst: THREE\.OneFactor/)
    expect(kernel).toMatch(/blendSrcAlpha: THREE\.OneFactor, blendDstAlpha: THREE\.ZeroFactor/)
    const stateScene = kernel.slice(kernel.indexOf('function buildSpacedStateScene'), kernel.indexOf('function buildPrimaryArmorScene'))
    expect(stateScene).toMatch(/primaryMeshes\.forEach/)
    expect(stateScene).toMatch(/addClone\(spacedStateScene, node, moduleStateMaterial\(/)
    // PBR：差额修正总消费（8 位回退格式下 R 饱和时禁止在其上退差额）；跳弹分支只解读状态
    expect(kernel).toMatch(/highp float totalConsume = \(spacedSatGuard > 0\.5 && rawTotal >= 1\.0\)/)
    expect(kernel).toMatch(/float spacedThick = totalConsume \* penetration;/)
    expect(kernel).toMatch(/bool moduleInFront = spacedState\.a > 0\.5;/)
    expect(kernel).toMatch(/bool gapRicochet = underSpaced && spacedState\.r > 0\.5 && !moduleInFront;/)
    // 外部模块不是装甲层：G 未置位时主装甲仍是首层 → 保留转正/2×口径增强转正；
    // 3× overmatch 只表示真实口径规则，跳弹抑制另外由 underSpaced 承担。
    expect(kernel).toMatch(/bool hasSpacedArmor = spacedData\.g > 0\.0;/)
    expect(kernel).toMatch(/bool threeCal = caliber > thickness \* 3\.0;/)
    expect(kernel).not.toMatch(/bool threeCal = caliber > thickness \* 3\.0 \|\| underSpaced;/)
    expect(kernel).toMatch(/bool noRicochet = threeCal \|\| underSpaced;/)
    expect(kernel).toMatch(/float norm = hasSpacedArmor \? 0\.0/)
    const gapStart = kernel.indexOf('if (gapRicochet) {')
    expect(gapStart).toBeGreaterThan(-1)
    const gapSeg = kernel.slice(gapStart, gapStart + 900)
    expect(gapSeg).toMatch(/float code = spacedState\.g;/)
    expect(gapSeg).not.toContain('rcContinue')
  })
  it('管线消费模型 = Σ裸LOS − 最近层差额（含 0.02m 合法小层距反例；review 2026-10-13 blocker）', () => {
    // 两块 20mm@60°（相隔 0.02m——任何深度邻近阈值都会被它击穿）+ 100mm 主装甲@0°，AP 100/164/5°。
    // 测试侧镜像管线代数：RT0 = Σ裸LOS；RT1.B = 最近层(裸−转正)/pen；PBR 做差 →
    // 总消费 = 转正首层 + 其余裸 LOS，与 CPU 同判（27.1268 + 40 + 100 → BLOCKED）。
    const raw = 20 / Math.cos(60 * Math.PI / 180)
    const twoCalNorm = (1.4 * 5 * 100) / (2 * 20)
    const normFirst = 20 / Math.cos(Math.max(0, 60 - twoCalNorm) * Math.PI / 180)
    expect(Math.abs(normFirst - 27.1268)).toBeLessThan(0.02)
    const pipeline = (raw + raw) - (raw - normFirst)
    expect(Math.abs(pipeline - (normFirst + raw))).toBeLessThan(1e-9)
    expect(pipeline + 100).toBeGreaterThan(164)   // → BLOCKED（与 CPU/点击链同判）
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
  })
  it('饱和回归：Σ裸LOS/pen>1 按实际 RT 格式逐次混合——半浮点不翻、8 位翻转（review 2026-10-13 P2）', () => {
    // 评论场景：两块 40mm 间隙甲均 @69°（相隔 0.2m）+ 25mm 主装甲 @0°，AP 100/210/5°。
    // CPU：首层 twoCal 转正 8.75° → 80.609975；次层裸 LOS 111.617124；210−80.609975−111.617124
    // = 17.772901 < 25 → BLOCKED。Σ裸LOS/pen = 223.234249/210 = 1.063020 > 1。
    const pen = 210
    const raw = 40 / Math.cos(69 * Math.PI / 180)                    // 111.617124
    const twoCalNormDeg = (1.4 * 5 * 100) / (2 * 40)                 // 8.75°（与源码 twoCal 同式）
    const normFirst = 40 / Math.cos((69 - twoCalNormDeg) * Math.PI / 180)
    expect(Math.abs(raw - 111.617124)).toBeLessThan(1e-3)
    expect(Math.abs(normFirst - 80.609975)).toBeLessThan(1e-3)
    const rawSumRatio = (raw + raw) / pen
    expect(rawSumRatio).toBeGreaterThan(1)                           // 覆盖 Σ裸LOS/pen > 1
    expect(normFirst + raw + 25).toBeGreaterThan(pen)                // 与点击链同判 BLOCKED
    const delta = (raw - normFirst) / pen
    // 逐次混合模拟：src 写入时量化到 RT 格式，dst = 量化(dst + src)（固定功能逐片元混合语义）。
    const q8 = (x) => Math.round(Math.min(1, Math.max(0, x)) * 255) / 255
    const q16 = (x) => { const s = Math.pow(2, Math.floor(Math.log2(Math.abs(x))) - 10); return Math.round(x / s) * s }
    const accumulate = (q) => { let acc = 0; for (let i = 0; i < 2; i++) acc = q(acc + q(raw / pen)); return acc }
    const acc8 = accumulate(q8)
    expect(acc8).toBe(1.0)                                           // 8 位：累计先钳到 1，超额丢失
    const rem8 = pen - Math.max(0, acc8 - q8(delta)) * pen
    expect(Math.abs(rem8 - 31.294118)).toBeLessThan(0.05)            // 在饱和 R 上退差额 → 翻成击穿（评论数值）
    expect(rem8).toBeGreaterThan(25)
    const remFallback = pen - 1.0 * pen                              // 回退守卫：饱和 R 不退差额（按整穿深计）
    expect(remFallback).toBeLessThan(25)                             // 保守侧：绝不把饱和翻成击穿
    const acc16 = accumulate(q16)
    expect(Math.abs(acc16 - rawSumRatio)).toBeLessThan(0.002)        // 半浮点（实际格式）：保留 >1 总量
    const rem16 = pen - Math.max(0, acc16 - q16(delta)) * pen
    expect(Math.abs(rem16 - 17.772901)).toBeLessThan(0.15)           // 与 CPU 17.772901 同判（fp16 逐次舍入 ≪0.1mm）
    expect(rem16).toBeLessThan(25)
  })
  it('rcContinue 双实现：转正仅首个实际装甲层（armorIdx == 0 / armorIdx === 0）', () => {
    const packSrc = read('../scene/armorCollisionPack.js')
    // 外部模块是 flat 消耗，不计入 armorIdx（用户 2026-10-17）；旧 hitIdx 口径已删除。
    expect(packSrc).toMatch(/int armorIdx = 0;/)
    expect(packSrc).not.toMatch(/hitIdx/)
    expect(packSrc).toMatch(/highp float normR = \(armorIdx == 0\)/)
    expect(packSrc).toMatch(/const normR = armorIdx === 0/)
  })
  it('点击链：转正只作用于首个实际装甲层（armorLayerCount === 0）', () => {
    expect(pen).toMatch(/const effNormalization = armorLayerCount === 0 \? normalization : 0\.0/)
    expect(pen).toMatch(/const noRicochet = threeCalibersRule \|\| layerIndex > 0 \|\| !allowRicochet/)
    // overmatch 字段只报真实 3× 口径，不再用 layerIndex/allow_ricochet 冒充
    expect(pen).toMatch(/const threeCalibersRule = caliber > thickness \* 3\.0\r?\n/)
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
