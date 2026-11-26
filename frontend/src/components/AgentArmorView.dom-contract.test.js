import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { tankViewerSource } from '../scene/__tests__/sceneSource.ts'

const read = (rel) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8')
const plateModel = read('../scene/viewer/armorPlateModel.ts') + '\n' + read('../scene/viewer/armorPenetrationScenes.ts')

describe('AgentArmorView ↔ tankViewer DOM 契约', () => {
  const template = [read('./AgentArmorView.vue'), read('./agent-armor/ArmorToolsPanel.vue'), read('./agent-armor/ArmorSideCard.vue'), read('./agent-armor/useArmorSetupQuery.ts'), read('./agent-armor/armorViewerLabels.ts'), read('./agent-armor-view.css'), read('./agent-armor-view-responsive.css'), read('./agent-armor-view-hud-responsive.css')].join('\n')
  const kernel = [tankViewerSource(), read('../scene/viewer/turretRig.ts'), read('../scene/viewer/modelLifecycle.ts'), read('../scene/viewer/heatmap.ts'), read('../scene/viewer/judgment.ts'), read('../scene/viewer/judgmentClick.ts'), read('../scene/viewer/trajectoryCard.ts'), read('../scene/viewer/resultCardPosition.ts'), read('../scene/viewer/resultCardAnchor.ts'), read('../scene/viewer/diagnosticProbe.ts'), read('../scene/viewer/shotReplay.ts'), read('../scene/viewer/shotReplayMiss.ts'), read('../scene/viewer/debugUi.ts'), read('../scene/viewer/equipmentState.ts'), read('../scene/viewer/collisionView.ts'), read('../scene/viewer/viewerMath.ts'), read('../scene/viewer/dataLoader.ts'), read('../scene/viewer/aimInput.ts')].join('\n')

  it('内核 getElementById 的静态 ID 全部由模板提供', () => {
    const kernelLookups = new Set([...kernel.matchAll(/(?:getElementById|byId(?:<[^>]+>)?)\('([^']+)'\)/g)].map((m) => m[1]))
    expect(kernelLookups.size).toBeGreaterThan(30)
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

  it('判定模式单结果窗口：逐层卡跟随点击并缩放，五行卡只在厚度模式', () => {
    for (const id of ['click-part', 'click-armor', 'click-angle', 'click-effective', 'click-pen', 'click-result']) {
      expect(template, `模板缺 ${id}`).toContain(`id="${id}"`)
      expect(kernel, `内核未写入 ${id}`).toContain(`'${id}'`)
    }
    expect(kernel).toMatch(/function writeClickInfo\(fields: \{/)
    expect(kernel).toMatch(/function placeClickInfo\(clientX: number, clientY: number\): void \{/)
    expect(kernel.match(/writeClickInfo\(\{/g)?.length, 'writeClickInfo 调用点').toBe(1)
    expect(kernel).not.toMatch(/clickInfoResultCode/)
    const clickOwner = read('../scene/viewer/judgmentClick.ts')
    const collisionDispatch = /if \(getCollisionMode\(\)\) \{ showArmorPartInfo\(event, ndcX, ndcY\); return; \}/
    expect(clickOwner).toMatch(collisionDispatch)
    expect(clickOwner.replace('showArmorPartInfo(event, ndcX, ndcY);', '')).not.toMatch(collisionDispatch)
    expect(kernel).not.toMatch(/clickAnchor/)
    expect(kernel).toMatch(/trajAnchorWorld = firstPoint\.clone\(\)/)
    expect(kernel).toMatch(/export function projectCardAnchor\(/)
    expect(kernel).toMatch(/export function chooseResultCardPosition\(/)
    expect(kernel).toMatch(/chooseResultCardPosition\(\{/)
    expect(kernel).toMatch(/div\.style\.left = /)
    expect(kernel).toMatch(/div\.style\.top = /)
    expect(kernel).toMatch(/div\.style\.insetInlineStart = ''/)
    expect(kernel).toMatch(/div\.style\.transform = ''/)
    expect(kernel).toMatch(/projectCardAnchor\(trajAnchorWorld, getCamera\(\), rect\.width, rect\.height\)/)
    expect(kernel).toMatch(/for \(const selector of \['#corner-tl', '#corner-tr', '#turret-controls', '\.armor-back', '\.armor-shot-view-switch'\]\)/)
    const dockCss = template.slice(template.indexOf('.armor-view #traj-info {'))
    const dockRule = dockCss.slice(0, dockCss.indexOf('}'))
    expect(dockRule).toContain('position: absolute')
    expect(dockRule).toContain('inset-inline-start: 50%')
    expect(template).not.toMatch(/\.armor-view :is\(#click-info, #traj-info\)/)
    const viewer = tankViewerSource()
    expect(viewer).toContain("const clickInfo = document.getElementById('click-info');")
    expect(viewer).toMatch(/if \(clickInfo\) clickInfo\.style\.display = 'none';/)
    expect(viewer).toMatch(/tc\.markTrajInfoDirty\(\);/)
    expect(viewer).toMatch(/repositionResultCard: \(\) => \{ tc\.markTrajInfoDirty\(\); tc\.updateTrajInfoPos\(\); \}/)
    expect(viewer).toMatch(/new ResizeObserver\(\(\) => tc\.markTrajInfoDirty\(\)\)/)
    expect(viewer).toMatch(/for \(const selector of \['#corner-tl', '#corner-tr', '#turret-controls', '\.armor-back', '\.armor-shot-view-switch'\]\)/)
    expect(template).toMatch(/const resultExpanded = ref\(!isShotPage\.value\)/)
    expect(template).toMatch(/watch\(isShotPage, shot => \{ resultExpanded\.value = !shot \}\)/)
    expect(template).toMatch(/watch\(resultExpanded, \(\) => nextTick\(\(\) => viewer\?\.repositionResultCard\?\.\(\)\)\)/)
    expect(kernel).toMatch(/shotResultCardMetrics\(compactCard, shotResultCardScale\(/)
    const metrics = read('../utils/shotResultCardMetrics.js')
    expect(metrics).toMatch(/export function shotResultCardScale\(/)
    expect(metrics).toMatch(/Math\.min\(fitted, 360, Math\.round\(width \* 0\.82\)\)/)
    expect(template).toMatch(/\.armor-view #traj-info \{[^}]*pointer-events: none;/)
    expect(template).toMatch(/\.armor-view #traj-info \{ pointer-events: auto; cursor: pointer; \}/)
    expect(template).toMatch(/\.armor-view #click-info \{[^}]*font-size: clamp\(/)
    expect(template).toMatch(/pointer-events: none/)
    expect(template).toMatch(/> span:last-child:not\(#click-result\)/)
    expect(template).toMatch(/\.armor-view #click-info \.pen \{ color: var\(--green\)/)
    expect(template.indexOf('id="click-info"')).toBeLessThan(template.indexOf('id="corner-tr"'))
    expect(template).toMatch(/:is\(#info-panel, #tank-selectors, #turret-controls, #debug-info, #click-info\)/)
  })

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


describe('armor destroyed scene async ownership', () => {
  const kernel = [tankViewerSource(), read('../scene/viewer/turretRig.ts'), read('../scene/viewer/modelLifecycle.ts'), read('../scene/viewer/heatmap.ts'), read('../scene/viewer/judgment.ts'), read('../scene/viewer/judgmentClick.ts'), read('../scene/viewer/trajectoryCard.ts'), read('../scene/viewer/diagnosticProbe.ts'), read('../scene/viewer/shotReplay.ts'), read('../scene/viewer/shotReplayMiss.ts'), read('../scene/viewer/debugUi.ts'), read('../scene/viewer/equipmentState.ts'), read('../scene/viewer/collisionView.ts'), read('../scene/viewer/viewerMath.ts'), read('../scene/viewer/dataLoader.ts'), read('../scene/viewer/aimInput.ts')].join('\n')
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

describe('armor adjacent-shot teardown ownership', () => {
  const kernel = [tankViewerSource(), read('../scene/viewer/turretRig.ts'), read('../scene/viewer/modelLifecycle.ts'), read('../scene/viewer/heatmap.ts'), read('../scene/viewer/judgment.ts'), read('../scene/viewer/judgmentClick.ts'), read('../scene/viewer/trajectoryCard.ts'), read('../scene/viewer/diagnosticProbe.ts'), read('../scene/viewer/shotReplay.ts'), read('../scene/viewer/shotReplayMiss.ts'), read('../scene/viewer/debugUi.ts'), read('../scene/viewer/equipmentState.ts'), read('../scene/viewer/collisionView.ts'), read('../scene/viewer/viewerMath.ts'), read('../scene/viewer/dataLoader.ts'), read('../scene/viewer/aimInput.ts')].join('\n')
  it('guards shot handoff, shooter models and delayed callbacks after scene disposal', () => {
    expect(kernel).toMatch(/const shotGen = deps\.loadGen\.get\(\);\s*const currentShot = \(\) => !deps\.isDestroyed\(\) && shotGen === deps\.loadGen\.get\(\);/)
    expect(kernel).toMatch(/fetchReplayShots\(\)\.then\(d => \{\s*if \(!currentShot\(\)\) return;/)
    expect(kernel).toMatch(/const sd = arr\[0\], (?:gltf|sModel) = arr\[1\];\s*if \(!currentShot\(\)\) \{ ml\.disposeDetachedModel\((?:gltf\?\.scene|sModel)\); return null;/)
    expect(kernel).toContain('if (!destroyed) callback();')
    expect(kernel).toContain('pendingTimers.forEach(globalThis.clearTimeout)')
    expect(kernel).toMatch(/function showShotError\(msg(?:: string)?\)(?:: void)? \{\s*if \(isDestroyed\(\)\) return;/)
  })
})

describe('dolly-zoom world-overview scope guard', () => {
  const kernel = [tankViewerSource(), read('../scene/viewer/turretRig.ts'), read('../scene/viewer/modelLifecycle.ts'), read('../scene/viewer/heatmap.ts'), read('../scene/viewer/judgment.ts'), read('../scene/viewer/judgmentClick.ts'), read('../scene/viewer/trajectoryCard.ts'), read('../scene/viewer/diagnosticProbe.ts'), read('../scene/viewer/shotReplay.ts'), read('../scene/viewer/shotReplayMiss.ts'), read('../scene/viewer/debugUi.ts'), read('../scene/viewer/equipmentState.ts'), read('../scene/viewer/collisionView.ts'), read('../scene/viewer/viewerMath.ts'), read('../scene/viewer/dataLoader.ts'), read('../scene/viewer/aimInput.ts')].join('\n')
  it('animate 按 worldOverviewMode 门控（命中/脱靶 world 同置）；关闭态还原原生 50°', () => {
    expect(kernel).toMatch(/applyLongRangeCompensation\(!worldOverviewMode\)/)
    expect(kernel).not.toMatch(/applyLongRangeCompensation\(!window\.__worldPenMode\)/)
    expect(kernel).toMatch(/if \(!enabled\) \{[\s\S]*?fov = OVERVIEW_BASE_FOV;[\s\S]*?near = 0\.1;[\s\S]*?far = Math\.max\(1000, d \* 3\);/)
  })
  it('单车装甲检视与 shot replay 共用 Armor Inspector 实测标定', () => {
    expect(kernel).toMatch(/ARMOR_REF_DIST = 15;/)
    expect(kernel).toMatch(/ARMOR_BASE_FOV = 18\.75;/)
    expect(kernel).toMatch(/ARMOR_MAX_FOV = 40;/)
    expect(kernel).toMatch(/ARMOR_MIN_FOV = 0\.5;/)
    expect(kernel).toMatch(/ARMOR_FAR_PRODUCT_GAIN = 0\.028;/)
    expect(kernel).toMatch(/ARMOR_FAR_PRODUCT_MAX = 3\.8;/)
    expect(kernel).toMatch(/ARMOR_PRODUCT_SCALE = 1\.1;/) 
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
    const view = [read('./AgentArmorView.vue'), read('./agent-armor/ArmorToolsPanel.vue'), read('./agent-armor/ArmorSideCard.vue'), read('./agent-armor/useArmorSetupQuery.ts'), read('./agent-armor/armorViewerLabels.ts'), read('./agent-armor-view.css'), read('./agent-armor-view-responsive.css'), read('./agent-armor-view-hud-responsive.css')].join('\n')
    expect(kernel).not.toContain('GridHelper')
    expect(kernel).toContain('scene.background = null;')
    expect(kernel).toContain('antialias: true, alpha: true')
    expect(kernel).toContain("readThemeColor('--color-surface-2'")
    expect(view).toContain('background: var(--color-canvas);')
  })
  it('worldOverviewMode 命中/脱靶分支同置、每发重置（MISS 早返回回归）', () => {
    const missStart = kernel.indexOf('const isMiss = !s.target_name;')
    expect(missStart).toBeGreaterThan(-1)
    expect(kernel).toMatch(/const isMiss = !s\.target_name;\s*if \(isMiss\) \{[\s\S]*?renderMissShotAnnotation\((?:deps|missDeps)/)
    expect(kernel).toMatch(/window\.__worldPenMode = true;\s*deps\.setWorldOverviewMode\(true\);/)
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
    expect(shot.via[0][0]).toBeCloseTo(-180, 9)
    expect(shot.via[1][0]).toBeCloseTo(3.5, 9)
    expect(shotBallisticLength(shot)).toBeCloseTo(before, 9)
  })
  it('dollyZoomFov 纯函数与视锥锚点回归', async () => {
    const { dollyZoomFov } = await import('../scene/tankViewer.js')
    expect(dollyZoomFov(30, true)).toBeCloseTo(50, 6)
    expect(dollyZoomFov(249.3, false)).toBeCloseTo(50, 6)
    expect(dollyZoomFov(15, true)).toBeGreaterThan(50)
    const armorFov = (d) => dollyZoomFov(d, true, 18.75, 15, 0.5, 40, 0.0128, 2.8)
    expect(armorFov(15)).toBeCloseTo(18.75, 6)
    expect(armorFov(6.5)).toBeCloseTo(40, 6)
    const armorProduct = (d) => Math.min(2.8, Math.tan(18.75 * Math.PI / 360) * 15 + Math.max(0, d - 15) * 0.0128)
    const armorFov30 = 2 * Math.atan(armorProduct(30) / 30) * 180 / Math.PI
    expect(armorFov(30)).toBeCloseTo(armorFov30, 6)
    expect(armorFov(30)).toBeLessThan(11)
    expect(armorFov(28.35)).toBeCloseTo(10.67, 1)
    expect(armorFov(28.35)).toBeLessThan(armorFov(15))
    expect(armorFov(8.94)).toBeGreaterThan(18.75)
    expect(armorFov(8.94)).toBeLessThan(40)
    const armorFov500 = 2 * Math.atan(2.8 / 500) * 180 / Math.PI
    expect(armorFov(500)).toBeCloseTo(armorFov500, 6)
    expect(armorFov(500)).toBeGreaterThan(0.5)
    expect(armorFov(500)).toBeLessThan(0.7)
    expect(armorFov(500)).toBeLessThan(armorFov(15))
    const armorFovScaled = (d) => dollyZoomFov(d, true, 18.75, 15, 0.5, 40, 0.0128, 2.8, 1.1)
    for (const d of [15, 500]) {
      const base = armorFov(d)
      const scaled = armorFovScaled(d)
      expect(scaled).toBeGreaterThan(base)
      expect(Math.tan(scaled * Math.PI / 360) / Math.tan(base * Math.PI / 360)).toBeCloseTo(1.1, 6)
    }
    const productionFov = (d) => dollyZoomFov(d, true, 18.75, 15, 0.5, 40, 0.028, 3.8, 1.1)
    const productAt = (d) => Math.tan(productionFov(d) * Math.PI / 360) * d
    expect(productionFov(15)).toBeCloseTo(20.59, 1)
    expect(productAt(30) / productAt(15)).toBeGreaterThan(1.1)
    expect(productAt(100) / productAt(15)).toBeGreaterThan(1.4)
    expect(productAt(500)).toBeCloseTo(productAt(100), 6)
    expect(dollyZoomFov(15, false)).toBeCloseTo(50, 6)
    const fovOn = dollyZoomFov(249.3, true)
    expect(fovOn).toBeCloseTo(6.4238, 2)
    const ndcY = (offDeg, fovDeg) => Math.tan(offDeg * Math.PI / 180) / Math.tan(fovDeg * Math.PI / 360)
    expect(ndcY(8.41, 50)).toBeLessThan(1)
    expect(ndcY(8.41, fovOn)).toBeGreaterThan(2)
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
    expect(kernel).toMatch(/collisionMode && penetrationMode/)
    expect(kernel).toMatch(/penetrationMode && collisionMode/)
    const clickOwner = read('../scene/viewer/judgmentClick.ts')
    const collisionDispatch = /if \(getCollisionMode\(\)\) \{ showArmorPartInfo\(event, ndcX, ndcY\); return; \}/
    expect(clickOwner).toMatch(collisionDispatch)
    expect(clickOwner.replace('showArmorPartInfo(event, ndcX, ndcY);', '')).not.toMatch(collisionDispatch)
    expect(kernel).toMatch(/function showArmorPartInfo\(_?event: MouseEvent, ndcX: number, ndcY: number\): void/)
    expect(kernel).toMatch(/function applyModuleCollisionMaterial\(on(?:: boolean)?\)(?:: void)?/)
    expect(kernel).toMatch(/moduleOriginalMaterials\.set\((?:node|mesh), (?:node|mesh)\.material\)/)
    expect(kernel).toMatch(/function releaseModuleMaterialCaches\((?:: void)?\)/)
    expect(kernel).toMatch(/moduleOriginalMaterials\.clear\(\)/)
    expect(kernel).toMatch(/releaseModuleMaterialCaches\(\);[\s\S]{0,200}?clearHighlight\(\);/)
    expect(kernel).toMatch(/const staleClickInfo = document\.getElementById\('click-info'\);/)
    expect(kernel).toMatch(/moduleMeshes = \[\];/)
    expect(kernel).toMatch(/const keep = new Set\(getModuleMeshes\(\)\)/)
    expect(kernel).toMatch(/node\.userData\.collisionHidden = true/)
    expect(kernel).not.toMatch(/collisionHiddenVisuals/)
    expect(kernel).not.toMatch(/this\.textContent = penetrationMode/)
    expect(kernel).not.toMatch(/this\.textContent = collisionMode/)
    expect(kernel).toMatch(/setArmorFilterRowVisible\(collisionMode\)/)
    expect(read('./AgentArmorView.vue')).toMatch(/id="armor-result-legend"/)
    expect(kernel).toMatch(/setResultLegendVisible\(!collisionMode\)/)
    expect(kernel).toMatch(/if \(!collisionMode\) cvs\.resetArmorFilters\(\);/)
    expect(read('./AgentArmorView.vue')).toMatch(/id="armor-filters"/)
    expect(kernel).toMatch(/const hiddenCategories(?:: Record<ArmorCategory, boolean>)? = \{ primary: false, spaced: false, external: false \}/)
    expect(kernel).toMatch(/function applyCategoryFilters\(/)
    expect(kernel).toMatch(/if \(QP\.get\('heatmap'\) !== '0' && !penetrationMode && !collisionMode\)/)
    expect(kernel).toMatch(/else if \(jc\.getLastClickNdc\(\) \|\| hm\.getHeHeatmapCenter\(\)\) \{[\s\S]*?tc\.tidyTrajectory\(\);/)
    expect(kernel).not.toMatch(/doPenetrationCheck\(lastClickNdc\.x, lastClickNdc\.y\)/)
    expect(kernel).toMatch(/function applyArmorHighlight\(selected(?:: THREE\.Object3D \| null)?\)(?:: void)?/)
    expect(kernel).not.toContain('0xffc247')
    expect(kernel).toMatch(/if \(node === selected\) \{[\s\S]*?applyArmorMaterialState\(m, true, 1, true\);[\s\S]*?m\.emissive\.setHex\(0x000000\)/)
    expect(kernel).toMatch(/applyArmorMaterialState\(m, true, modules\.has\(node\) \? 0\.15 : 0\.18, false\)/)
    expect(kernel).toMatch(/function applyArmorMaterialState\(m: THREE\.Material, transparent: boolean, opacity: number, depthWrite: boolean\)(?:: void)? \{[\s\S]*?if \(m\.transparent !== transparent \|\| m\.depthWrite !== depthWrite\) m\.needsUpdate = true;/)
    expect(kernel).toMatch(/function resetArmorHighlight\((?:: void)?\)[\s\S]*?if \(!getCollisionMode\(\) \|\| !models\.armorModel\) return;/)
    expect(kernel).toMatch(/applyArmorMaterialState\(m, true, modules\.has\(node\) \? 1 : 0\.95, true\)/)
    expect(kernel).toMatch(/if \(!info\) \{ cvs\.resetArmorHighlight\(\); if \(card\) card\.style\.display = 'none'; return; \}[\s\S]*?cvs\.applyArmorHighlight\(info\.object\);/)
    expect(kernel).toMatch(/if \(!collisionMode\) \{ cvs\.resetArmorHighlight\(\); (?:document\.getElementById|byId)\('click-info'\)\.style\.display = 'none'; \}/)
    expect(kernel).toMatch(/getCollisionMode\(\) && highlightedArmorNode && !isEffectivelyVisibleFn\(highlightedArmorNode\)[\s\S]*?resetArmorHighlight\(\);/)
    const baseVisible = kernel.slice(kernel.indexOf('function baseNodeVisible('), kernel.indexOf('function setArmorFilterRowVisible('))
    expect(baseVisible).not.toContain('gunMaskPart')
    expect(plateModel).toMatch(/if \(node\.userData\.gunMaskPart && !hasMask\) return\s*\n\s*out\.push\(node\)/)
    expect(kernel).toMatch(/const hideMaskPart = getCollisionMode\(\) && !hasMask;/)
    expect(kernel).toMatch(/&& !\(hideMaskPart && node\.userData\.gunMaskPart\)/)
    const tagFn = plateModel.slice(plateModel.indexOf('function tagModuleMeshes('), plateModel.indexOf('function collectArmorPrefixes('))
    expect(tagFn).not.toContain("armorSection = 'deco'")
    expect((tagFn.match(/gunMaskPart = true/g) || [])).toHaveLength(2)
    expect(plateModel).toMatch(/return cfg\.gun_mask \+ mo\.track\[1\] \+ mo\.turret\[1\] \+ cfg\.gun_origin\[1\]/)
    expect(kernel).toMatch(/gunPoseMatrix\.copy\(mGun\);/)
    expect(kernel).toMatch(/_gunClipMatrix\.copy\(models\.tankModel\.matrixWorld\)\.multiply\(rig\.gunPoseMatrix\);/)
    expect(kernel).toMatch(/plane\.applyMatrix4\(_gunClipMatrix\);/)
    expect(kernel).toMatch(/new THREE\.Vector3\(0, 1, 0\),/)
    expect(kernel).not.toContain('gunMuzzleWorld')
    expect(kernel).toMatch(/function syncModuleClipPlanes\(\)/)
    expect(kernel).toMatch(/if \(collision\) hmRef\(\)\.computeGunClipPlane\(\);/)
    expect(kernel).toMatch(/if \(getCollisionMode\(\)\) \{ computeGunClipPlane\(\); syncModuleClipPlanes\(\); \}/)
    const heatmapPass = read('../scene/viewer/heatmapPasses.ts')
    expect(heatmapPass).toMatch(/rcUniforms\.rcClipEnabled\.value = true;/)
    expect(heatmapPass.replace('rcUniforms.rcClipEnabled.value = true;', '')).not.toMatch(/rcUniforms\.rcClipEnabled\.value = true;/)
    expect(kernel).toMatch(/return \{[\s\S]*?destroy(?:: destroy)?, retry(?:: retry)?, canPick: \(\) => dl\.canPick\(\), isContextLost(?:: isContextLost)?,/)
    for (const api of [
      /setConfig: (?:\(idx(?:: number)?\) => dl\.applyConfig\(idx\)|\(\.\.\.a\) => dl\.applyConfig\(\.\.\.a\))/,
      /setConfigUiVisible: (?:\(visible(?:: boolean)?\) => dl\.setConfigUiVisible\(visible\)|\(\.\.\.a\) => dl\.setConfigUiVisible\(\.\.\.a\))/,
      /setShellUiVisible: (?:\(visible(?:: boolean)?\) => dl\.setShellUiVisible\(visible\)|\(\.\.\.a\) => dl\.setShellUiVisible\(\.\.\.a\))/,
      /setShell: /, /setShooterConfig: /, /setEquipmentOverride: /,
    ]) {
      expect(kernel).toMatch(api)
    }
    expect(kernel).not.toMatch(/set(?:ShellUi|ConfigUi)?Visible: bind\(dl,/)
    expect(kernel).not.toMatch(/setConfig: bind\(dl,/)
    expect(kernel).toMatch(/function setEquipmentOverride\(kind(?:: [^)]+)?, value(?:: [^)]+)?\)[\s\S]*?refreshEquipmentEffects\(\);/)
    expect(kernel).toMatch(/function refreshEquipmentEffects\(\)[\s\S]*?hm\.updateHeatmapThickness\(\);[\s\S]*?if \(!QP\.get\('shot'\) && \(jc\.getLastClickNdc\(\) \|\| hm\.getHeHeatmapCenter\(\)\)\) \{/)
    expect(kernel).not.toMatch(/if \(!penetrationMode && !primaryArmorScene\) return;/)
    const view = [read('./AgentArmorView.vue'), read('./agent-armor/ArmorToolsPanel.vue'), read('./agent-armor/ArmorSideCard.vue'), read('./agent-armor/useArmorSetupQuery.ts'), read('./agent-armor/armorViewerLabels.ts'), read('./agent-armor-view.css'), read('./agent-armor-view-responsive.css'), read('./agent-armor-view-hud-responsive.css')].join('\n')
    expect(view).toMatch(/function startViewer\(preserveSelection = false\)/)
    expect(view).toMatch(/if \(!preserveSelection\) \{/)
    expect(view).toMatch(/selectedShooterId\.value = null/)
    expect(view).toMatch(/selectedTargetId\.value = null/)
    expect(view).toMatch(/preserveSelection && selectedTargetId\.value != null/)
    expect(view).toMatch(/previous\?\.isContextLost\?\.\(\) === true/)
  })
})

describe('traj-info hit-follow layout', () => {
  const kernel = [tankViewerSource(), read('../scene/viewer/turretRig.ts'), read('../scene/viewer/modelLifecycle.ts'), read('../scene/viewer/heatmap.ts'), read('../scene/viewer/judgment.ts'), read('../scene/viewer/judgmentClick.ts'), read('../scene/viewer/trajectoryCard.ts'), read('../scene/viewer/resultCardPosition.ts'), read('../scene/viewer/resultCardAnchor.ts'), read('../scene/viewer/diagnosticProbe.ts'), read('../scene/viewer/shotReplay.ts'), read('../scene/viewer/shotReplayMiss.ts'), read('../scene/viewer/debugUi.ts'), read('../scene/viewer/equipmentState.ts'), read('../scene/viewer/collisionView.ts'), read('../scene/viewer/viewerMath.ts'), read('../scene/viewer/dataLoader.ts'), read('../scene/viewer/aimInput.ts')].join('\n')
  it('世界命中点逐帧投影（容器坐标 + 面板避让），相机后方隐藏', () => {
    const start = kernel.indexOf('function updateTrajInfoPos()')
    expect(start).toBeGreaterThan(-1)
    const fn = kernel.slice(start, kernel.indexOf('function ', start + 10))
    expect(fn).toMatch(/projectCardAnchor\(trajAnchorWorld, getCamera\(\), rect\.width, rect\.height\)/)
    expect(fn).toMatch(/Math\.abs\(projected\.x - lastAnchor\.x\) >= 0\.5/)
    expect(fn).toMatch(/if \(!projected \|\| !projected\.inFront\)/)
    expect(fn).toMatch(/div\.style\.display = 'none'/)
    expect(fn).toMatch(/chooseResultCardPosition\(\{/)
    expect(fn).toMatch(/div\.style\.left = /)
    expect(fn).toMatch(/div\.style\.top = /)
    expect(fn).toMatch(/div\.style\.insetInlineStart = `\$\{pos\.left\}px`/)
    expect(fn).toMatch(/div\.style\.insetBlockStart = `\$\{pos\.top\}px`/)
    expect(fn).not.toMatch(/div\.style\.insetInlineStart = 'auto'/)
    expect(fn).toMatch(/div\.style\.transform = 'none'/)
    expect(fn).toMatch(/div\.style\.pointerEvents = div\.scrollHeight > div\.clientHeight \+ 1 \? 'auto' : ''/)
    expect(fn).toMatch(/div\.style\.insetInlineStart = ''/)
    expect(fn).toMatch(/div\.style\.maxInlineSize = ''/)
    expect(fn).toMatch(/div\.style\.maxInlineSize = `\$\{maxWidth\}px`/)
    expect(fn).toMatch(/getElementById\('canvas-container'\)/)
    expect(fn).toMatch(/getBoundingClientRect\(\)/)
  })
})

describe('engagement-distance result line localization', () => {
  const kernel = [tankViewerSource(), read('../scene/viewer/turretRig.ts'), read('../scene/viewer/modelLifecycle.ts'), read('../scene/viewer/heatmap.ts'), read('../scene/viewer/judgment.ts'), read('../scene/viewer/judgmentClick.ts'), read('../scene/viewer/trajectoryCard.ts'), read('../scene/viewer/diagnosticProbe.ts'), read('../scene/viewer/shotReplay.ts'), read('../scene/viewer/shotReplayMiss.ts'), read('../scene/viewer/debugUi.ts'), read('../scene/viewer/equipmentState.ts'), read('../scene/viewer/collisionView.ts'), read('../scene/viewer/viewerMath.ts'), read('../scene/viewer/dataLoader.ts'), read('../scene/viewer/aimInput.ts')].join('\n')
  const view = [read('./AgentArmorView.vue'), read('./agent-armor/ArmorToolsPanel.vue'), read('./agent-armor/ArmorSideCard.vue'), read('./agent-armor/useArmorSetupQuery.ts'), read('./agent-armor/armorViewerLabels.ts'), read('./agent-armor-view.css'), read('./agent-armor-view-responsive.css'), read('./agent-armor-view-hud-responsive.css')].join('\n')
  it('结果卡距离行插值 L.shotDistance / L.distanceUnit', () => {
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

