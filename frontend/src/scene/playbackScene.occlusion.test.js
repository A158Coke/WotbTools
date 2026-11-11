// @vitest-environment happy-dom
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { occlusionCells, occlusionFootprintCells } from './playback/pure.js'

describe('occlusionCells（标签遮挡候选格：线段经过的 16m 格）', () => {
  it('同一格内的短线段 → 单格；跨格 → 首尾格都在集合里', () => {
    expect([...occlusionCells(2, 2, 6, 6, 16)]).toEqual(['0,0'])
    const c = [...occlusionCells(5, 5, 40, 5, 16)]
    expect(c).toContain('0,0')   // 起点格
    expect(c).toContain('2,0')   // 终点格（40/16 = 2）
    expect(c.length).toBeGreaterThanOrEqual(3)
  })

  it('负坐标与轴向线段：只占一行/一列格（不撒满平面）', () => {
    const c = [...occlusionCells(-20, -20, -20, 20, 16)]
    expect(c.every((k) => k.endsWith(',-2') || k.endsWith(',-1') || k.endsWith(',1') || k.endsWith(',0'))).toBe(true)
    expect(new Set(c.map((k) => k.split(',')[0])).size).toBe(1)   // x 恒为 -2
  })

  it('采样步长 ≤ 半格：长线段不漏格（相邻格键在 x 或 y 上连续）', () => {
    const c = [...occlusionCells(0, 0, 160, 0, 16)]
    expect(c.length).toBeGreaterThanOrEqual(11)        // 0..10 格
    expect(c).toContain('10,0')
  })
})

describe('occlusionFootprintCells（occGrid 登记：足印 AABB 全枚举）', () => {
  it('格内小遮挡物 → 单格；跨格大建筑 → 矩形全枚举（含非对角线格）', () => {
    expect(occlusionFootprintCells(2, 2, 6, 6, 16)).toEqual(['0,0'])
    const c = occlusionFootprintCells(0, 0, 40, 40, 16)   // 40m 建筑 → 0..2 × 0..2
    expect(c).toHaveLength(9)
    expect(c).toContain('0,1')
    expect(c).toContain('2,1')
  })

  it('评审 P0 回归：大遮挡物跨多格时，非对角线覆盖格必须在表内（线段遍历登记会漏）', () => {
    // 40m 建筑足印 0..40；格子 (0,1)（足印西北角）不在包围盒对角线上——
    // 旧实现用线段 DDA 登记只采样对角线，穿 (0,1) 的相机→标签射线查不到该遮挡物
    const diag = occlusionCells(0, 0, 40, 40, 16)
    const fp = occlusionFootprintCells(0, 0, 40, 40, 16)
    expect(fp).toContain('0,1')
    expect(diag.has('0,1')).toBe(false)
    expect(fp.length).toBeGreaterThan(diag.size)
  })

  it('负坐标单格；病态大包围球每轴钳 64 格', () => {
    expect(occlusionFootprintCells(-20, -20, -17, -17, 16)).toEqual(['-2,-2'])
    expect(occlusionFootprintCells(-1e6, -1e6, 1e6, 1e6, 16)).toHaveLength(64 * 64)
  })
})

describe('场景源码护栏：评审 P0 修复的接线锁定', () => {
  const src = readFileSync(resolve(__dirname, 'playbackScene.js'), 'utf8')
  // 候选表登记随场景装配块 2026-10-24 出仓 playback/mapAssets.js（Step A3），守卫随实现迁移
  const mapAssetsSrc = readFileSync(resolve(__dirname, 'playback/mapAssets.ts'), 'utf8')
  it('时间轴回退必须显式清树终态 settled（否则重播不重写触地旋转）', () => {
    // #820 Step 2：updateDestructibles owner = playback/mapWorld.ts
    const mapWorldSrc = readFileSync(resolve(__dirname, 'playback/mapWorld.ts'), 'utf8')
    expect(mapWorldSrc).toMatch(/if \(T < destruct\.lastT\) \{[\s\S]{0,80}destruct\.ptr = 0;[\s\S]{0,400}st\.prop === 3\) st\.settled = false;[\s\S]{0,40}\}\s*destruct\.lastT = T;/)
  })
})

describe('Sniper 穿深着色接线', () => {
  const source = readFileSync(resolve(__dirname, 'playbackScene.js'), 'utf8')
  // #820 Step 4：录像者相机/穿深着色 owner = playback/cameraRuntime.ts（守卫随实现迁移）
  const cameraSrc = readFileSync(resolve(__dirname, 'playback/cameraRuntime.ts'), 'utf8').replace(/\/\/[^\n]*/g, '')

  it('叠加 pass 排在主渲染之后，只有录像者开镜且过渡结束才运行', () => {
    const draw = source.indexOf('renderer.render(scene, camera);')
    const armor = source.indexOf('renderArmorHighlight();', draw)
    expect(draw).toBeGreaterThan(-1)
    expect(armor).toBeGreaterThan(draw)
    expect(cameraSrc).toContain("if (!deps.armorHighlightPref() || CAM !== 'recorder' || !scopedHiddenEid || cameraBlend) return;")
  })

  it('选目标与准星同源（Type39 瞄准点），不取相机正前方', () => {
    const start = cameraSrc.indexOf('function renderArmorHighlight')
    const body = cameraSrc.slice(start, cameraSrc.indexOf('回到俯视机位', start))
    expect(body).toContain('reticleAimDirection(camera, recorderAimPoint(recorderSample')
    expect(body).not.toContain('getWorldDirection')
    expect(cameraSrc).toContain('recorderAimPoint(sample, _recorderRay)')
  })

  it('悬挂改写履带顶点后只打标记，不在主路径重算或置空 bounds', () => {
    // #820 Step 2：suspensionStep owner = playback/vehicleRuntime.ts
    const vehicleSrc = readFileSync(resolve(__dirname, 'playback/vehicleRuntime.ts'), 'utf8')
    expect(vehicleSrc).toMatch(/gp\.posAttr\.needsUpdate = true;\s+markPickBoundsStale\(gp\.mesh\.geometry\);/)
    const start = vehicleSrc.indexOf('function suspensionStep')
    const body = vehicleSrc.slice(start, vehicleSrc.indexOf('function ', start + 'function suspensionStep'.length))
    expect(body).not.toMatch(/computeBounding|bounding\(Box|Sphere\) = null/)
  })

  it('着色默认关闭，?armorhl=1 可打开', () => {
    expect(source).toContain("prefOf('pb_armor_highlight', 'armorhl', false)")
  })

  it('配置解析不走带回退的 resolveMountedConfig', () => {
    const start = cameraSrc.indexOf('function renderArmorHighlight')
    const body = cameraSrc.slice(start, cameraSrc.indexOf('回到俯视机位', start))
    expect(body).toContain('resolveExactMountedConfig')
    expect(body).not.toMatch(/resolveMountedConfig\(/)
  })

  it('SNIPER→ARCADE 转换释放 RT（不只退出录像者模式）', () => {
    const start = cameraSrc.indexOf('function driveRecorderCamera')
    const body = cameraSrc.slice(start, cameraSrc.indexOf('function ', start + 20))
    expect(body).toMatch(/wasScoped\s*&&\s*!scoped/)
    expect(body).toContain('armorHighlight?.releaseRenderTargets?.()')
  })

  it('关闭开关与退出录像者模式仍释放 RT', () => {
    const leaveStart = cameraSrc.indexOf('function leaveRecorderView')
    const leaveBody = cameraSrc.slice(leaveStart, cameraSrc.indexOf('function ', leaveStart + 20))
    expect(leaveBody).toContain('releaseRenderTargets')
    const setStart = source.indexOf('setArmorHighlight:')
    const setBody = source.slice(setStart, source.indexOf('setQuality', setStart))
    expect(setBody).toContain('releaseArmorHighlightRenderTargets')
  })

  it('遮挡剔除优先批次 AABB；可破坏物批次回退球', () => {
    const hl = readFileSync(resolve(__dirname, 'playback/armorHighlight.ts'), 'utf8')
    expect(hl).toMatch(/occluderBox.*applyMatrix4/)
    expect(hl).toMatch(/intersectsBox\(_occluderBox\)/)
    const inst = readFileSync(resolve(__dirname, 'sceneryInstancing.ts'), 'utf8')
    expect(inst).toMatch(/userData\.occluderBox = box/)
    const mapAssets = readFileSync(resolve(__dirname, 'playback/mapAssets.ts'), 'utf8')
    expect(mapAssets).toMatch(/mesh\.userData\.occluderBox = null/)
  })

  it('装甲 RT 按目标矩形分配：视口偏移相机 + spacedRect 采样映射（full → rect 局部）', () => {
    const hl = readFileSync(resolve(__dirname, 'playback/armorHighlight.ts'), 'utf8')
    expect(hl).toMatch(/armorCamera\.setViewOffset\(size\.x, size\.y, scissor\.x, size\.y - \(scissor\.y \+ scissor\.w\), scissor\.z, scissor\.w\)/)
    expect(hl).toMatch(/bucketedRtSize\(scissor\.z, size\.x\)/)
    expect(hl).toMatch(/bindBuffers\(target, camera, spacedRect\)/)
    const shaders = readFileSync(resolve(__dirname, 'viewer/armorShaders.ts'), 'utf8')
    expect(shaders).toMatch(/uniform vec4 spacedRect/)
    // review R1 blocker：全画面 UV → **rect 局部** RT UV（rect 左下 → (0,0)，右上 → (1,1)）；
    // 反向公式（sc*zw+xy）会让整车错误采样 RT 中央一小块
    expect(shaders).toMatch(/\(sc - spacedRect\.xy\) \/ spacedRect\.zw/)
    expect(shaders).not.toMatch(/sc \* spacedRect\.zw \+ spacedRect\.xy/)
    expect(shaders).toMatch(/spacedRect: \{ value: new THREE\.Vector4\(0, 0, 1, 1\) \}/)
  })

  it('?perf 逐 pass 计时与装甲预热接线', () => {
    expect(source).toMatch(/perfFrame\([^\n]*armorStats/)
    expect(cameraSrc).toMatch(/stats: PERF \? armorStats : undefined/)
    const hl = readFileSync(resolve(__dirname, 'playback/armorHighlight.ts'), 'utf8')
    expect(hl).toMatch(/function prewarm\(camera: PerspectiveCamera\)/)
    expect(cameraSrc).toMatch(/\.prewarm\(camera\)/)
  })

  it('遮挡 pass 用语义化遮挡根，不再全场景 traverseVisible（issue #850 F）', () => {
    const start = cameraSrc.indexOf('function occluderRoots')
    const body = cameraSrc.slice(start, cameraSrc.indexOf('function ', start + 20))
    // 地形/场景 GLB/占位地面 + 每车低模组、GLB、飞炮塔
    expect(body).toMatch(/deps\.mapWorld\.terrainMesh\(\), deps\.mapWorld\.mapScenery\(\), deps\.mapWorld\.mapPlane\(\), deps\.mapWorld\.groundMesh\(\)/)
    expect(body).toContain('v.glb')
    expect(body).toContain('detachedTurrets')
    // v.glb 是 v.group 的场景级兄弟，两者都必须在根清单里
    expect(body).toContain('v.group')
    expect(cameraSrc).toMatch(/occluderRoots: occluderRoots\(target\.def\.eid as number\)/)
    const hl = readFileSync(resolve(__dirname, 'playback/armorHighlight.ts'), 'utf8')
    expect(hl).toMatch(/function markOccluders\(camera: PerspectiveCamera, vehicle: ArmorHighlightFrame\['vehicle'\], view: OccluderView, roots: Object3D\[\]\): number/)
    expect(hl).toMatch(/for \(const root of roots\)/)
    expect(hl).toMatch(/frame\.occluderRoots \?\? \[scene\]/)
  })

  it('SNIPER 进入时补预取敌方 armor 模板（tankData 晚到缺口）', () => {
    const start = cameraSrc.indexOf('function driveRecorderCamera')
    const body = cameraSrc.slice(start, cameraSrc.indexOf('function ', start + 20))
    expect(body).toMatch(/scoped && !wasScoped && deps\.armorHighlightPref\(\)\)\s+prewarmArmorHighlight\(camera\)/)
  })

  it('零遮挡快速路径：走廊内无遮挡物时跳过世界深度重绘', () => {
    const hl = readFileSync(resolve(__dirname, 'playback/armorHighlight.ts'), 'utf8')
    expect(hl).toMatch(/let count = 0/)
    expect(hl).toMatch(/object\.layers\.enable\(OCCLUDER_LAYER\)\s*\n\s*count\+\+/)
    expect(hl).toMatch(/const count = markOccluders\(camera, vehicle, view, roots\)/)
    expect(hl).toMatch(/if \(count === 0\) return/)
  })

  it('RT 收缩滞回：需求持续减半才重建，防近距全尺寸 RT 挂满会话', () => {
    const hl = readFileSync(resolve(__dirname, 'playback/armorHighlight.ts'), 'utf8')
    expect(hl).toMatch(/let rtShrinkStreak = 0/)
    expect(hl).toMatch(/rtW \* rtH \* 4 <= stateRT\.width \* stateRT\.height/)
    expect(hl).toMatch(/\+\+rtShrinkStreak >= 90/)
    expect(hl).toMatch(/releaseRenderTargets\(\): void \{\s*disposeTargets\(\)\s*rtShrinkStreak = 0\s*\}/)
  })
})
