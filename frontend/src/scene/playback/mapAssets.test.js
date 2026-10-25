// assembleMapScenery 的会话竞态回归锁（评审 P1/P2，PR #745）：
// P1 —— GLB 已装配、destructibles 延迟期间会话被取代（切场/清空）：已挂进场景的
//       资源必须就地回收，且**不得发布任何 writes**（stale 结果写回宿主会覆盖
//       新会话的 mapScenery/动画材质/遮挡表/走廊掩码）。
// P2 —— 走廊掩码建成时，onRefineMaskBuilt 必须带着 mask 调用（宿主先写回再重建
//       LOD；回调不带 mask 会让首次重建拿到空掩码）。
// 协作模块（材质装配/变体裁剪/实例化/掩码生成）mock 掉——被锁的是本模块的
// 时序与发布语义，不是它们的实现。
import { describe, expect, it, vi } from 'vitest'
import * as THREE from 'three'

vi.mock('../sceneryAssembly.js', () => ({
  resolveSceneryExtras: async () => ({}),
  makeTexResolvers: () => ({ maskTexOf: null, lmTexOf: null, detailTexOf: null, envTexOf: null, waterTexOf: null, decalTexOf: null }),
  assembleSceneryMaterials: (_gltf, opts) => { opts.onMesh({}, false); return { animLayerMats: [] } },
}))
vi.mock('../sceneryAssemblyRules.js', () => ({
  sceneHasSkyFlags: () => false,
  strictSurfacesOf: () => new Set(),
  isWaterNode: () => false,
}))
vi.mock('../variantFilter.js', () => ({ pruneForeignVariantsDetailed: () => ({ removed: 0, failClosed: false }) }))
vi.mock('../sceneryMaterials.js', () => ({ applyMaterialTextureAnisotropy: () => 0 }))
vi.mock('../groundPass.js', () => ({ makeWaterCoast: () => null, buildCorridorRefineMask: () => ({ mask: 'MASK', candidates: 1, texels: 1 }) }))
vi.mock('../sceneryInstancing.js', () => ({
  collectInstanceEntries: () => [],
  buildStandaloneLightmappedMeshes: () => {},
  groupInstanceBatches: () => [],
}))
vi.mock('../pickDebug.js', () => ({ buildMeshOwnerMap: () => new Map() }))

import { assembleMapScenery } from './mapAssets.js'

const makeCtx = (over = {}) => {
  const scene = new THREE.Scene()
  const gltf = { scene: new THREE.Group() }
  gltf.scene.updateMatrixWorld = vi.fn()
  const disposeObject3D = vi.fn()
  const ctx = {
    DATA: { meta: { map_id: 1 }, vehicles: [], destructible_areas: [], destructible_events: [{ t: 1, eid: 5, prop: 2 }] },
    Q: { anisotropy: 1 }, DEBUG: false,
    camera: { near: 0.5, far: 4000 }, renderer: { capabilities: { getMaxAnisotropy: () => 4 } }, scene, controls: {},
    terrainMesh: null, groundLayers: null,
    heightField: [0.1], heightMeta: { size: 8, span: 600 }, terrainSpan: 600,
    stale: () => false, disposeObject3D,
    noteAsset: vi.fn(), sampleHeight: () => 0,
    onRefineMaskBuilt: vi.fn(),
    onSceneryMounted: vi.fn(),
    destructDocPromise: Promise.resolve(null),
    ...over,
  }
  return { ctx, scene, disposeObject3D, gltf }
}

describe('assembleMapScenery 会话竞态（评审 P1/P2）', () => {
  it('destructibles 悬挂期间 reset/切场：挂载即归属（lateResolve 之前可释放），stale 不发布也不自行摘除', async () => {
    const { ctx, scene, disposeObject3D, gltf } = makeCtx()
    let lateResolve
    ctx.destructDocPromise = new Promise((res) => { lateResolve = res })
    const run = assembleMapScenery(gltf, ctx)
    // 装配的同步续体在 resolveSceneryExtras 的微任务后运行：flush 一拍再断言
    await Promise.resolve()
    await Promise.resolve()
    expect(scene.children.length).toBe(1)
    const mountedGroup = scene.children[0]
    // ① 挂载即归属：宿主（teardownSession）在 destructibles 仍悬挂时即拿到引用
    expect(ctx.onSceneryMounted).toHaveBeenCalledWith(mountedGroup, null)
    // ② 迟到的 destructibles 返回时已 stale：只丢弃结果，**不碰宿主资源**。
    //   评审回归分支：A stale 返回 → B 解析失败 → 宿主不 teardown A；此处若自行
    //   摘除，A 的布景消失而地形/其它对象仍在。释放只由宿主负责。
    ctx.stale = () => true
    lateResolve({ instances: [] })
    const asm = await run
    expect(asm.stale).toBe(true)
    expect(asm.writes).toEqual({})                    // 不发布任何 stale 结果
    expect(scene.children.length).toBe(1)             // 布景仍归宿主所有
    expect(disposeObject3D).not.toHaveBeenCalled()    // stale 路径不释放
    // ③ 宿主 teardown（切场成功 / reset）时才摘除并释放一次
    scene.remove(mountedGroup)
    disposeObject3D(mountedGroup)
    expect(scene.children.length).toBe(0)
    expect(disposeObject3D).toHaveBeenCalledTimes(1)
  })

  it('正常路径：destructPickList/meshOwner/destruct 随 writes 发布', async () => {
    const { ctx, gltf } = makeCtx()
    ctx.destructDocPromise = Promise.resolve({ instances: [{ id: 1, pos: [0, 0, 0] }] })
    const asm = await assembleMapScenery(gltf, ctx)
    expect(asm.stale).toBe(false)
    expect(ctx.onSceneryMounted).toHaveBeenCalledTimes(1)   // 正常路径同样挂载即归属
    expect(asm.writes.destructPickList).toEqual([{ id: 1, pos: [0, 0, 0] }])
    expect(asm.writes.destruct).toBeTruthy()           // events + instances 齐 ⇒ 状态机随 writes 发布
    expect(asm.writes.destruct.states).toBeInstanceOf(Array)
    expect(asm.writes.mapScenery).toBeTruthy()
    expect(asm.writes.occlGrid).toBeInstanceOf(Map)
  })

  it('走廊掩码建成：onRefineMaskBuilt 携带 mask 且仅在宿主具备地形/相机/控件时调用（评审 P2）', async () => {
    const onRefineMaskBuilt = vi.fn()
    const withTerrain = makeCtx({ terrainMesh: {}, onRefineMaskBuilt })
    await assembleMapScenery(withTerrain.gltf, withTerrain.ctx)
    expect(onRefineMaskBuilt).toHaveBeenCalledWith('MASK')

    const noTerrain = makeCtx({ onRefineMaskBuilt: vi.fn() })   // terrainMesh=null：不重建
    await assembleMapScenery(noTerrain.gltf, noTerrain.ctx)
    expect(noTerrain.ctx.onRefineMaskBuilt).not.toHaveBeenCalled()
    // 掩码本身仍随 writes 发布（宿主稍后写回的路径不受影响）
  })
})
