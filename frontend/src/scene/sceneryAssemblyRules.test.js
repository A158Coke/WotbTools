import { describe, it, expect } from 'vitest'
import {
  strictSurfacesOf, materialIsWater, isWaterNode, isSkyShellName,
  isNonIntactStateName, bakeDropNode, materialHasSky, materialAllSky, sceneHasSkyFlags, isSkyShell,
} from './sceneryAssemblyRules.ts'
import { pruneForeignVariants } from './variantFilter.ts'

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
    expect(materialIsWater([plain(), water()])).toBe(false)
    expect(materialIsWater({ userData: { water: true } })).toBe(true)
    expect(materialIsWater(plain())).toBe(false)
    expect(materialIsWater(undefined)).toBe(false)
  })

  it('isWaterNode：新包看标记（名字不算），旧包名字回退', () => {
    const strict = { strictSurfaces: true }
    const legacy = { strictSurfaces: false }
    expect(isWaterNode('bld_er_water_tower_pbr.sc2', plain(), strict)).toBe(false)
    expect(isWaterNode('skit_ocean.sc2', water(), strict)).toBe(true)
    expect(isWaterNode('env_ma_ice02_01', water(), strict)).toBe(true)
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
    expect(isSkyShell('bld_x.sc2', sky(), { strictSurfaces: true, skyFlagsAvailable: true })).toBe(true)
    expect(isSkyShell('sky_dome', plain(), { strictSurfaces: true, skyFlagsAvailable: true })).toBe(false)
    expect(isSkyShell('sky_dome', plain(), { strictSurfaces: true, skyFlagsAvailable: false })).toBe(true)
    expect(isSkyShell('bld_x.sc2', sky(), { skyFlagsAvailable: true })).toBe(true)
    expect(isSkyShell('sky_dome', plain(), { skyFlagsAvailable: true })).toBe(false)
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
    expect(bakeDropNode('sky_dome', plain(), { strictSurfaces: true, keepWater: true, skyFlagsAvailable: flags })).toBe(false)
    expect(bakeDropNode('sky_dome', plain(), { strictSurfaces: true, keepWater: true, skyFlagsAvailable: false })).toBe(true)
  })

  it('isSkyShellName（旧包 fallback）：/sky/ ——穹顶建筑/舱室不再被当天空壳', () => {
    expect(isSkyShellName('SkySeaSurface.sc2')).toBe(true)
    expect(isSkyShellName('sky_dome')).toBe(true)
    expect(isSkyShellName('fa_sky_dome.sc2')).toBe(true)
    expect(isSkyShellName('env_fa_dome03.sc2')).toBe(false)
    expect(isSkyShellName('loonar_module.sc2')).toBe(false)
    expect(isSkyShellName('spacedome.sc2')).toBe(false)
    expect(isSkyShellName('stars_bg')).toBe(false)
    expect(isSkyShellName('bld_factory')).toBe(false)
    expect(isNonIntactStateName('D_env_searchlight.sc2 State 1')).toBe(true)
    expect(isNonIntactStateName('State 1')).toBe(true)
    expect(isNonIntactStateName('State 0')).toBe(false)
    expect(isNonIntactStateName('env_searchlight.sc2 State 0')).toBe(false)
  })
})

describe('sceneryAssemblyRules：俯视烘焙剔除判定（census 真名回归）', () => {
  const strict = { strictSurfaces: true }
  it('修正两类漂移：水塔/探照灯不再过剔，海面/浮冰不再漏剔', () => {
    expect(bakeDropNode('bld_er_water_tower.sc2', plain(), strict)).toBe(false)
    expect(bakeDropNode('env_pt_watertank.sc2', plain(), strict)).toBe(false)
    expect(bakeDropNode('env_searchlight.sc2 State 0', plain(), strict)).toBe(false)
    expect(bakeDropNode('env_id_river_water.sc2', plain(), strict)).toBe(false)
    expect(bakeDropNode('skit_ocean.sc2', water(), strict)).toBe(true)
    expect(bakeDropNode('port_ocean.sc2', water(), strict)).toBe(true)
    expect(bakeDropNode('env_ma_ice02_01', water(), strict)).toBe(true)
    expect(bakeDropNode('SkySeaSurface.sc2', water(), strict)).toBe(true)
  })

  it('keepWater（地面 pass 后）：水语义件渲染不剔；天空壳名字让位于水材质标记', () => {
    const kw = { strictSurfaces: true, keepWater: true }
    expect(bakeDropNode('skit_ocean.sc2', water(), kw)).toBe(false)
    expect(bakeDropNode('env_ma_ice02_01', water(), kw)).toBe(false)
    expect(bakeDropNode('SkySeaSurface.sc2', water(), kw)).toBe(false)
    expect(bakeDropNode('fa_sky_dome.sc2', plain(), kw)).toBe(true)
    expect(bakeDropNode('D_x.sc2 State 1', water(), kw)).toBe(true)
  })

  it('烘焙专有策略仍生效：非完好态/隐形/天空壳/跨变体标记；名字启发式过剔已删', () => {
    expect(bakeDropNode('D_x.sc2 State 1', water(), strict)).toBe(true)
    expect(bakeDropNode('some_invisible_wall', plain(), strict)).toBe(true)
    expect(bakeDropNode('fa_sky_dome.sc2', plain(), strict)).toBe(true)
    expect(bakeDropNode('bld_x.sc2', plain(), { strictSurfaces: true, mdVariant: true })).toBe(true)
    expect(bakeDropNode('road_part_5.sc2', plain(), strict)).toBe(false)
    expect(bakeDropNode('env_fa_dome03.sc2', plain(), strict)).toBe(false)
    expect(bakeDropNode('loonar_module.sc2', plain(), strict)).toBe(false)
    expect(bakeDropNode('spacedome.sc2', plain(), strict)).toBe(false)
    expect(bakeDropNode('surroundings_001', plain(), strict)).toBe(false)
    expect(bakeDropNode('plane_far', plain(), strict)).toBe(false)
    expect(bakeDropNode('Plane017', plain(), strict)).toBe(false)
    expect(bakeDropNode('plane.sc2', plain(), strict)).toBe(false)
  })

  it('旧包（无 surfaceFlags）行为与旧烘焙名式一致——水面名字回退', () => {
    const legacy = { strictSurfaces: false }
    expect(bakeDropNode('bld_er_water_tower.sc2', plain(), legacy)).toBe(true)
    expect(bakeDropNode('env_id_river_water.sc2', plain(), legacy)).toBe(true)
    expect(bakeDropNode('env_fountain_water.sc2', plain(), legacy)).toBe(true)
    expect(bakeDropNode('skit_ocean.sc2', plain(), legacy)).toBe(false)
  })
})
