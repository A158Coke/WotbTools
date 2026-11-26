import { describe, it, expect } from 'vitest'
import { playbackSceneSource } from './__tests__/sceneSource.ts'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
const here = dirname(fileURLToPath(import.meta.url))
const readSrc = (p) => readFileSync(p, 'utf8').replace(/\r\n/g, '\n')
const src = playbackSceneSource()
  .replace(/\/\/[^\n]*/g, '')
  .replace(/\/\*[\s\S]*?\*\//g, '')
const basesSrc = readSrc(resolve(here, 'playback/bases.ts'), 'utf8')
const stripComments = (s) => s.replace(/\/\/[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '')
const mapWorldSrc = stripComments(readSrc(resolve(here, 'playback/mapWorldTerrain.ts')))
const vehSrc = stripComments(readSrc(resolve(here, 'playback/vehicleRuntime.ts')))

describe('场景生命周期与反馈合同', () => {


describe('车体横滚（hull_roll）接线守卫', () => {
  it('侧倾取值走共享位姿采样器：旧产物缺列时落 0（不拿 pitch 顶替）', () => {
    expect(vehSrc).toMatch(/const rollAt = \(v: RuntimeVehicle, t: number\) => poseStash\(v, t\)\.roll;/)
  })

  it('位姿通道唯一实现：场景只做帧变换，不再自带通道选择/关键帧回退', () => {
    expect(vehSrc).toMatch(/out\.set\(-p\.x, p\.y, p\.z\);/)
    expect(vehSrc).not.toMatch(/kfOf/)
    expect(vehSrc).not.toMatch(/const col = \(c\) =>/)
  })

})



describe('炮线渲染守卫（阵营语义色直出）', () => {
  it('飞行段时长 = 真实飞行时长（不得再有"最小显示时长"拖慢炮弹）', async () => {
    const { tracerSpanSecs } = await import('./playback/pure.js')
    expect(tracerSpanSecs(0.44)).toBeCloseTo(0.44, 12)
    expect(tracerSpanSecs(0.16)).toBeCloseTo(0.16, 12)
    expect(tracerSpanSecs(0.02)).toBeCloseTo(0.02, 12)
    const oneFrame = 1 / 60
    expect(tracerSpanSecs(0)).toBeCloseTo(oneFrame, 12)
    expect(tracerSpanSecs(-1)).toBeCloseTo(oneFrame, 12)
    expect(tracerSpanSecs(NaN)).toBeCloseTo(oneFrame, 12)
    expect(tracerSpanSecs(Number.POSITIVE_INFINITY)).toBeCloseTo(oneFrame, 12)
  })

  it('标记/反馈层材质字面色直出（toneMapped:false）——逐图曝光不得压深 UI 语义色', () => {
    expect(basesSrc, '基地环').toMatch(/color: baseColors\.neutral[\s\S]{0,200}toneMapped: false/)
    expect(basesSrc, '基地圆盘').toMatch(/map: tex, side: THREE\.DoubleSide[\s\S]{0,160}toneMapped: false/)
    const sites = [
      [/color: 0xe8b23c[\s\S]{0,160}toneMapped: false/, '作者标记环'],
    ]
    for (const [re, label] of sites) expect(vehSrc, label).toMatch(re)
  })

  it('着色器预热：场景就绪时 compile 一次（首次开火才编译＝开局/接火卡顿）', () => {
    expect(src).toMatch(/function prewarmShaders\(\)/)
    expect(src).toMatch(/renderer\.compile\(scene, camera\);/)
    expect(src).toMatch(/prewarmShaders,/)
  })

})



describe('disposeSceneGroup —— 双图资源生命周期（评审 P2）', () => {
  it('释放 uniforms 纹理与材质，并清空材质缓存使下一图拿到新实例', async () => {
    const { vi } = await import('vitest')
    const { makeBillboardMaterial, disposeSceneGroup, clearSceneryMatCache } = await import('./sceneryMaterials.ts')
    clearSceneryMatCache()
    const tex = { isTexture: true, dispose: vi.fn() }
    const gltfMaterial = { name: 'leaf', map: tex, color: { r: 1, g: 1, b: 1 }, alphaTest: 0, transparent: false, opacity: 1, vertexColors: false, userData: {} }
    const mesh1 = { isMesh: true, geometry: { dispose: vi.fn() }, material: makeBillboardMaterial(gltfMaterial) }
    const group1 = { traverse: (fn) => fn(mesh1) }
    const m1 = mesh1.material
    const spyM = vi.spyOn(m1, 'dispose')
    const spyT = vi.spyOn(tex, 'dispose')
    const stats = disposeSceneGroup(group1)
    expect(stats.materials).toBe(1)
    expect(spyT).toHaveBeenCalled()
    expect(spyM).toHaveBeenCalled()
    const again = makeBillboardMaterial(gltfMaterial)
    expect(again).not.toBe(m1)
    clearSceneryMatCache()
  })
})



describe('地形 LOD 滞回与构建判据同源（review P2 回归锁）', () => {
  it('maybeRebuildTerrainLod 消费 terrainLodState(camera, controls.target, camera.aspect)', () => {
    const start = mapWorldSrc.indexOf('function maybeRebuildTerrainLod')
    expect(start).toBeGreaterThan(0)
    const fn = mapWorldSrc.slice(start, mapWorldSrc.indexOf('\n  }', start))
    expect(fn).toMatch(/terrainLodState\(camera, controls\.target, camera\.aspect\)/)
    expect(fn.replace('terrainLodState(camera, controls.target, camera.aspect)', '')).not.toMatch(/terrainLodState\(camera, controls\.target, camera\.aspect\)/)
    expect(fn).not.toMatch(/terrainLodDist/)
    expect(fn).toMatch(/terrainLodStaleReason\(terrainLodPrev, cur, now - terrainLodAt\)/)
  })

  it('换装后的最终姿态与异步失败都会唤醒宿主，提交/回退后撤销待唤醒', () => {
    const swapStart = mapWorldSrc.indexOf('function applyTerrainSwap')
    expect(swapStart).toBeGreaterThan(0)
    const swap = mapWorldSrc.slice(swapStart, mapWorldSrc.indexOf('function maybeRebuildTerrainLod', swapStart))
    expect(swap).toMatch(/terrainLodPoseReason\(job\.snapshot, terrainLodState\(camera, controls\.target, camera\.aspect\)\)/)
    expect(swap).toMatch(/terrainLodWake\.scheduleElapsed\(/)
    expect(swap).toMatch(/terrainLodWake\.cancel\(\)/)
    expect(mapWorldSrc).toMatch(/onWorkerLost:[\s\S]{0,800}?deps\.invalidate\(\)/)
    expect(mapWorldSrc).toMatch(/onDiscard: \(\) => deps\.invalidate\(\)/)
    expect(mapWorldSrc.match(/terrainLodWake\.cancel\(\)/g)?.length ?? 0).toBeGreaterThanOrEqual(4)
    expect(mapWorldSrc).toMatch(/if \(sch\.request\([^\n]*\)\) \{[^}]*terrainLodWake\.cancel\(\)/)
    expect(mapWorldSrc).toMatch(/terrainLodWake\.cancel\(\);\s*\n\s*terrainLodPrev = cur;/)
  })
})
})
