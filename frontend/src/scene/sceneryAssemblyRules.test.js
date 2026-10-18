// 场景装配规则表（src/scene/sceneryAssemblyRules.js）纯函数单测：
// 水面语义（材质标记权威 / 旧包名字回退）、天空壳词表、非完好态名式、俯视烘焙剔除判定。
// 案例取 2026-10-14 事故普查的真名（水塔/探照灯/海面/浮冰），防名字启发式回归。
import { describe, it, expect } from 'vitest'
import {
  strictSurfacesOf, materialIsWater, isWaterNode, isSkyShellName,
  isNonIntactStateName, bakeDropNode, materialHasSky, materialAllSky, sceneHasSkyFlags, isSkyShell,
} from './sceneryAssemblyRules.js'
import { pruneForeignVariants } from './variantFilter.js'

const water = () => ({ userData: { water: { props: {} } } })
const sky = () => ({ userData: { sky: true } })
const plain = () => ({ userData: {} })

describe('sceneryAssemblyRules：水面语义（SSOT）', () => {
  it('strictSurfacesOf 只认 scene/asset extras 的 surfaceFlags', () => {
    expect(strictSurfacesOf({ userData: { surfaceFlags: 1 } })).toBe(true)
    expect(strictSurfacesOf({ userData: {} })).toBe(false)
    expect(strictSurfacesOf(null)).toBe(false)
  })

  it('materialIsWater 认单材质/材质数组（取首个）与布尔/对象两种标记形态', () => {
    expect(materialIsWater(water())).toBe(true)
    expect(materialIsWater([water(), plain()])).toBe(true)
    expect(materialIsWater([plain(), water()])).toBe(false)   // 数组取首个（GLTF 多材质网格）
    expect(materialIsWater({ userData: { water: true } })).toBe(true)
    expect(materialIsWater(plain())).toBe(false)
    expect(materialIsWater(undefined)).toBe(false)
  })

  it('isWaterNode：新包看标记（名字不算），旧包名字回退', () => {
    const strict = { strictSurfaces: true }
    const legacy = { strictSurfaces: false }
    // 新包：标记权威——名字像水的水塔**不是**水；名字不像水的海面**是**水
    expect(isWaterNode('bld_er_water_tower_pbr.sc2', plain(), strict)).toBe(false)
    expect(isWaterNode('skit_ocean.sc2', water(), strict)).toBe(true)
    expect(isWaterNode('env_ma_ice02_01', water(), strict)).toBe(true)
    // 旧包：名字启发式（历史口径，仅供旧包回退）
    expect(isWaterNode('bld_er_water_tower_pbr.sc2', plain(), legacy)).toBe(true)
    expect(isWaterNode('env_fountain_water.sc2', plain(), legacy)).toBe(true)
    expect(isWaterNode('skit_ocean.sc2', plain(), legacy)).toBe(false)
  })

  it('天空语义：材质 extras.sky 权威；旧包无标记才按名字', () => {
    expect(materialHasSky(sky())).toBe(true)
    expect(materialHasSky([plain(), sky()])).toBe(true)
    expect(materialHasSky(water())).toBe(false)
    const root = { children: [{ isMesh: true, material: plain(), children: [] }, { isMesh: true, material: sky(), children: [] }] }
    expect(sceneHasSkyFlags(root)).toBe(true)
    expect(sceneHasSkyFlags({ children: [{ isMesh: true, material: plain(), children: [] }] })).toBe(false)
    // 新包（有 sky 标记）：名字不含 sky 也按材质判；名字含 sky 但无标记不判
    expect(isSkyShell('bld_x.sc2', sky(), { strictSurfaces: true, skyFlagsAvailable: true })).toBe(true)
    expect(isSkyShell('sky_dome', plain(), { strictSurfaces: true, skyFlagsAvailable: true })).toBe(false)
    // 旧包：名字 fallback 保持
    expect(isSkyShell('sky_dome', plain(), { strictSurfaces: true, skyFlagsAvailable: false })).toBe(true)
    // 只要存在 sky 标记就认材质语义，与 surfaceFlags/strictSurfaces 无关
    expect(isSkyShell('bld_x.sc2', sky(), { skyFlagsAvailable: true })).toBe(true)
    expect(isSkyShell('sky_dome', plain(), { skyFlagsAvailable: true })).toBe(false)
    // 多材质网格：整组命中才走天空；混合组 fail-closed 当普通网格（不投无限远/不整件剔除）
    expect(materialAllSky([sky(), sky()])).toBe(true)
    expect(materialAllSky([sky(), plain()])).toBe(false)
    expect(isSkyShell('mixed', [sky(), plain()], { skyFlagsAvailable: true })).toBe(false)
    expect(isSkyShell('all', [sky(), sky()], { skyFlagsAvailable: true })).toBe(true)
  })

  it('包级 sky 标记在变体裁剪前采样：被裁变体里的唯一 sky 不触发名字 fallback', () => {
    const root = { userData: { variantByMapId: { 1: 'md1' } }, children: [],
      remove: (c) => { root.children = root.children.filter((x) => x !== c) } }
    const add = (node) => {
      node.parent = root
      node.children = node.children || []
      node.remove = (c) => { root.children = root.children.filter((x) => x !== c) }
      root.children.push(node)
      return node
    }
    add({ userData: { mdVariant: 'md2' }, isMesh: true, material: sky(), children: [] })
    add({ userData: { mdVariant: 'md1' }, isMesh: true, name: 'sky_dome', material: plain(), children: [] })
    const flags = sceneHasSkyFlags(root)
    expect(flags).toBe(true)
    pruneForeignVariants(root, 1)
    expect(sceneHasSkyFlags(root)).toBe(false)
    // 正确顺序：用裁剪前的 flags=true ⇒ 普通 sky_dome 保留；重算 false 会误剔
    expect(bakeDropNode('sky_dome', plain(), { strictSurfaces: true, keepWater: true, skyFlagsAvailable: flags })).toBe(false)
    expect(bakeDropNode('sky_dome', plain(), { strictSurfaces: true, keepWater: true, skyFlagsAvailable: false })).toBe(true)
  })

  it('isSkyShellName（旧包 fallback）：/sky/ ——穹顶建筑/舱室不再被当天空壳', () => {
    expect(isSkyShellName('SkySeaSurface.sc2')).toBe(true)     // 含 sky（再由水材质标记让位，见 keepWater 用例）
    expect(isSkyShellName('sky_dome')).toBe(true)
    expect(isSkyShellName('fa_sky_dome.sc2')).toBe(true)
    // ⚠️ 收窄回归（2026-10-14 用户报障"顶棚类构件没渲染"）：dome/loonar/spacedome/stars
    // 不再命中——它们是地图上的穹顶建筑/月面舱室（faust env_fa_dome01..04、moon loonar_module/
    // spacedome），运行时（无此词表）正常渲染；大件（山体/地貌带/大地壳）烘焙同样保留（2026-10-14 收敛）
    expect(isSkyShellName('env_fa_dome03.sc2')).toBe(false)
    expect(isSkyShellName('loonar_module.sc2')).toBe(false)
    expect(isSkyShellName('spacedome.sc2')).toBe(false)
    expect(isSkyShellName('stars_bg')).toBe(false)
    expect(isSkyShellName('bld_factory')).toBe(false)
    expect(isNonIntactStateName('D_env_searchlight.sc2 State 1')).toBe(true)
    expect(isNonIntactStateName('State 1')).toBe(true)
    expect(isNonIntactStateName('State 0')).toBe(false)       // 完好态：`[1-9]` 不吃 0
    expect(isNonIntactStateName('env_searchlight.sc2 State 0')).toBe(false)
  })
})

describe('sceneryAssemblyRules：俯视烘焙剔除判定（census 真名回归）', () => {
  const strict = { strictSurfaces: true }
  it('修正两类漂移：水塔/探照灯不再过剔，海面/浮冰不再漏剔', () => {
    // ① 过剔除修正：非水件保留（运行时同判 → 底图与 3D 档同源）
    expect(bakeDropNode('bld_er_water_tower.sc2', plain(), strict)).toBe(false)
    expect(bakeDropNode('env_pt_watertank.sc2', plain(), strict)).toBe(false)
    expect(bakeDropNode('env_searchlight.sc2 State 0', plain(), strict)).toBe(false)
    expect(bakeDropNode('env_id_river_water.sc2', plain(), strict)).toBe(false)  // 非标记 ⇒ 运行时也是固体渲染
    // ② 漏剔除修正：keepWater=false（缺省，旧口径）下水标记件一律不烘
    expect(bakeDropNode('skit_ocean.sc2', water(), strict)).toBe(true)
    expect(bakeDropNode('port_ocean.sc2', water(), strict)).toBe(true)
    expect(bakeDropNode('env_ma_ice02_01', water(), strict)).toBe(true)
    expect(bakeDropNode('SkySeaSurface.sc2', water(), strict)).toBe(true)   // 海面：按水剔（不再按 sky 剔）
  })

  it('keepWater（地面 pass 后）：水语义件渲染不剔；天空壳名字让位于水材质标记', () => {
    // 2026-10-14：烘焙接管地面渲染（cm×lm 实时合成），底图不再由客户端地图图的水系配色承担
    // ⇒ 水件保留渲染（与 3D 运行时同源）；名字像天、材质是水的 NewBay 海面必须同判保留
    const kw = { strictSurfaces: true, keepWater: true }
    expect(bakeDropNode('skit_ocean.sc2', water(), kw)).toBe(false)
    expect(bakeDropNode('env_ma_ice02_01', water(), kw)).toBe(false)
    expect(bakeDropNode('SkySeaSurface.sc2', water(), kw)).toBe(false)      // 语义先于名字（运行时同判）
    expect(bakeDropNode('fa_sky_dome.sc2', plain(), kw)).toBe(true)       // 真天穹（含 sky、无材质标记）仍剔
    expect(bakeDropNode('D_x.sc2 State 1', water(), kw)).toBe(true)         // 非完好态仍剔
  })

  it('烘焙专有策略仍生效：非完好态/隐形/天空壳/跨变体标记；名字启发式过剔已删', () => {
    expect(bakeDropNode('D_x.sc2 State 1', water(), strict)).toBe(true)
    expect(bakeDropNode('some_invisible_wall', plain(), strict)).toBe(true)
    expect(bakeDropNode('fa_sky_dome.sc2', plain(), strict)).toBe(true)     // 真天空穹（含 sky）
    expect(bakeDropNode('bld_x.sc2', plain(), { strictSurfaces: true, mdVariant: true })).toBe(true)
    expect(bakeDropNode('road_part_5.sc2', plain(), strict)).toBe(false)    // 普通件保留
    // ⚠️ 2026-10-14 收窄回归：运行时渲染的穹顶建筑/舱室/山体块/小件一律保留——
    // 此前 `dome|loonar|spacedome|stars` 与 `surroundings|^plane` 两条名字启发式把它们过剔
    expect(bakeDropNode('env_fa_dome03.sc2', plain(), strict)).toBe(false)  // faust 圆顶建筑（13 件）
    expect(bakeDropNode('loonar_module.sc2', plain(), strict)).toBe(false)  // moon 月面舱室
    expect(bakeDropNode('spacedome.sc2', plain(), strict)).toBe(false)      // moon 120m 穹顶（运行时渲染）
    expect(bakeDropNode('surroundings_001', plain(), strict)).toBe(false)   // 运行时渲染 ⇒ 保留（含整幅大件）
    expect(bakeDropNode('plane_far', plain(), strict)).toBe(false)
    expect(bakeDropNode('Plane017', plain(), strict)).toBe(false)
    expect(bakeDropNode('plane.sc2', plain(), strict)).toBe(false)          // 1–2m 小件（rudniki/skit 46 件）
  })

  it('旧包（无 surfaceFlags）行为与旧烘焙名式一致——水面名字回退', () => {
    const legacy = { strictSurfaces: false }
    expect(bakeDropNode('bld_er_water_tower.sc2', plain(), legacy)).toBe(true)  // 旧包旧行为（历史口径）
    expect(bakeDropNode('env_id_river_water.sc2', plain(), legacy)).toBe(true)
    expect(bakeDropNode('env_fountain_water.sc2', plain(), legacy)).toBe(true)
    expect(bakeDropNode('skit_ocean.sc2', plain(), legacy)).toBe(false)
  })
})
