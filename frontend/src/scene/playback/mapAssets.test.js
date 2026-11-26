import { describe, expect, it, vi } from 'vitest'
import * as THREE from 'three'

const surfaceMesh = vi.hoisted(() => ({ userData: {} }))
vi.mock('../sceneryAssembly.ts', () => ({
  resolveSceneryExtras: async () => ({}),
  makeTexResolvers: () => ({ maskTexOf: null, lmTexOf: null, detailTexOf: null, envTexOf: null, waterTexOf: null, decalTexOf: null }),
  assembleSceneryMaterials: (_gltf, opts) => { opts.onMesh(surfaceMesh, false); return { animLayerMats: [] } },
}))
vi.mock('../sceneryAssemblyRules.ts', () => ({
  sceneHasSkyFlags: () => false,
  strictSurfacesOf: () => new Set(),
  isWaterNode: () => false,
}))
vi.mock('../variantFilter.ts', () => ({
  pruneForeignVariantsDetailed: () => ({ removed: 0, failClosed: false }),
  activeVariantOf: () => null,
}))
vi.mock('../sceneryMaterials.ts', () => ({ applyMaterialTextureAnisotropy: () => 0 }))
vi.mock('../groundPass.js', () => ({
  makeWaterCoast: () => null,
  buildCorridorRefineMask: ({ meshes }) => ({
    mask: 'MASK', candidates: meshes.length, texels: 1, meshes: meshes.map((m) => m.o),
  }),
}))
vi.mock('../sceneryInstancing.ts', () => ({
  collectInstanceEntries: () => [],
  buildStandaloneLightmappedMeshes: () => {},
  groupInstanceBatches: () => [],
  canonicalizeEntryMaterials: (entries) => entries,
}))
vi.mock('../pickDebug.ts', () => ({ buildMeshOwnerMap: () => new Map() }))

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
    await Promise.resolve()
    await Promise.resolve()
    expect(scene.children.length).toBe(1)
    const mountedGroup = scene.children[0]
    expect(ctx.onSceneryMounted).toHaveBeenCalledWith(mountedGroup, null)
    ctx.stale = () => true
    lateResolve({ instances: [] })
    const asm = await run
    expect(asm.stale).toBe(true)
    expect(asm.writes).toEqual({})
    expect(scene.children.length).toBe(1)
    expect(disposeObject3D).not.toHaveBeenCalled()
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
    expect(ctx.onSceneryMounted).toHaveBeenCalledTimes(1)
    expect(asm.writes.destructPickList).toEqual([{ id: 1, pos: [0, 0, 0] }])
    expect(asm.writes.destruct).toBeTruthy()
    expect(asm.writes.destruct.states).toBeInstanceOf(Array)
    expect(asm.writes.mapScenery).toBeTruthy()
    expect(asm.writes.occlGrid).toBeInstanceOf(Map)
    expect(asm.writes.annotationSurfaceGrid).toBeInstanceOf(Map)
    expect(surfaceMesh.userData.annotationSurface).toBeUndefined()
  })

  it('走廊掩码建成：onRefineMaskBuilt 携带 mask 且仅在宿主具备地形/相机/控件时调用（评审 P2）', async () => {
    const onRefineMaskBuilt = vi.fn()
    const withTerrain = makeCtx({ terrainMesh: {}, onRefineMaskBuilt })
    await assembleMapScenery(withTerrain.gltf, withTerrain.ctx)
    expect(onRefineMaskBuilt).toHaveBeenCalledWith('MASK')

    const noTerrain = makeCtx({ onRefineMaskBuilt: vi.fn() })
    await assembleMapScenery(noTerrain.gltf, noTerrain.ctx)
    expect(noTerrain.ctx.onRefineMaskBuilt).not.toHaveBeenCalled()
  })
})
