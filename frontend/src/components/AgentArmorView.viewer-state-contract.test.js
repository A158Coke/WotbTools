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
const plateModel = read('../scene/viewer/armorPlateModel.ts') + '\n' + read('../scene/viewer/armorPenetrationScenes.ts')
// 板分类/配置选择/穿透场景构建的共享实现（装甲查看器与 3D 回放同用）

describe('shot impact view first-frame pose propagation', () => {
  const kernel = [read('../scene/tankViewer.js'), read('../scene/viewer/turretRig.ts'), read('../scene/viewer/modelLifecycle.ts'), read('../scene/viewer/heatmap.ts'), read('../scene/viewer/judgment.ts'), read('../scene/viewer/trajectoryCard.ts'), read('../scene/viewer/diagnosticProbe.ts'), read('../scene/viewer/shotReplay.ts'), read('../scene/viewer/shotReplayMiss.ts'), read('../scene/viewer/debugUi.ts'), read('../scene/viewer/equipmentState.ts'), read('../scene/viewer/collisionView.ts'), read('../scene/viewer/viewerMath.ts'), read('../scene/viewer/dataLoader.ts'), read('../scene/viewer/aimInput.ts')].join('\n')
  it('updateTurretGun 写完炮塔/炮管装甲板矩阵后立即传播世界矩阵', () => {
    const start = kernel.indexOf('function updateTurretGun(')
    expect(start).toBeGreaterThan(-1)
    const end = kernel.indexOf('function collectArmorNodes(', start)
    expect(end).toBeGreaterThan(start)
    const body = kernel.slice(start, end)
    const lastWrite = body.lastIndexOf('node.matrixWorldNeedsUpdate = true;')
    expect(lastWrite).toBeGreaterThan(-1)
    const propagate = body.lastIndexOf('updateCollisionWorldMatrices();')
    expect(propagate, '世界矩阵未在首帧 raycast 前传播').toBeGreaterThan(lastWrite)
  })
  it('传播助手递归更新装甲/外观模型（含子节点的 matrixWorld）', () => {
    expect(kernel).toMatch(/function updateCollisionWorldMatrices\(\) \{[\s\S]*?models\.armorModel\?\.updateWorldMatrix\(true, true\);[\s\S]*?models\.tankModel\?\.updateWorldMatrix\(true, true\);/)
  })
})

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

// 间隙甲双面判定（2026-10-28 用户裁定）：间隙屏从背面命中同样参与判定；闭合间隙甲
// 正/背面是同一块板，只计一层（否则重复消耗厚度）。显示/采样材质是 FrontSide，求交
// 时临时切 DoubleSide，同步求交后立即恢复。
describe('spaced armor double-sided judgment', () => {
  const kernel = [read('../scene/tankViewer.js'), read('../scene/viewer/turretRig.ts'), read('../scene/viewer/modelLifecycle.ts'), read('../scene/viewer/heatmap.ts'), read('../scene/viewer/judgment.ts'), read('../scene/viewer/trajectoryCard.ts'), read('../scene/viewer/diagnosticProbe.ts'), read('../scene/viewer/shotReplay.ts'), read('../scene/viewer/shotReplayMiss.ts'), read('../scene/viewer/debugUi.ts'), read('../scene/viewer/equipmentState.ts'), read('../scene/viewer/collisionView.ts'), read('../scene/viewer/viewerMath.ts'), read('../scene/viewer/dataLoader.ts'), read('../scene/viewer/aimInput.ts')].join('\n')
  it('求交前把间隙甲材质临时切成 DoubleSide，并在 finally 恢复', () => {
    expect(kernel).toMatch(/function intersectArmorDoubleSidedSpaced\(objects: THREE\.Object3D\[\], caster: THREE\.Raycaster\): THREE\.Intersection\[\]/)
    expect(kernel).toMatch(/node\.userData\.armorSection !== 'spaced'/)
    expect(kernel).toMatch(/m\.side = THREE\.DoubleSide/)
    expect(kernel).toMatch(/finally \{\s*\n\s*for \(const \[m, side\] of saved\) m\.side = side;/)
  })
  it('同板去重判据委托 armorMeshTopology.resolveSpacedHitMask（语义由纯函数单测锁定）', () => {
    expect(kernel).toMatch(/function collectJudgmentHits\(intersects: THREE\.Intersection\[\], rayDir: THREE\.Vector3, minDistance = 0\)/)
    expect(kernel).toMatch(/const origSection = entry\.object\?\.userData\?\.armorSectionOrig \|\| entry\.section \|\| '';/)
    expect(kernel).toMatch(/import \{ resolveSpacedHitMask, spacedDedupKey, firstPhysicalHit \} from '\.\.\/armorMeshTopology\.js'/)
    // HEAT 间距原点必须来自 Node 可直接加载的 penetration.js（Node 不解析 .js → .ts）
    expect(kernel).toMatch(/import \{ isPrimary, hasPrimaryLayer, matchHitsByOccurrence, ricochetSurface, withContactRicochet, withGapOrigin \} from '\.\.\/penetration\.js'/)
    expect(kernel).toMatch(/key: spacedDedupKey\(origSection, entry\.section, entry\.plateId\)/)
    expect(kernel).toMatch(/const keep = resolveSpacedHitMask\(candidates, spanEnd\);/)
  })
  it('点击主链与跳弹续飞共用同一双面求交/收集', () => {
    expect(kernel).toMatch(/const intersects = intersectArmorDoubleSidedSpaced\(objects, getRaycaster\(\)\);/)
    expect(kernel).toMatch(/const \{ hits: armorHits, firstContact \} = collectJudgmentHits\(intersects, getRaycaster\(\)\.ray\.direction\);/)
    expect(kernel).toMatch(/const ricIntersects = intersectArmorDoubleSidedSpaced\(objects, rc\);/)
    expect(kernel).toMatch(/const ricCollect = collectJudgmentHits\(ricIntersects, rc\.ray\.direction, RC\.MIN_CONTINUATION_T\);/)
  })
})

// 换车/换弹的状态归属：URL 是 owner，viewer 的恢复输入不能停留在初始化快照；
// 选车器换车不写 route，编辑器/HUD 就绪标志必须按当前车重置。
describe('armor shell and readiness ownership', () => {
  const kernel = [read('../scene/tankViewer.js'), read('../scene/viewer/turretRig.ts'), read('../scene/viewer/modelLifecycle.ts'), read('../scene/viewer/heatmap.ts'), read('../scene/viewer/judgment.ts'), read('../scene/viewer/trajectoryCard.ts'), read('../scene/viewer/diagnosticProbe.ts'), read('../scene/viewer/shotReplay.ts'), read('../scene/viewer/shotReplayMiss.ts'), read('../scene/viewer/debugUi.ts'), read('../scene/viewer/equipmentState.ts'), read('../scene/viewer/collisionView.ts'), read('../scene/viewer/viewerMath.ts'), read('../scene/viewer/dataLoader.ts'), read('../scene/viewer/aimInput.ts')].join('\n')
  const view = [read('./AgentArmorView.vue'), read('./agent-armor/ArmorToolsPanel.vue'), read('./agent-armor/ArmorSideCard.vue'), read('./agent-armor/useArmorSetupQuery.ts'), read('./agent-armor/useArmorShotPage.ts'), read('./agent-armor/useArmorPitchAvailability.ts'), read('./agent-armor/armorViewerLabels.ts'), read('./agent-armor-view.css'), read('./agent-armor-view-responsive.css'), read('./agent-armor-view-hud-responsive.css')].join('\n')
  it('换目标后从当前 URL 恢复 shell，setShell 不再保留旧 QP 快照', () => {
    expect(kernel).toMatch(/function requestedShellIndex\(\)/)
    expect(kernel).toMatch(/populateShellSelector\(shooterShells, requestedShellIndex\(\)\)/)
    expect(kernel).toMatch(/QP\.set\('shell', String\(i\)\);/)
  })
  it('选车器换车时重置编辑器/HUD 就绪标志，HUD 不再套用受击方 config', () => {
    expect(view).toMatch(/watch\(shooterSetupId, \(\) => \{ shooterReady\.value = false; hudReady\.value = false \}\)/)
    expect(view).toMatch(/watch\(targetSetupId, \(\) => \{ targetReady\.value = false \}\)/)
    expect(view).toMatch(/@shooter-ready="value => shooterReady = value"/)
    expect(view).toMatch(/@target-ready="value => targetReady = value"/)
    expect(read('./ArmorSideConfig.vue')).toMatch(/const canConfigure = computed\(\(\) => selection\.value\?\.canConfigure === true\)/)
    expect(read('./ArmorSideConfig.vue')).toMatch(/watch\(canConfigure, value => \{ emit\('ready', value\) \}, \{ immediate: true \}\)/)
    const hud = view.match(/<ArmorShotHud[\s\S]*?\/>/)[0]
    expect(hud).not.toContain(':config=')
  })
  it('原生回退控件把选择写回 URL，避免 HUD 与场景各用一套状态', () => {
    expect(kernel).toMatch(/onConfigSelection\?\.\(idx\)/)
    expect(kernel).toMatch(/onShellSelection\?\.\(idx\)/)
    expect(kernel).toMatch(/onEquipmentSelection\?\.\('calibrated', this\.checked\)/)
    expect(kernel).toMatch(/equipmentOverride\.calibrated = null;\s*\n\s*refreshEquipmentEffects\(\);/)
    expect(kernel).toMatch(/equipmentOverride\.enhanced = null;\s*\n\s*refreshEquipmentEffects\(\);/)
    expect(kernel).toMatch(/if \(initialCal && eqs\.equipmentOverride\.calibrated != null\) initialCal\.checked = eqs\.equipmentOverride\.calibrated;/)
    expect(kernel).toMatch(/cal\.checked = equipmentOverride\.calibrated \?\? !!s\.shooter_equipment\.calibrated_shells;/)
    expect(kernel).toMatch(/enh\.checked = equipmentOverride\.enhanced \?\? !!s\.target_equipment\.enhanced_armor;/)
    expect(view).toMatch(/function syncNativeTargetConfig\(index: number \| string\)/)
    expect(view).toMatch(/function syncNativeShell\(index: number \| string\)/)
    expect(view).toMatch(/function syncNativeEquipment\(kind: string, value: boolean\)/)
    expect(view).toMatch(/onConfigSelection: index => syncNativeTargetConfig\(index\)/)
    expect(view).toMatch(/onShellSelection: index => syncNativeShell\(index\)/)
    expect(view).toMatch(/onEquipmentSelection: \(kind, value\) => syncNativeEquipment\(kind, value\)/)
  })
  it('空 scfg 视同缺省，射击方配置不再回落受击方 config', () => {
    expect(view).toMatch(/const scfg = route\.query\.scfg\s*\n\s*return scfg != null && scfg !== ''/)
  })
  it('射击方配置独立：不回落受击方 config，双方同车型也不共享主炮配置', () => {
    expect(view).toMatch(/return scfg != null && scfg !== '' \? scfg : null/)
    expect(view).not.toMatch(/sameTankInspection/)
    expect(view).not.toMatch(/shooterConfigValue[^\n]*route\.query\.config/)
  })
  it('HUD readiness 双向跟随弹表，切到无弹表配置交还原生控件', () => {
    expect(read('./ArmorShotHud.vue')).toMatch(/const hasShells = computed\(\(\) => shells\.value\.length > 0\)/)
    expect(read('./ArmorShotHud.vue')).toMatch(/watch\(hasShells, value => \{ emit\('ready', value\) \}/)
    expect(read('./AgentArmorView.vue')).toMatch(/@ready="value => hudReady = value"/)
  })
  it('HUD 只加载 devices 轻目录，不拉整份配置器目录', () => {
    const hud = read('./ArmorShotHud.vue')
    expect(hud).toMatch(/loadDevices\(\)/)
    expect(hud).not.toMatch(/loadResearchCatalog/)
  })
  it('普通检视换射手/换炮清掉上一发结果与 HE 可视化', () => {
    expect(kernel).toMatch(/if \(!QP\.get\('shot'\)\) \{\s*tcRef\(\)\.tidyTrajectory\(\);[\s\S]*?jcRef\(\)\.clearLastClickNdc\(\);/)
  })
  it('射击复现换装备/换配置沿权威 launch/lvDir 重跑', () => {
    expect(kernel).toMatch(/function rerunAuthoritativeShotCheck\(\)/)
    expect(kernel).toMatch(/if \(!rerunAuthoritativeShotCheck\(\)\) jc\.doPenetrationCheck\(0, 0\);/)
    // 普通检视换装备同样清掉旧结果
    expect(kernel).toMatch(/else if \(jc\.getLastClickNdc\(\) \|\| hm\.getHeHeatmapCenter\(\)\) \{[\s\S]*?tc\.tidyTrajectory\(\);/)
  })
  it('目标配置切换清空旧结果并使在途判定失效', () => {
    expect(kernel).toMatch(/if \(!QP\.get\('shot'\)\) \{\s*jcRef\(\)\.bumpPenSeq\(\);\s*tcRef\(\)\.tidyTrajectory\(\);[\s\S]*?jcRef\(\)\.clearLastClickNdc\(\);\s*\} else \{\s*rerunAuthoritativeShotCheckFn\(\);/)
  })
  it('射手数据未就绪时排队换炮，不拿上一辆车的 shooterData 重载', () => {
    expect(kernel).toMatch(/let pendingShooterConfig(?:: [A-Za-z]+ \| null)? = null;/)
    expect(kernel).toMatch(/dl\.setPendingShooterConfig\(\{ tankId: dl\.getCurrentShooterId\(\), index: idx \}\);/)
    expect(kernel).toMatch(/pendingShooterConfig\.tankId === tid && pendingShooterConfig\.tankId === currentShooterId/)
  })
  it('只重建场景时保留已挂载子组件的 readiness', () => {
    expect(view).not.toMatch(/requestSeq\+\+;\s*\n\s*shooterReady\.value = false;/)
    expect(view).not.toMatch(/requestSeq\+\+;\s*\n\s*hudReady\.value = false;/)
  })
  it('只换射手发动机/履带不凭空建立 scfg；换炮才写 scfg', () => {
    expect(view).toMatch(/if \(configChanged\) put\('scfg', patch\.config\)/)
    expect(view).not.toMatch(/hadExplicitShooterConfig/)
  })
  it('HUD 就绪即独占被替换的装备控件；配置变更按解析后的选择判断', () => {
    expect(view).toMatch(/'has-shot-hud': hudReady/)
    expect(view).toMatch(/\.armor-view #tank-selectors\.has-shot-hud \.eq-opt:not\(#armor-state-opt\)/)
    expect(view).toMatch(/const configChanged = patch\.configChanged === true/)
    expect(read('./ArmorSideConfig.vue')).toMatch(/configChanged: next\.config !== sel\.config/)
    // 旧车的模块请求失败/迟到不得改写新车的 modules 与 ready 状态
    expect(read('./ArmorSideConfig.vue')).toMatch(/\} catch \{\s*if \(seq !== request\) return\s*modules\.value = null\s*\}/)
  })
})

// 间隙甲渲染：additive 层按网格拓扑选面——闭合网格单面累计（正/背两表面只算一次）；
// 开放面片拆 front/back 双 clone + stencil 去重（同键入射面计一次、出射面抑制，
// 与点击链 resolveSpacedHitMask 同口径：按整条射线判定，与穿越顺序无关）；背面片元
// 把法线翻向相机（与 classifyHit 同口径）。
// 本 describe 只保留**既有**的材质状态接线断言；同板去重的真实行为（stencil 抑制、
// 背面屏等效厚度、resize 后仍带 stencil 附件）由 browser gate
// `test:browser-armor-spaced-backside` 以真实 GPU readback 验证，不用源码正则冒充
//（source guard 只锁 dependency/API ownership）。
describe('spaced armor surface selection', () => {
  const shaders = [read('../scene/viewer/armorShaders.ts'), read('../scene/viewer/armorPrimaryShader.ts')].join('\n')
  const kernel = [read('../scene/tankViewer.js'), read('../scene/viewer/turretRig.ts'), read('../scene/viewer/modelLifecycle.ts'), read('../scene/viewer/heatmap.ts'), read('../scene/viewer/judgment.ts'), read('../scene/viewer/trajectoryCard.ts'), read('../scene/viewer/diagnosticProbe.ts'), read('../scene/viewer/shotReplay.ts'), read('../scene/viewer/shotReplayMiss.ts'), read('../scene/viewer/debugUi.ts'), read('../scene/viewer/equipmentState.ts'), read('../scene/viewer/collisionView.ts'), read('../scene/viewer/viewerMath.ts'), read('../scene/viewer/dataLoader.ts'), read('../scene/viewer/aimInput.ts')].join('\n')
  it('间隙甲材质/状态材质/深度占位的既有渲染状态', () => {
    expect(shaders).toMatch(/function spacedMaterial\(thickness: number, penetration: number \| null \| undefined, side: Side\): ShaderMaterial \{/)
    expect(shaders).toMatch(/side,\s*\n\s*uniforms:/)
    expect(shaders).toMatch(/depthWrite: true, depthTest: true, blending: THREE\.NoBlending,\s*\n\s*side: THREE\.DoubleSide,/)
    expect(kernel).toMatch(/colorWrite: false, depthTest: true, depthWrite: true, side: THREE\.DoubleSide,/)
    expect(plateModel).toMatch(/addClone\(scene, node, mats\.spacedOmit, 5\)/)
  })
  it('间隙甲片元着色器按 gl_FrontFacing 翻转法线（PBR/间隙/状态三处）', () => {
    const flips = [...shaders.matchAll(/if \(!gl_FrontFacing\) nFace = -nFace;/g)]
    expect(flips).toHaveLength(3)
  })
  it('厚度视图间隙甲材质 DoubleSide，主装甲保持 FrontSide', () => {
    expect(kernel).toMatch(/side: node\.userData\.armorSection === 'spaced' \? THREE\.DoubleSide : THREE\.FrontSide,/)
  })
})

// 选车器的外层键盘 trap 与二级模态层（手机筛选 AppSheet，portal 到 body）的隔离：
// 按键发生在 #tank-picker 之外的 dialog 内时，外层不得介入（否则 Esc 会连带关闭整个选车器、Tab 被拉回外层）。
describe('tank picker keyboard isolation from nested modal layers', () => {
  const template = [read('./AgentArmorView.vue'), read('./agent-armor/ArmorToolsPanel.vue'), read('./agent-armor/ArmorSideCard.vue'), read('./agent-armor/useArmorSetupQuery.ts'), read('./agent-armor/useArmorShotPage.ts'), read('./agent-armor/useArmorPitchAvailability.ts'), read('./agent-armor/armorViewerLabels.ts'), read('./agent-armor-view.css'), read('./agent-armor-view-responsive.css'), read('./agent-armor-view-hud-responsive.css')].join('\n')
  it('onPickerKeydown 在 #tank-picker 之外的 dialog 内直接放行', () => {
    const start = template.indexOf('function onPickerKeydown(event)')
    expect(start).toBeGreaterThan(-1)
    const body = template.slice(start, template.indexOf('onMounted(', start))
    const guard = body.indexOf("closest('[role=\"dialog\"]')")
    const escape = body.indexOf("event.key === 'Escape'")
    expect(guard, '二级模态放行判定').toBeGreaterThan(-1)
    expect(guard, '必须先于 Escape / Tab 处理').toBeLessThan(escape)
    expect(body).toContain("layer.id !== 'tank-picker'")
  })
})

// 回放装备真值只属于射击记录的目标车：目标被选车器换掉后，场景内核不得继续把
// 原目标的 122 当成当前车装备（否则 HUD 仍亮、拖炮仍加 4°/3°）。
describe('122 装备真值的目标身份（场景内核）', () => {
  const kernel = [read('../scene/tankViewer.js'), read('../scene/viewer/turretRig.ts'), read('../scene/viewer/modelLifecycle.ts'), read('../scene/viewer/heatmap.ts'), read('../scene/viewer/judgment.ts'), read('../scene/viewer/trajectoryCard.ts'), read('../scene/viewer/diagnosticProbe.ts'), read('../scene/viewer/shotReplay.ts'), read('../scene/viewer/shotReplayMiss.ts'), read('../scene/viewer/debugUi.ts'), read('../scene/viewer/equipmentState.ts'), read('../scene/viewer/collisionView.ts'), read('../scene/viewer/viewerMath.ts'), read('../scene/viewer/dataLoader.ts'), read('../scene/viewer/aimInput.ts')].join('\n')
  it('瞄准/判定上下文按当前目标过滤回放装备真值', () => {
    expect(kernel).toMatch(/function shotEquipmentCtx\(\)[\s\S]*?recordedTargetMatchesShot\(ctx\.shot, getCurrentTargetId\(\)\)/)
    expect(kernel).toMatch(/const recorded = recordedTargetMatchesShot\(s, getCurrentTargetId\(\)\) \? \(s\.target_equipment \|\| null\) : null/)
  })
  it('换目标后原生勾选回到手动且不保留上一辆车的勾选态', () => {
    // 判据走 tankSetup 纯函数（override ?? recorded ?? false；recorded 缺失 ⇒ override ?? false，
    // 与旧字面量行为等价，单测覆盖 null 分支）。这里锁住「回退态由共享判据决定且非录制分支解除禁用」。
    expect(kernel).toContain('resolvePitchCheckboxChecked({ override: equipmentOverride.pitch')
    const start = Math.max(
      kernel.lastIndexOf("const pit = document.getElementById('eq-pitch-device');"),
      kernel.lastIndexOf("const pit = inputEl('eq-pitch-device');"),
    )
    const body = kernel.slice(start, start + 900)
    expect(body).toContain('pit.disabled = false')
    expect(body).toContain("pit.title = ''")
  })
})

describe('122 装备徽标走 labels 边界（i18n 守卫）', () => {
  const template = [read('./AgentArmorView.vue'), read('./agent-armor/ArmorToolsPanel.vue'), read('./agent-armor/ArmorSideCard.vue'), read('./agent-armor/useArmorSetupQuery.ts'), read('./agent-armor/useArmorShotPage.ts'), read('./agent-armor/useArmorPitchAvailability.ts'), read('./agent-armor/armorViewerLabels.ts'), read('./agent-armor-view.css'), read('./agent-armor-view-responsive.css'), read('./agent-armor-view-hud-responsive.css')].join('\n')
  const kernel = [read('../scene/tankViewer.js'), read('../scene/viewer/turretRig.ts'), read('../scene/viewer/modelLifecycle.ts'), read('../scene/viewer/heatmap.ts'), read('../scene/viewer/judgment.ts'), read('../scene/viewer/trajectoryCard.ts'), read('../scene/viewer/diagnosticProbe.ts'), read('../scene/viewer/shotReplay.ts'), read('../scene/viewer/shotReplayMiss.ts'), read('../scene/viewer/debugUi.ts'), read('../scene/viewer/equipmentState.ts'), read('../scene/viewer/collisionView.ts'), read('../scene/viewer/viewerMath.ts'), read('../scene/viewer/dataLoader.ts'), read('../scene/viewer/aimInput.ts')].join('\n')

  it('eqBadge 不得硬编码文案：俯仰徽标使用 L.pitchDevice', () => {
    const start = kernel.indexOf('function eqBadge(')
    const body = kernel.slice(start, start + 600)
    expect(body).toContain('L.pitchDevice')
    // 中文徽标字面量不得回到内核（注释里出现「改进型垂直稳定器」不算 UI 文案）
    expect(body).not.toMatch(/>[^<]*稳定器/)
  })

  it('宿主经 initTankViewer 的 labels 传三语 pitchDevice', () => {
    expect(template).toContain("pitchDevice: t('armor.pitch_device')")
    expect(kernel).toContain("pitchDevice: 'Improved Vertical Stabilizer'")
  })

  it('勾选框回放判定 tooltip 不得硬编码：走 L.replayEquipmentAutoTitle', () => {
    const start = kernel.indexOf('function syncEquipmentCheckboxes(')
    const body = kernel.slice(start, start + 1600)
    expect(body).toContain('L.replayEquipmentAutoTitle')
    expect(body).not.toContain('回放自动判定')
    expect(template).toContain("replayEquipmentAutoTitle: t('armor.equipment_auto')")
    expect(kernel).toContain("replayEquipmentAutoTitle: 'Replay-detected (Type5 equipment)'")
  })
})
