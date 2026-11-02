// @vitest-environment happy-dom
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { occlusionCells, occlusionFootprintCells } from './playbackScene.js'

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

describe('标签遮挡：只对候选格做 raycast（禁止整场景递归检测）', () => {
  const src = readFileSync(resolve(__dirname, 'playbackScene.js'), 'utf8')
  // 候选表登记随场景装配块 2026-10-24 出仓 playback/mapAssets.js（Step A3），守卫随实现迁移
  const mapAssetsSrc = readFileSync(resolve(__dirname, 'playback/mapAssets.js'), 'utf8')
  it('源码护栏：不再对 mapScenery 全量 intersectObject，改用候选列表 intersectObjects', () => {
    expect(src).not.toMatch(/intersectObject\(mapScenery, true\)/)
    expect(src).toMatch(/raycaster\.intersectObjects\(cands, false\)/)
    expect(src).toMatch(/OCCL_MAX_CANDIDATES/)
    // 候选表在场景加载时构建、换场时失效
    expect(mapAssetsSrc).toMatch(/occlGrid = occGrid;/)
    expect(src).toMatch(/occlGrid = null;/)
  })
  it('折线点表必须镜像 x（游戏系 → 场景系）——镜像丢失 = 轨迹画到地图对侧', () => {
    expect(src).toMatch(/pathPointsOf\(s\)\.map\(\(\[x, y, z\]\) => \[-x, y, z\]\)/)
    // 弹着点从镜像后的点表取（pts3[1] = via[0] 或终点），不得再读原始坐标
    expect(src).toMatch(/fromArray\(pts3\[1\]\)/)
    expect(src).not.toMatch(/fromArray\(\(s\.via && s\.via\.length\) \? s\.via\[0\] : s\.to\)/)
  })

  it('updateTracers 完成判定用 T >= tr.t1（禁止再引用已删除的旧变量 f）', () => {
    // 回归：折线改造曾把推进公式换成折线求值，却留下 `if (f >= 1)` —— f 未定义，
    // 每帧 ReferenceError 中断整个 tick（不渲染、炮线永不回收），即"播放中卡死、暂停即止"。
    expect(src).toMatch(/if \(T >= tr\.t1\) \{/)
    expect(src).not.toMatch(/f >= 1/)
    // 完成块必须仍然归还曳光条带；命中特效在抵达点时刻（legEnds[0]）生成，只生成一次
    expect(src).toMatch(/if \(T >= tr\.t1\) \{[\s\S]{0,220}battleFx\.giveRibbon\(tr\.mesh\);/)
    expect(src).toMatch(/if \(!tr\.hit && T >= tr\.legEnds\[0\]\) \{ tr\.hit = true; spawnImpact\(tr\); \}/)
  })

  it('开火 / 命中特效的炮口、来弹与跳弹出射方向都取自镜像后的点表（折线改造曾漏字段 → 整帧抛异常）', () => {
    // 炮口 = pts3[0]、抵达点 = pts3[1]、跳弹出射段 = pts3[2]（镜像后的场景系，不得再读原始坐标）
    expect(src).toMatch(/const from = new THREE\.Vector3\(\)\.fromArray\(pts3\[0\]\);/)
    expect(src).toMatch(/const dir = impactPos\.clone\(\)\.sub\(from\);/)
    expect(src).toMatch(/const out = pts3\.length > 2 \? new THREE\.Vector3\(\)\.fromArray\(pts3\[2\]\)\.sub\(impactPos\) : null;/)
    expect(src).toMatch(/battleFx\.spawnImpact\(kind, tr\.impactPos, tr\.dir, tr\.out,/)
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
  const mapAssetsSrc = readFileSync(resolve(__dirname, 'playback/mapAssets.js'), 'utf8')
  it('occGrid 登记必须用足印全枚举，不得用线段遍历', () => {
    expect(mapAssetsSrc).toMatch(/occlusionFootprintCells\(e\.x - r, e\.y - r, e\.x \+ r, e\.y \+ r, OCCL_CELL\)/)
    expect(src).not.toMatch(/occlusionCells\(wx - r/)
  })
  it('时间轴回退必须显式清树终态 settled（否则重播不重写触地旋转）', () => {
    expect(src).toMatch(/if \(T < destruct\.lastT\) \{[\s\S]{0,80}destruct\.ptr = 0;[\s\S]{0,400}st\.prop === 3\) st\.settled = false;[\s\S]{0,40}\}\s*destruct\.lastT = T;/)
  })
  it('?perf 看门狗随 destroy 清理（心跳定时器 + 调试句柄）', () => {
    expect(src).toMatch(/if \(PERF\) \{\s*if \(perfBeatTimer\) \{ clearInterval\(perfBeatTimer\); perfBeatTimer = 0; \}\s*delete window\.__pbPerf;/)
  })
})

describe('Sniper 穿深着色接线', () => {
  const source = readFileSync(resolve(__dirname, 'playbackScene.js'), 'utf8')

  it('叠加 pass 排在主渲染之后，只有录像者开镜且过渡结束才运行', () => {
    expect(source).toMatch(/renderer\.render\(scene, camera\);\s+(?:const perfR0[^\n]*\n\s+)?renderArmorHighlight\(\);/)
    expect(source).toContain("if (!ARMOR_HIGHLIGHT || CAM !== 'recorder' || !scopedHiddenEid || cameraBlend) return;")
  })

  it('选目标与准星同源（Type39 瞄准点），不取相机正前方', () => {
    const start = source.indexOf('function renderArmorHighlight')
    const body = source.slice(start, source.indexOf('回到俯视机位', start))
    expect(body).toContain('reticleAimDirection(camera, recorderAimPoint(recorderSample')
    expect(body).not.toContain('getWorldDirection')
    expect(source).toContain('recorderAimPoint(sample, _recorderRay)')
  })

  it('悬挂改写履带顶点后只打标记，不在主路径重算或置空 bounds', () => {
    expect(source).toMatch(/gp\.posAttr\.needsUpdate = true;\s+markPickBoundsStale\(gp\.mesh\.geometry\);/)
    const start = source.indexOf('function suspensionStep')
    const body = source.slice(start, source.indexOf('function ', start + 'function suspensionStep'.length))
    expect(body).not.toMatch(/computeBounding|bounding(Box|Sphere) = null/)
  })

  it('着色默认关闭，?armorhl=1 可打开', () => {
    expect(source).toContain("prefOf('pb_armor_highlight', 'armorhl', false)")
  })

  it('配置解析不走带回退的 resolveMountedConfig', () => {
    const start = source.indexOf('function renderArmorHighlight')
    const body = source.slice(start, source.indexOf('回到俯视机位', start))
    expect(body).toContain('resolveExactMountedConfig')
    expect(body).not.toMatch(/resolveMountedConfig\(/)
  })

  it('SNIPER→ARCADE 转换释放 RT（不只退出录像者模式）', () => {
    const start = source.indexOf('function driveRecorderCamera')
    const body = source.slice(start, source.indexOf('function ', start + 20))
    expect(body).toMatch(/wasScoped\s*&&\s*!scoped/)
    expect(body).toContain('armorHighlight?.releaseRenderTargets?.()')
  })

  it('关闭开关与退出录像者模式仍释放 RT', () => {
    const leaveStart = source.indexOf('function leaveRecorderView')
    const leaveBody = source.slice(leaveStart, source.indexOf('function ', leaveStart + 20))
    expect(leaveBody).toContain('releaseRenderTargets')
    const setStart = source.indexOf('setArmorHighlight:')
    const setBody = source.slice(setStart, source.indexOf('setQuality', setStart))
    expect(setBody).toContain('releaseRenderTargets')
  })

  it('遮挡剔除优先批次 AABB；可破坏物批次回退球', () => {
    const hl = readFileSync(resolve(__dirname, 'playback/armorHighlight.js'), 'utf8')
    expect(hl).toMatch(/const box = object\.userData\?\.occluderBox/)
    expect(hl).toMatch(/view\.frustum\.intersectsBox\(_occluderBox\)/)
    const inst = readFileSync(resolve(__dirname, 'sceneryInstancing.js'), 'utf8')
    expect(inst).toMatch(/userData\.occluderBox = box/)
    const mapAssets = readFileSync(resolve(__dirname, 'playback/mapAssets.js'), 'utf8')
    expect(mapAssets).toMatch(/mesh\.userData\.occluderBox = null/)
  })

  it('装甲 RT 按目标矩形分配：视口偏移相机 + spacedRect 采样映射', () => {
    const hl = readFileSync(resolve(__dirname, 'playback/armorHighlight.js'), 'utf8')
    expect(hl).toMatch(/armorCamera\.setViewOffset\(size\.x, size\.y, scissor\.x, size\.y - \(scissor\.y \+ scissor\.w\), scissor\.z, scissor\.w\)/)
    expect(hl).toMatch(/bucketedRtSize\(scissor\.z, size\.x\)/)
    expect(hl).toMatch(/bindBuffers\(target, camera, spacedRect\)/)
    const shaders = readFileSync(resolve(__dirname, 'viewer/armorShaders.js'), 'utf8')
    expect(shaders).toMatch(/uniform vec4 spacedRect/)
    expect(shaders).toMatch(/sc \* spacedRect\.zw \+ spacedRect\.xy/)
    expect(shaders).toMatch(/spacedRect: \{ value: new THREE\.Vector4\(0, 0, 1, 1\) \}/)
  })

  it('?perf 逐 pass 计时与装甲预热接线', () => {
    expect(source).toMatch(/perfFrame\(perfT1 - perfT0, perfR0 - perfT1, perfR1 - perfR0, armorStats\)/)
    expect(source).toMatch(/stats: PERF \? armorStats : null/)
    const hl = readFileSync(resolve(__dirname, 'playback/armorHighlight.js'), 'utf8')
    expect(hl).toMatch(/function prewarm\(camera\)/)
    expect(source).toMatch(/\.prewarm\(camera\)/)
  })

  it('遮挡 pass 用语义化遮挡根，不再全场景 traverseVisible（issue #850 F）', () => {
    const start = source.indexOf('function occluderRoots')
    const body = source.slice(start, source.indexOf('function ', start + 20))
    // 地形/场景 GLB/占位地面 + 每车低模组、GLB、飞炮塔
    expect(body).toMatch(/terrainMesh, mapScenery, mapPlane, groundMesh/)
    expect(body).toContain('v.glb')
    expect(body).toContain('detachedTurrets')
    // v.glb 是 v.group 的场景级兄弟，两者都必须在根清单里
    expect(body).toContain('v.group')
    expect(source).toMatch(/occluderRoots: occluderRoots\(\)/)
    const hl = readFileSync(resolve(__dirname, 'playback/armorHighlight.js'), 'utf8')
    expect(hl).toMatch(/function markOccluders\(camera, vehicle, view, roots\)/)
    expect(hl).toMatch(/for \(const root of roots\)/)
    expect(hl).toMatch(/frame\.occluderRoots \|\| \[scene\]/)
  })

  it('SNIPER 进入时补预取敌方 armor 模板（tankData 晚到缺口）', () => {
    const start = source.indexOf('function driveRecorderCamera')
    const body = source.slice(start, source.indexOf('function ', start + 20))
    expect(body).toMatch(/scoped && !wasScoped && ARMOR_HIGHLIGHT\)\s+ensureArmorHighlight\(\)\.prefetch\(highlightEnemies\(\)\)/)
  })

  it('零遮挡快速路径：走廊内无遮挡物时跳过世界深度重绘', () => {
    const hl = readFileSync(resolve(__dirname, 'playback/armorHighlight.js'), 'utf8')
    expect(hl).toMatch(/let count = 0/)
    expect(hl).toMatch(/object\.layers\.enable\(OCCLUDER_LAYER\)\s*\n\s*count\+\+/)
    expect(hl).toMatch(/const count = markOccluders\(camera, vehicle, view, roots\)/)
    expect(hl).toMatch(/if \(count === 0\) return/)
  })

  it('RT 收缩滞回：需求持续减半才重建，防近距全尺寸 RT 挂满会话', () => {
    const hl = readFileSync(resolve(__dirname, 'playback/armorHighlight.js'), 'utf8')
    expect(hl).toMatch(/let rtShrinkStreak = 0/)
    expect(hl).toMatch(/rtW \* rtH \* 4 <= stateRT\.width \* stateRT\.height/)
    expect(hl).toMatch(/\+\+rtShrinkStreak >= 90/)
    expect(hl).toMatch(/releaseRenderTargets\(\) \{\s*disposeTargets\(\)\s*rtShrinkStreak = 0\s*\}/)
  })
})
