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
// 板分类/配置选择/穿透场景构建的共享实现（装甲查看器与 3D 回放同用）
const plateModel = read('../scene/viewer/armorPlateModel.ts') + '\n' + read('../scene/viewer/armorPenetrationScenes.ts')

describe('AgentArmorView ↔ tankViewer DOM 契约', () => {
  const template = [read('./AgentArmorView.vue'), read('./agent-armor/ArmorToolsPanel.vue'), read('./agent-armor/ArmorSideCard.vue'), read('./agent-armor/useArmorSetupQuery.js'), read('./agent-armor/armorViewerLabels.js'), read('./agent-armor-view.css')].join('\n')
  const kernel = [read('../scene/tankViewer.js'), read('../scene/viewer/turretRig.ts'), read('../scene/viewer/modelLifecycle.ts'), read('../scene/viewer/heatmap.ts'), read('../scene/viewer/judgment.ts'), read('../scene/viewer/trajectoryCard.ts'), read('../scene/viewer/resultCardPosition.ts'), read('../scene/viewer/resultCardAnchor.ts'), read('../scene/viewer/diagnosticProbe.ts'), read('../scene/viewer/shotReplay.ts'), read('../scene/viewer/shotReplayMiss.ts'), read('../scene/viewer/debugUi.ts'), read('../scene/viewer/equipmentState.ts'), read('../scene/viewer/collisionView.ts'), read('../scene/viewer/viewerMath.ts'), read('../scene/viewer/dataLoader.ts'), read('../scene/viewer/aimInput.ts')].join('\n')

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

  // 2026-11-15 用户裁示：判定模式出现两张结果窗口（五行点选卡 + 逐层结果卡）属于重复；
  // 只保留更详细的逐层结果卡 #traj-info，手机端按比例缩放；定位自 2026-11-16 起跟随
  // 世界命中点的屏幕投影（旋转视角同步移动，见 resultCardAnchor/trajectoryCard 行为测试）。
  // 五行点选卡 #click-info 只在厚度模式保留（该模式不做击穿判定，没有第二张卡）。
  it('判定模式单结果窗口：逐层卡跟随点击并缩放，五行卡只在厚度模式', () => {
    // 厚度模式的五行读数仍在（模板 + 唯一写入入口）
    for (const id of ['click-part', 'click-armor', 'click-angle', 'click-effective', 'click-pen', 'click-result']) {
      expect(template, `模板缺 ${id}`).toContain(`id="${id}"`)
      expect(kernel, `内核未写入 ${id}`).toContain(`'${id}'`)
    }
    expect(kernel).toMatch(/function writeClickInfo\(fields: \{/)
    expect(kernel).toMatch(/function placeClickInfo\(clientX: number, clientY: number\): void \{/)
    // 判定路径不再写五行卡：writeClickInfo 只剩厚度模式一个调用点
    expect(kernel.match(/writeClickInfo\(\{/g)?.length, 'writeClickInfo 调用点').toBe(1)
    expect(kernel).not.toMatch(/clickInfoResultCode/)
    expect(kernel).toMatch(/if \(getCollisionMode\(\)\) \{ showArmorPartInfo\(event, ndcX, ndcY\); return; \}/)
    // 判定结果卡：锚点 = 世界命中点（showTrajectory 内设置并逐帧投影），点击屏幕坐标不再参与
    expect(kernel).not.toMatch(/clickAnchor/)
    expect(kernel).toMatch(/trajAnchorWorld = firstPoint\.clone\(\)/)
    expect(kernel).toMatch(/export function projectCardAnchor\(/)
    // 定位实现唯一：共享纯函数 + 脚本写 left/top；无世界锚点时清掉内联定位交还 CSS 回退
    expect(kernel).toMatch(/export function chooseResultCardPosition\(/)
    expect(kernel).toMatch(/chooseResultCardPosition\(\{/)
    expect(kernel).toMatch(/div\.style\.left = /)
    expect(kernel).toMatch(/div\.style\.top = /)
    expect(kernel).toMatch(/div\.style\.insetInlineStart = ''/)
    expect(kernel).toMatch(/div\.style\.transform = ''/)
    // 跟随定位把世界命中点投影到画布容器坐标，并避让固定 HUD 面板（含单发分析页视角切换）
    expect(kernel).toMatch(/projectCardAnchor\(trajAnchorWorld, getCamera\(\), rect\.width, rect\.height\)/)
    expect(kernel).toMatch(/for \(const selector of \['#corner-tl', '#corner-tr', '#turret-controls', '\.armor-back', '\.armor-shot-view-switch'\]\)/)
    // 停靠规则保留为无点击回退（射击复现/初始判定）；#click-info 仍由脚本定位
    const dockCss = template.slice(template.indexOf('.armor-view #traj-info {'))
    const dockRule = dockCss.slice(0, dockCss.indexOf('}'))
    expect(dockRule).toContain('position: absolute')
    expect(dockRule).toContain('inset-inline-start: 50%')
    expect(template).not.toMatch(/\.armor-view :is\(#click-info, #traj-info\)/)
    // resize：厚度卡隐藏（旧坐标失效）；判定卡是主结果窗口，标记 dirty 后按新容器重排
    const viewer = read('../scene/tankViewer.js')
    expect(viewer).toContain("const clickInfo = document.getElementById('click-info');")
    expect(viewer).toMatch(/if \(clickInfo\) clickInfo\.style\.display = 'none';/)
    expect(viewer).toMatch(/tc\.markTrajInfoDirty\(\);/)
    expect(viewer).toMatch(/repositionResultCard: \(\) => \{ tc\.markTrajInfoDirty\(\); tc\.updateTrajInfoPos\(\); \}/)
    // 固定 HUD 面板自身变尺寸（参数抽屉展开/模块加载）也要触发结果卡重排
    expect(viewer).toMatch(/new ResizeObserver\(\(\) => tc\.markTrajInfoDirty\(\)\)/)
    expect(viewer).toMatch(/for \(const selector of \['#corner-tl', '#corner-tr', '#turret-controls', '\.armor-back', '\.armor-shot-view-switch'\]\)/)
    // 宿主：装甲查看器默认展开逐层明细（2026-11-16 用户反馈：手机端不能只给极简一行）；
    // 射击复现结果卡空间受限，保持默认收起；展开/收起后按新高度重新避让
    expect(template).toMatch(/const resultExpanded = ref\(!isShotPage\.value\)/)
    expect(template).toMatch(/watch\(isShotPage, shot => \{ resultExpanded\.value = !shot \}\)/)
    expect(template).toMatch(/watch\(resultExpanded, \(\) => nextTick\(\(\) => viewer\?\.repositionResultCard\?\.\(\)\)\)/)
    expect(kernel).toMatch(/shotResultCardMetrics\(compactCard, shotResultCardScale\(/)
    const metrics = read('../utils/shotResultCardMetrics.js')
    expect(metrics).toMatch(/export function shotResultCardScale\(/)
    expect(metrics).toMatch(/Math\.min\(fitted, 360, Math\.round\(width \* 0\.82\)\)/)
    // 桌面卡片不拦截场景点击（已展开全部明细）；小屏收起态才可点开
    expect(template).toMatch(/\.armor-view #traj-info \{[^}]*pointer-events: none;/)
    expect(template).toMatch(/\.armor-view #traj-info \{ pointer-events: auto; cursor: pointer; \}/)
    // 厚度卡自适应缩放与语义色仍由模板样式拥有
    expect(template).toMatch(/\.armor-view #click-info \{[^}]*font-size: clamp\(/)
    expect(template).toMatch(/pointer-events: none/)
    expect(template).toMatch(/> span:last-child:not\(#click-result\)/)
    expect(template).toMatch(/\.armor-view #click-info \.pen \{ color: var\(--green\)/)
    // 浮层不是右上角面板的子节点：DOM 顺序在 #corner-tr 之前，外观由共享面板规则提供
    expect(template.indexOf('id="click-info"')).toBeLessThan(template.indexOf('id="corner-tr"'))
    expect(template).toMatch(/:is\(#info-panel, #tank-selectors, #turret-controls, #debug-info, #click-info\)/)
  })

  // 2026-10-29 用户报障（114 SP2 / 11057）：履带上表面位置不对。源 GLB 履带材质是
  // doubleSided，上表面条带绕序朝内——替换材质固定 FrontSide 会在厚度视图/热力图里把
  // 上表面剔除成空洞。模块替换材质/clone 必须沿用源材质的 side。
  it('模块替换材质沿用客户端材质的双面口径', () => {
    expect(plateModel).toMatch(/function moduleDoubleSided\(node: Mesh\): boolean \{/)
    expect(plateModel).toMatch(/n\.userData\.moduleDoubleSided = moduleDoubleSided\(n\)/)
    expect(kernel).toMatch(/const side = node\.userData\.moduleDoubleSided \? THREE\.DoubleSide : THREE\.FrontSide;/)
    expect(plateModel).toMatch(/const side = node\.userData\.moduleDoubleSided \? THREE\.DoubleSide : THREE\.FrontSide/)
    expect(kernel).toMatch(/mat\.side = side;/)
    expect(plateModel).toMatch(/cmat\.side = side/)
    expect(plateModel).toMatch(/m\.side = side/)
    expect(plateModel).toMatch(/sm\.side = node\.userData\.moduleDoubleSided \? THREE\.DoubleSide : THREE\.FrontSide/)
  })
})


// 生命周期所有权守卫：登录门卸载场景后，迟到 continuation 不得再启动资产或访问移除的 DOM。
// WebGL 画面由人工验收；此处只锁定 async 边界的销毁接线。
describe('armor destroyed scene async ownership', () => {
  const kernel = [read('../scene/tankViewer.js'), read('../scene/viewer/turretRig.ts'), read('../scene/viewer/modelLifecycle.ts'), read('../scene/viewer/heatmap.ts'), read('../scene/viewer/judgment.ts'), read('../scene/viewer/trajectoryCard.ts'), read('../scene/viewer/diagnosticProbe.ts'), read('../scene/viewer/shotReplay.ts'), read('../scene/viewer/shotReplayMiss.ts'), read('../scene/viewer/debugUi.ts'), read('../scene/viewer/equipmentState.ts'), read('../scene/viewer/collisionView.ts'), read('../scene/viewer/viewerMath.ts'), read('../scene/viewer/dataLoader.ts'), read('../scene/viewer/aimInput.ts')].join('\n')
  it('guards every bootstrap continuation before the next asset or DOM step', () => {
    for (const step of [
      'const list = normalizeTankCache(await fetchTankEncyclopedia());',
      "const data = await fetchTankData(tid, getUpgradeOptions('shooter'));",
      "const data = await fetchShells(tid, getUpgradeOptions('shooter'));",
      'await dl.populateTankLists(initTargetId, initShooterId);',
      'await dl.loadShooter(initShooterId);',
      'await dl.loadTarget(initTargetId);',
    ]) {
      const start = kernel.indexOf(step)
      expect(start, step).toBeGreaterThan(-1)
      const guard = kernel.slice(start + step.length).trimStart()
      expect(
        guard.startsWith('if (destroyed) return;') || guard.startsWith('if (destroyed || contextLost) return;') || guard.startsWith('if (isDestroyed()) return;') || guard.startsWith('if (isDestroyed() || isContextLost()) return;'),
        step,
      ).toBe(true)
    }
  })
})

// The host now reuses this component for adjacent shots: old async work must never own its new DOM.
describe('armor adjacent-shot teardown ownership', () => {
  const kernel = [read('../scene/tankViewer.js'), read('../scene/viewer/turretRig.ts'), read('../scene/viewer/modelLifecycle.ts'), read('../scene/viewer/heatmap.ts'), read('../scene/viewer/judgment.ts'), read('../scene/viewer/trajectoryCard.ts'), read('../scene/viewer/diagnosticProbe.ts'), read('../scene/viewer/shotReplay.ts'), read('../scene/viewer/shotReplayMiss.ts'), read('../scene/viewer/debugUi.ts'), read('../scene/viewer/equipmentState.ts'), read('../scene/viewer/collisionView.ts'), read('../scene/viewer/viewerMath.ts'), read('../scene/viewer/dataLoader.ts'), read('../scene/viewer/aimInput.ts')].join('\n')
  it('guards shot handoff, shooter models and delayed callbacks after scene disposal', () => {
    expect(kernel).toMatch(/const shotGen = deps\.loadGen\.get\(\);\s*const currentShot = \(\) => !deps\.isDestroyed\(\) && shotGen === deps\.loadGen\.get\(\);/)
    expect(kernel).toMatch(/fetchReplayShots\(\)\.then\(d => \{\s*if \(!currentShot\(\)\) return;/)
    expect(kernel).toMatch(/const sd = arr\[0\], (?:gltf|sModel) = arr\[1\];\s*if \(!currentShot\(\)\) \{ ml\.disposeDetachedModel\((?:gltf\?\.scene|sModel)\); return null;/)
    expect(kernel).toContain('if (!destroyed) callback();')
    expect(kernel).toContain('pendingTimers.forEach(globalThis.clearTimeout)')
    expect(kernel).toMatch(/function showShotError\(msg(?:: string)?\)(?:: void)? \{\s*if \(isDestroyed\(\)\) return;/)
  })
})

// dolly-zoom 作用域守卫（review P2）：两车 world 总览按射手/目标取景，不适用单车 dolly-zoom。
// 修前每帧无条件应用：reviewer 实测 400m 直线回放相机 (-200,88,120) 对两车中点（距 249.3m），
// FOV 50°→6.4238°，受击锚点 NDC-y 0.317→2.633（出视锥）。
describe('dolly-zoom world-overview scope guard', () => {
  const kernel = [read('../scene/tankViewer.js'), read('../scene/viewer/turretRig.ts'), read('../scene/viewer/modelLifecycle.ts'), read('../scene/viewer/heatmap.ts'), read('../scene/viewer/judgment.ts'), read('../scene/viewer/trajectoryCard.ts'), read('../scene/viewer/diagnosticProbe.ts'), read('../scene/viewer/shotReplay.ts'), read('../scene/viewer/shotReplayMiss.ts'), read('../scene/viewer/debugUi.ts'), read('../scene/viewer/equipmentState.ts'), read('../scene/viewer/collisionView.ts'), read('../scene/viewer/viewerMath.ts'), read('../scene/viewer/dataLoader.ts'), read('../scene/viewer/aimInput.ts')].join('\n')
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
    expect(kernel).toMatch(/const ARMOR_FAR_PRODUCT_GAIN = 0\.028;/)
    expect(kernel).toMatch(/const ARMOR_FAR_PRODUCT_MAX = 3\.8;/)
    expect(kernel).toMatch(/const ARMOR_PRODUCT_SCALE = 1\.1;/)
    expect(kernel).toMatch(/camera\.position\.set\(0, 0, -ARMOR_REF_DIST\);/)
    expect(kernel).toMatch(/controls\.minDistance = 3;/)
    expect(kernel).toMatch(/controls\.maxDistance = 500;/)
    expect(kernel).toMatch(/fov = dollyZoomFov\(d, true, ARMOR_BASE_FOV, ARMOR_REF_DIST, ARMOR_MIN_FOV, ARMOR_MAX_FOV, ARMOR_FAR_PRODUCT_GAIN, ARMOR_FAR_PRODUCT_MAX, ARMOR_PRODUCT_SCALE\);/)
    expect(kernel).toMatch(/near = 0\.05 \* d;/)
    expect(kernel).toMatch(/far = d \+ 30;/)
    expect(kernel).toMatch(/controls\.target\.set\(aimCenter\.x, aimCenter\.y, aimCenter\.z\);/)
    expect(kernel).toMatch(/camera\.position\.set\(aimCenter\.x, aimCenter\.y, aimCenter\.z - ARMOR_REF_DIST\);/)
    expect(kernel).toMatch(/controls\.target\.set\(0, P\.ty, 0\);/)
    expect(kernel).toMatch(/const camView = QP\.get\('camview'\) \|\| \(CAMERA_VIEW_PRESETS\.has\(view\) \? view : null\);/)
  })
  it('场景风格跟随网页 UI：透明画布、无地面网格、半球光主题表面色', () => {
    const view = [read('./AgentArmorView.vue'), read('./agent-armor/ArmorToolsPanel.vue'), read('./agent-armor/ArmorSideCard.vue'), read('./agent-armor/useArmorSetupQuery.js'), read('./agent-armor/armorViewerLabels.js'), read('./agent-armor-view.css')].join('\n')
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
    expect(kernel).toMatch(/const isMiss = !s\.target_name;\s*if \(isMiss\) \{[\s\S]*?renderMissShotAnnotation\((?:deps|missDeps)/)
    // 命中 world 路径同置（紧随穿透判定标志）
    expect(kernel).toMatch(/window\.__worldPenMode = true;\s*deps\.setWorldOverviewMode\(true\);/)
    // 每发进入射击复现重置
    expect(kernel).toMatch(/window\.__worldPenMode = false;[\s\S]{0,160}deps\.setWorldOverviewMode\(false\);/)
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
    // 显示缩放：production 调用传 ARMOR_PRODUCT_SCALE=1.1；15m/500m 的屏幕角尺寸整体缩小 1/1.1。
    const armorFovScaled = (d) => dollyZoomFov(d, true, 18.75, 15, 0.5, 40, 0.0128, 2.8, 1.1)
    for (const d of [15, 500]) {
      const base = armorFov(d)
      const scaled = armorFovScaled(d)
      expect(scaled).toBeGreaterThan(base)
      expect(Math.tan(scaled * Math.PI / 360) / Math.tan(base * Math.PI / 360)).toBeCloseTo(1.1, 6)
    }
    // 生产显示 profile：+0.028/m、封顶 3.8、整体 ×1.1；车体随距离缩放明显强于实测参考。
    const productionFov = (d) => dollyZoomFov(d, true, 18.75, 15, 0.5, 40, 0.028, 3.8, 1.1)
    const productAt = (d) => Math.tan(productionFov(d) * Math.PI / 360) * d
    expect(productionFov(15)).toBeCloseTo(20.59, 1)             // 1.1 整体缩放后的实际默认 FOV
    expect(productAt(30) / productAt(15)).toBeGreaterThan(1.1)   // 30m 约小 14%
    expect(productAt(100) / productAt(15)).toBeGreaterThan(1.4)  // 100m 约小 35%
    expect(productAt(500)).toBeCloseTo(productAt(100), 6)        // 远距封顶
    expect(dollyZoomFov(15, false)).toBeCloseTo(50, 6)
    const fovOn = dollyZoomFov(249.3, true)
    expect(fovOn).toBeCloseTo(6.4238, 2)                    // reviewer 实测值（k=8.31）
    // 垂直 NDC-y = tan(偏心角)/tan(fov/2)：同一 8.41° 偏心锚点，原生在视锥内、误套补偿越界
    const ndcY = (offDeg, fovDeg) => Math.tan(offDeg * Math.PI / 180) / Math.tan(fovDeg * Math.PI / 360)
    expect(ndcY(8.41, 50)).toBeLessThan(1)                  // ≈0.317（reviewer 实测）
    expect(ndcY(8.41, fovOn)).toBeGreaterThan(2)            // ≈2.63（越界）
  })
  it('WebGL context lost 显示带 GPU 信息的错误态，retry 重建 renderer', () => {
    expect(kernel).toMatch(/addEventListener\('webglcontextlost', reportContextLost\)/)
    expect(kernel).toMatch(/addEventListener\('webglcontextrestored', reportContextRestored\)/)
    expect(kernel).toMatch(/event\.preventDefault\(\)/)
    expect(kernel).toMatch(/UNMASKED_RENDERER_WEBGL/)
    expect(kernel).toMatch(/contextLost = true/)
    expect(kernel).toMatch(/if \(destroyed \|\| contextLost \|\| !dl\.isInitDone\(\)/)
    expect(kernel).toMatch(/if \(contextLost && !\(state && state\.contextLost\)\) return;/)
    expect(kernel).toMatch(/loadGen\+\+;\s*targetLoadGen\+\+;\s*dl\.bumpShooterLoadGen\(\);/)
    expect(kernel).toMatch(/function animate\(\) \{\s*if \(destroyed \|\| contextLost\) return;/)
    expect(kernel).toMatch(/reportLoad\(\{ state: 'error', message: contextLostMessage\(\), contextLost: true \}\)/)
    expect(kernel).toMatch(/function isContextLost\(\) \{ return contextLost; \}/)
    // 装甲厚度与击穿视图互斥；厚度模式点击只出部件信息，不做击穿判定
    expect(kernel).toMatch(/collisionMode && penetrationMode/)
    expect(kernel).toMatch(/penetrationMode && collisionMode/)
    expect(kernel).toMatch(/if \(getCollisionMode\(\)\) \{ showArmorPartInfo\(event, ndcX, ndcY\); return; \}/)
    expect(kernel).toMatch(/function showArmorPartInfo\(_?event: MouseEvent, ndcX: number, ndcY: number\): void/)
    // 碰撞视图保留炮管/履带碰撞体
    expect(kernel).toMatch(/function applyModuleCollisionMaterial\(on(?:: boolean)?\)(?:: void)?/)
    expect(kernel).toMatch(/moduleOriginalMaterials\.set\((?:node|mesh), (?:node|mesh)\.material\)/)
    // 卸载目标时释放厚度视图缓存的原材质/实心材质及贴图，避免换车累积模型内存
    expect(kernel).toMatch(/function releaseModuleMaterialCaches\((?:: void)?\)/)
    expect(kernel).toMatch(/moduleOriginalMaterials\.clear\(\)/)
    expect(kernel).toMatch(/releaseModuleMaterialCaches\(\);[\s\S]{0,200}?clearHighlight\(\);/)
    expect(kernel).toMatch(/const staleClickInfo = document\.getElementById\('click-info'\);/)
    expect(kernel).toMatch(/moduleMeshes = \[\];/)
    expect(kernel).toMatch(/const keep = new Set\(getModuleMeshes\(\)\)/)
    // 分类过滤（主装甲/间隙/外部模块）
    // 碰撞视图隐藏用逐节点标记（重复调用不丢状态），退出后外观恢复
    expect(kernel).toMatch(/node\.userData\.collisionHidden = true/)
    expect(kernel).not.toMatch(/collisionHiddenVisuals/)
    // 模式按钮文案固定：不按开关改 textContent（否则面板宽度跳动）
    expect(kernel).not.toMatch(/this\.textContent = penetrationMode/)
    expect(kernel).not.toMatch(/this\.textContent = collisionMode/)
    expect(kernel).toMatch(/setArmorFilterRowVisible\(collisionMode\)/)
    expect(kernel).toMatch(/if \(!collisionMode\) cvs\.resetArmorFilters\(\);/)
    expect(read('./AgentArmorView.vue')).toMatch(/id="armor-filters"/)
    expect(kernel).toMatch(/const hiddenCategories(?:: Record<ArmorCategory, boolean>)? = \{ primary: false, spaced: false, external: false \}/)
    expect(kernel).toMatch(/function applyCategoryFilters\(/)
    // 击穿视图默认开启，?heatmap=0 显式关闭（2026-10-28 用户要求）
    expect(kernel).toMatch(/if \(QP\.get\('heatmap'\) !== '0' && !penetrationMode && !collisionMode\)/)
    // 普通检视换弹：只清掉上一次判定，不按旧点击位置重跑（2026-10-28 用户裁定）
    // 输入变化后只清旧结果、不按旧点击位置重跑；条件覆盖两个视图（默认视图也能建 HE 渐变）。
    expect(kernel).toMatch(/else if \(jc\.getLastClickNdc\(\) \|\| hm\.getHeHeatmapCenter\(\)\) \{[\s\S]*?tc\.tidyTrajectory\(\);/)
    expect(kernel).not.toMatch(/doPenetrationCheck\(lastClickNdc\.x, lastClickNdc\.y\)/)
    // 厚度视图点击高亮（2026-10-28 用户要求，对齐 BlitzKit）：被点装甲板保持不透明、
    // 其余装甲板/模块降透明度；**不改厚度色相**（不加金色自发光，2026-10-29 用户报障：
    // 点击后颜色与点击前不一致）；复位只作用于碰撞视图，不能把普通视图的透明覆盖层改成不透明。
    // 状态写入经 applyArmorMaterialState（needsUpdate 只在 transparent/depthWrite 真变时置位，
    // 透明度数值本身不需要重评估）。
    expect(kernel).toMatch(/function applyArmorHighlight\(selected(?:: THREE\.Object3D \| null)?\)(?:: void)?/)
    expect(kernel).not.toContain('0xffc247')
    expect(kernel).toMatch(/if \(node === selected\) \{[\s\S]*?applyArmorMaterialState\(m, true, 1, true\);[\s\S]*?m\.emissive\.setHex\(0x000000\)/)
    expect(kernel).toMatch(/applyArmorMaterialState\(m, true, modules\.has\(node\) \? 0\.15 : 0\.18, false\)/)
    expect(kernel).toMatch(/function applyArmorMaterialState\(m: THREE\.Material, transparent: boolean, opacity: number, depthWrite: boolean\)(?:: void)? \{[\s\S]*?if \(m\.transparent !== transparent \|\| m\.depthWrite !== depthWrite\) m\.needsUpdate = true;/)
    expect(kernel).toMatch(/function resetArmorHighlight\((?:: void)?\)[\s\S]*?if \(!getCollisionMode\(\) \|\| !models\.armorModel\) return;/)
    expect(kernel).toMatch(/applyArmorMaterialState\(m, true, modules\.has\(node\) \? 1 : 0\.95, true\)/)
    // 命中换板、落空清空；离开碰撞视图 / 换配置 / 过滤隐藏当前板都要清掉高亮
    expect(kernel).toMatch(/if \(!info\) \{ cvs\.resetArmorHighlight\(\); if \(card\) card\.style\.display = 'none'; return; \}[\s\S]*?cvs\.applyArmorHighlight\(info\.object\);/)
    expect(kernel).toMatch(/if \(!collisionMode\) \{ cvs\.resetArmorHighlight\(\); document\.getElementById\('click-info'\)\.style\.display = 'none'; \}/)
    expect(kernel).toMatch(/getCollisionMode\(\) && highlightedArmorNode && !isEffectivelyVisibleFn\(highlightedArmorNode\)[\s\S]*?resetArmorHighlight\(\);/)
    // 视觉模型必须渲染全部部件：`gun_XX_mask` 是炮盾/炮根视觉（Super Conqueror 19281 等
    // 无 mask 值的车，炮塔与炮管之间只由这个网格连接），不能写进可见性
    // （2026-10-28 用户报障：视觉模型缺件）。
    const baseVisible = kernel.slice(kernel.indexOf('function baseNodeVisible('), kernel.indexOf('function setArmorFilterRowVisible('))
    expect(baseVisible).not.toContain('gunMaskPart')
    // BlitzKit 口径（2026-10-28 用户裁定回退）：外部模块按 mask 标量选取——有 mask 值
    // → gun_0X* 全部网格（含 _mask/辅助件，由同一平面裁掉炮根）；无 mask 值 → 只取精确
    // gun_0X。辅助件必须并入模块（BlitzKit startsWith），不能按纯视觉 deco 隐藏。
    expect(plateModel).toMatch(/if \(node\.userData\.gunMaskPart && !hasMask\) return\s*\n\s*out\.push\(node\)/)
    expect(kernel).toMatch(/const hideMaskPart = getCollisionMode\(\) && !hasMask;/)
    expect(kernel).toMatch(/&& !\(hideMaskPart && node\.userData\.gunMaskPart\)/)
    const tagFn = plateModel.slice(plateModel.indexOf('function tagModuleMeshes('), plateModel.indexOf('function collectArmorPrefixes('))
    expect(tagFn).not.toContain("armorSection = 'deco'")
    expect((tagFn.match(/gunMaskPart = true/g) || [])).toHaveLength(2)
    // 平面 = BlitzKit 同式：枪管局部系（法线=模型前向）过模型原点前方 gun_mask+原点链处，
    // 随炮塔/炮管姿态矩阵（gunPoseMatrix）与模型根变换进世界系；厚度视图实心炮管体与
    // 续飞着色器同步同一平面。不能再用「模型原点 + 炮口方向 × 距离」的近似。
    expect(plateModel).toMatch(/return cfg\.gun_mask \+ mo\.track\[1\] \+ mo\.turret\[1\] \+ cfg\.gun_origin\[1\]/)
    expect(kernel).toMatch(/gunPoseMatrix\.copy\(mGun\);/)
    expect(kernel).toMatch(/_gunClipMatrix\.copy\(models\.tankModel\.matrixWorld\)\.multiply\(rig\.gunPoseMatrix\);/)
    expect(kernel).toMatch(/plane\.applyMatrix4\(_gunClipMatrix\);/)
    expect(kernel).toMatch(/new THREE\.Vector3\(0, 1, 0\),/)
    expect(kernel).not.toContain('gunMuzzleWorld')
    expect(kernel).toMatch(/function syncModuleClipPlanes\(\)/)
    expect(kernel).toMatch(/if \(collision\) hmRef\(\)\.computeGunClipPlane\(\);/)
    expect(kernel).toMatch(/if \(getCollisionMode\(\)\) \{ computeGunClipPlane\(\); syncModuleClipPlanes\(\); \}/)
    expect(kernel).toMatch(/rcUniforms\.rcClipEnabled\.value = true;/)
    expect(kernel).toMatch(/return \{[\s\S]*?destroy, retry, canPick: \(\) => dl\.canPick\(\), isContextLost,/)
    for (const api of ['setConfig: (...a) => dl.applyConfig(...a)', 'setConfigUiVisible: (...a) => dl.setConfigUiVisible(...a)', 'setShellUiVisible: (...a) => dl.setShellUiVisible(...a)', 'setShell', 'setShooterConfig', 'setEquipmentOverride']) {
      expect(kernel).toContain(api)
    }
    // 强化装甲的厚度系数与判定模式无关：setEquipmentOverride → 统一刷新，且刷新在
    // “penetrationMode/叠加层机械” 早退之前就写入 uniform（否则装甲检视模式里开关不生效；
    // 默认视图 HE 渐变机械存在时同样要刷新，2026-10-30）。
    expect(kernel).toMatch(/function setEquipmentOverride\(kind, value\)[\s\S]*?refreshEquipmentEffects\(\);/)
    // 旧结果失效必须排在资源守卫之前：厚度视图里叠加层已释放，若守卫先行则清理执行不到
    // （Codex 复核 P2），上一发的爆点/结果卡会在回到默认视图时被复活。
    expect(kernel).toMatch(/function refreshEquipmentEffects\(\)[\s\S]*?hm\.updateHeatmapThickness\(\);[\s\S]*?if \(!QP\.get\('shot'\) && \(jc\.getLastClickNdc\(\) \|\| hm\.getHeHeatmapCenter\(\)\)\) \{/)
    expect(kernel).not.toMatch(/if \(!penetrationMode && !primaryArmorScene\) return;/)
    const view = [read('./AgentArmorView.vue'), read('./agent-armor/ArmorToolsPanel.vue'), read('./agent-armor/ArmorSideCard.vue'), read('./agent-armor/useArmorSetupQuery.js'), read('./agent-armor/armorViewerLabels.js'), read('./agent-armor-view.css')].join('\n')
    expect(view).toMatch(/function startViewer\(preserveSelection = false\)/)
    expect(view).toMatch(/if \(!preserveSelection\) \{/)
    expect(view).toMatch(/selectedShooterId\.value = null/)
    expect(view).toMatch(/selectedTargetId\.value = null/)
    expect(view).toMatch(/preserveSelection && selectedTargetId\.value != null/)
    expect(view).toMatch(/previous\?\.isContextLost\?\.\(\) === true/)
  })
})

// 结果卡定位（2026-11-16 用户裁示）：锚点 = 世界命中点，每帧用当前相机投影到画布容器，
// 旋转视角时卡片随命中点移动；命中点转到相机后方时隐藏。固定 HUD 面板仍由共享纯函数避让。
// 行为断言见 resultCardAnchor.test.ts / trajectoryCard.anchor.test.ts，本处只锁内核接线。
describe('traj-info hit-follow layout', () => {
  const kernel = [read('../scene/tankViewer.js'), read('../scene/viewer/turretRig.ts'), read('../scene/viewer/modelLifecycle.ts'), read('../scene/viewer/heatmap.ts'), read('../scene/viewer/judgment.ts'), read('../scene/viewer/trajectoryCard.ts'), read('../scene/viewer/resultCardPosition.ts'), read('../scene/viewer/resultCardAnchor.ts'), read('../scene/viewer/diagnosticProbe.ts'), read('../scene/viewer/shotReplay.ts'), read('../scene/viewer/shotReplayMiss.ts'), read('../scene/viewer/debugUi.ts'), read('../scene/viewer/equipmentState.ts'), read('../scene/viewer/collisionView.ts'), read('../scene/viewer/viewerMath.ts'), read('../scene/viewer/dataLoader.ts'), read('../scene/viewer/aimInput.ts')].join('\n')
  it('世界命中点逐帧投影（容器坐标 + 面板避让），相机后方隐藏', () => {
    const start = kernel.indexOf('function updateTrajInfoPos()')
    expect(start).toBeGreaterThan(-1)
    const fn = kernel.slice(start, kernel.indexOf('function ', start + 10))
    // 每帧把世界命中点投到画布容器；相机旋转后同一命中点的屏幕位置改变。
    expect(fn).toMatch(/projectCardAnchor\(trajAnchorWorld, getCamera\(\), rect\.width, rect\.height\)/)
    // 锚点移动不是 dirty-only：≥0.5px 即重排（相机旋转帧必须跟随）。
    expect(fn).toMatch(/Math\.abs\(projected\.x - lastAnchor\.x\) >= 0\.5/)
    // 命中点在相机后方/投影非法：隐藏，不固定到边角。
    expect(fn).toMatch(/if \(!projected \|\| !projected\.inFront\)/)
    expect(fn).toMatch(/div\.style\.display = 'none'/)
    // 锚点 → 共享定位纯函数；脚本写 left/top 并覆盖回退的 logical inset/transform
    expect(fn).toMatch(/chooseResultCardPosition\(\{/)
    expect(fn).toMatch(/div\.style\.left = /)
    expect(fn).toMatch(/div\.style\.top = /)
    // 逻辑与物理 inset 写同一个像素值；inset-*: auto 会把 left/top 打回静态位置
    expect(fn).toMatch(/div\.style\.insetInlineStart = `\$\{pos\.left\}px`/)
    expect(fn).toMatch(/div\.style\.insetBlockStart = `\$\{pos\.top\}px`/)
    expect(fn).not.toMatch(/div\.style\.insetInlineStart = 'auto'/)
    expect(fn).toMatch(/div\.style\.transform = 'none'/)
    // 内容被高度上限裁剪时必须恢复指针事件（滚轮/触控可滚动），否则桌面滚轮穿透到场景
    expect(fn).toMatch(/div\.style\.pointerEvents = div\.scrollHeight > div\.clientHeight \+ 1 \? 'auto' : ''/)
    // 无世界锚点：清掉内联定位与逻辑宽度覆盖，交还样式回退（紧凑横屏上限）
    expect(fn).toMatch(/div\.style\.insetInlineStart = ''/)
    expect(fn).toMatch(/div\.style\.maxInlineSize = ''/)
    // 逻辑宽度覆盖只在跟随态写（回退态由 CSS 拥有）
    expect(fn).toMatch(/div\.style\.maxInlineSize = `\$\{maxWidth\}px`/)
    // 容器宽度/坐标系按画布容器测量（侧栏/窄画布不能按视口算）
    expect(fn).toMatch(/getElementById\('canvas-container'\)/)
    expect(fn).toMatch(/getBoundingClientRect\(\)/)
  })
})

// 交战距离结果行本地化（review P3）：标签/单位走 labels（三语），不用硬编码中文。
describe('engagement-distance result line localization', () => {
  const kernel = [read('../scene/tankViewer.js'), read('../scene/viewer/turretRig.ts'), read('../scene/viewer/modelLifecycle.ts'), read('../scene/viewer/heatmap.ts'), read('../scene/viewer/judgment.ts'), read('../scene/viewer/trajectoryCard.ts'), read('../scene/viewer/diagnosticProbe.ts'), read('../scene/viewer/shotReplay.ts'), read('../scene/viewer/shotReplayMiss.ts'), read('../scene/viewer/debugUi.ts'), read('../scene/viewer/equipmentState.ts'), read('../scene/viewer/collisionView.ts'), read('../scene/viewer/viewerMath.ts'), read('../scene/viewer/dataLoader.ts'), read('../scene/viewer/aimInput.ts')].join('\n')
  const view = [read('./AgentArmorView.vue'), read('./agent-armor/ArmorToolsPanel.vue'), read('./agent-armor/ArmorSideCard.vue'), read('./agent-armor/useArmorSetupQuery.js'), read('./agent-armor/armorViewerLabels.js'), read('./agent-armor-view.css')].join('\n')
  it('结果卡距离行插值 L.shotDistance / L.distanceUnit', () => {
    // 卡片 HTML 已出仓 viewer/shotResultCard.ts（Wave B3A）：距离行插值的行为断言
    // 在 src/scene/viewer/shotResultCard.test.ts（含三语）；这里只锁场景内核的接线——
    // 把三语 labels 与 distVal 交给 renderer，不得在内核绕过 renderer 直拼卡片文案。
    expect(kernel).toContain('renderShotResultCardHtml({')
    expect(kernel).toMatch(/renderShotResultCardHtml\(\{[\s\S]*?labels: L,/)
    expect(kernel).not.toMatch(/交战距离: \$\{fmtNum/)
  })
  it('labels 装配与三语键在位（en/ru 结果卡不再出中文）', () => {
    const card = read('../scene/viewer/shotResultCard.ts')
    expect(view).toContain("shotDistance: t('armor.distance')")
    expect(view).toContain("distanceUnit: t('armor.distance_unit')")
    expect(view).toContain("effectivePenetration: t('armor.effective_penetration')")
    expect(view).toContain("shotAvgShort: t('armor.avg_short')")
    // 消费方已出仓 viewer/shotResultCard.ts（Wave B3A）：labels 子集由 renderer 消费。
    expect(card).toContain('L.shotAvgShort')
    const locales = JSON.parse(read('../locales/feature-messages.json'))
    expect(locales.en.armor.distance).toBe('Engagement distance')
    expect(locales.ru.armor.distance).toBe('Дистанция боя')
    expect(locales.en.armor.distance_unit).toBe('m')
    expect(locales.ru.armor.distance_unit).toBe('м')
    expect(locales.zh.armor.effective_penetration).toBe('有效穿深')
    expect(locales.en.armor.effective_penetration).toBe('Effective penetration')
    expect(locales.ru.armor.effective_penetration).toBe('Эффективное пробитие')
    expect(locales.zh.armor.avg_short).toBe('平均')
    expect(locales.en.armor.avg_short).toBe('avg')
    expect(locales.ru.armor.avg_short).toBe('сред.')
  })
})

// 间隙板首层跳弹上屏：SPACED_FRAG 写 G=间隙甲层标记；主装甲独立套用自身 normalization/2×
// （BlitzKit 逐层规则）。PBR 直接累加逐层 normalized R，状态通道只负责最近层跳弹/续飞。
