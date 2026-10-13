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
      'const list = await fetchTankFilter();',
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
  it('animate 按 worldOverviewMode 门控（命中/脱靶 world 同置）；关闭态以 k=1 幂等还原原生', () => {
    expect(kernel).toMatch(/applyLongRangeCompensation\(!worldOverviewMode\)/)
    expect(kernel).not.toMatch(/applyLongRangeCompensation\(!window\.__worldPenMode\)/)   // 旧门控仅命中置位，MISS 漏置
    expect(kernel).toMatch(/const k = enabled \? Math\.max\(1, d \/ DOLLY_REF_DIST\) : 1;/)
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
    const fovOn = dollyZoomFov(249.3, true)
    expect(fovOn).toBeCloseTo(6.4238, 2)                    // reviewer 实测值（k=8.31）
    // 垂直 NDC-y = tan(偏心角)/tan(fov/2)：同一 8.41° 偏心锚点，原生在视锥内、误套补偿越界
    const ndcY = (offDeg, fovDeg) => Math.tan(offDeg * Math.PI / 180) / Math.tan(fovDeg * Math.PI / 360)
    expect(ndcY(8.41, 50)).toBeLessThan(1)                  // ≈0.317（reviewer 实测）
    expect(ndcY(8.41, fovOn)).toBeGreaterThan(2)            // ≈2.63（越界）
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

// 间隙板首层跳弹上屏（用户 2026-10-13 报告）：SPACED_FRAG 写 G=跳弹标志，PBR_FRAG 据此把间隙板
// 跳弹渲染为跳弹色（紫）并跑续飞；二层（underSpaced 的主装甲）不再转正——与点击链 layerIndex>0 同规则。
describe('gap-armor first-layer ricochet surfacing (heatmap)', () => {
  const kernel = read('../scene/tankViewer.js')
  const pen = read('../scene/penetration.js')
  it('两通道分离：状态在 RT1（NoBlending+depthWrite 独占最近板），厚度通道只写 R（review 2026-10-13 重叠板）', () => {
    const thickness = kernel.slice(kernel.indexOf('const SPACED_FRAG'), kernel.indexOf('const SPACED_STATE_FRAG'))
    const state = kernel.slice(kernel.indexOf('const SPACED_STATE_FRAG'), kernel.indexOf('function spacedCommonUniforms'))
    // 厚度通道：按状态通道深度辨首层；只写 R（G/B 归零，不再累加）
    expect(thickness).toMatch(/uniform highp sampler2D spacedStateDepth;/)
    // 首层判定 = 线性米制视深比较（固定窗口深度差在远距会把 0.2m 相隔板误判为首层，
    // review 2026-10-13）——容差 0.05m 全视距一致
    expect(thickness).toMatch(/float linState = \(2\.0 \* camNear \* camFar\)/)
    expect(thickness).toMatch(/bool isFirstSpaced = hasState && abs\(viewDepth - linState\) < 0\.05;/)
    expect(thickness).toMatch(/float norm = isFirstSpaced/)
    expect(thickness).toMatch(/ricocheted \? 1\.0 : eff \/ penetration, 0\.0, 0\.0, 1\.0\)/)
    // 状态通道：就地续飞（自身几何）+ 最近板独占 + R=跳弹标志 / G=续飞编码
    expect(state).toMatch(/rcContinue\(wPosR, reflR, penetration \* RC_RICO_MUL/)
    expect(state).toMatch(/highp vec3 nVR = normalize\(vNormal\);/)
    expect(state).toMatch(/gl_FragColor = vec4\(ricocheted \? 1\.0 : 0\.0, bCode, 0\.0, 1\.0\);/)
    expect(kernel).toMatch(/function spacedStateMaterial[\s\S]{0,420}?depthWrite: true, depthTest: true, blending: THREE\.NoBlending,/)
    // 屏幕侧只解读状态缓冲，不重算
    expect(kernel).toMatch(/bool gapRicochet = underSpaced && spacedState\.r > 0\.5;/)
    const gapStart = kernel.indexOf('if (gapRicochet) {')
    expect(gapStart).toBeGreaterThan(-1)
    const gapSeg = kernel.slice(gapStart, gapStart + 900)
    expect(gapSeg).toMatch(/float code = spacedState\.g;/)
    expect(gapSeg).not.toContain('rcContinue')
    // 主装甲侧（二层）norm 归零（保留）
    expect(kernel).toMatch(/float norm = underSpaced \? 0\.0/)
  })
  it('渲染顺序：状态通道先于厚度通道；注入 spacedStateDepth / spacedStateBuffer', () => {
    const pass = kernel.slice(kernel.indexOf('function renderSpacedArmorPass'),
      kernel.indexOf("document.getElementById('penetration-btn')"))
    const iState = pass.indexOf('renderer.render(spacedStateScene, camera)')
    const iThick = pass.indexOf('renderer.render(spacedArmorScene, camera)')
    expect(iState).toBeGreaterThan(-1)
    expect(iThick).toBeGreaterThan(iState)
    expect(pass).toContain('spacedStateDepth.value = srt.depthTexture')
    expect(pass).toContain('spacedStateBuffer.value = srt.texture')
    expect(pass).toContain('camNearUniform.value = camera.near')   // 线性化基准每帧同步
  })
  it('状态场景：模块深度先于间隙板写入（更近模块不留过期状态，review 2026-10-13）', () => {
    expect(kernel).toMatch(/addClone\(spacedStateScene, node, omitMaterial, 1\)/)
  })
  it('强化装甲厚度刷新覆盖状态场景（两通道三倍口径阈值一致，review 2026-10-13）', () => {
    expect(kernel).toMatch(/apply\(spacedArmorScene\); apply\(spacedStateScene\); apply\(primaryArmorScene\);/)
  })
  it('首层容差全视距一致（固定窗口深度差的反例 + 线性米制还原，review 2026-10-13）', () => {
    // 相机 near=.1 / far=1000：30m 与 30.2m 两板的窗口深度差 2.2e-5 < 旧固定容差 1e-4
    // → 旧实现两块都判首层；线性米制差 0.2m > 0.05m 容差 → 正确区分。远距（dolly-zoom
    // 缩放近面后）同样成立。
    const winDepth = (viewZ, near, far) =>
      ((far + near - (2 * near * far) / viewZ) / (far - near) + 1) / 2
    const linViewZ = (w, near, far) =>
      (2 * near * far) / (far + near - (2 * w - 1) * (far - near))
    const near0 = 0.1, far0 = 1000
    const w1 = winDepth(30, near0, far0), w2 = winDepth(30.2, near0, far0)
    expect(Math.abs(w1 - w2)).toBeLessThan(1e-4)                       // 旧窗口容差失效（判别）
    expect(Math.abs(linViewZ(w1, near0, far0) - linViewZ(w2, near0, far0))).toBeCloseTo(0.2, 2)
    expect(Math.abs(linear32(w2, near0, far0) - 30.2)).toBeLessThan(0.01)
    // 400m 处相隔 0.2m（dolly-zoom 使 near≈1.33 / far=1200）
    const w3 = winDepth(400, 1.33, 1200), w4 = winDepth(400.2, 1.33, 1200)
    expect(Math.abs(linViewZ(w3, 1.33, 1200) - linViewZ(w4, 1.33, 1200))).toBeCloseTo(0.2, 2)
    function linear32(w, near, far) { return linViewZ(w, near, far) }
  })
  it('rcContinue 双实现：转正仅首层（hitIdx == 0 / hitIdx === 0）', () => {
    const packSrc = read('../scene/armorCollisionPack.js')
    expect(packSrc).toMatch(/highp float normR = \(hitIdx == 0\)/)
    expect(packSrc).toMatch(/const normR = hitIdx === 0/)
  })
  it('点击链：转正只作用于首个装甲层（layerIndex>0 → 0）', () => {
    expect(pen).toMatch(/const effNormalization = layerIndex > 0 \? 0\.0 : normalization/)
  })
})
