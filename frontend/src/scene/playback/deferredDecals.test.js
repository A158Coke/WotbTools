import { describe, expect, it } from 'vitest'
import * as THREE from 'three'
import {
  DECAL_BLEND_PARAMS,
  buildDecalMeshes,
  decalQuadWorld,
  validDecalRecord,
} from './deferredDecals.js'

/** @typedef {import('./deferredDecals.js').DecalRecord} DecalRecord */
/** @typedef {import('./deferredDecals.js').DecalDoc} DecalDoc */

const REC = {
  name: 'dark_line',
  blending: 5,
  blendingName: 'multiplicative',
  texture: 'decals/atlas0.tex',
  uvOffset: [0.5, 0.25],
  uvScale: [0.25, 0.125],
  box: { translation: [10, 20, 30], scale: [2, 4, 6], rotation: [0, 0, 0, 1] },
}

/** @param {DecalRecord[]} decals */
function doc(decals) {
  return { space: '11_plant_pn', version: 1, textures: { 'decals/atlas0.tex': 'decal_atlas0.webp' }, decals }
}

describe('validDecalRecord', () => {
  it('接受字段齐全且数值有限的记录', () => {
    expect(validDecalRecord(REC)).toBe(true)
  })

  it('fail-closed：缺 box / 维度不符 / 非有限数 / 未知 blendingName', () => {
    expect(validDecalRecord(null)).toBe(false)
    expect(validDecalRecord({ ...REC, box: undefined })).toBe(false)
    expect(validDecalRecord({ ...REC, uvOffset: [0.5] })).toBe(false)
    expect(validDecalRecord({ ...REC, box: { ...REC.box, scale: [1, NaN, 3] } })).toBe(false)
    expect(validDecalRecord({ ...REC, blendingName: 'fuseBlendAdd' })).toBe(false)
    expect(validDecalRecord({ ...REC, blendingName: ' invented ' })).toBe(false)
  })
})

describe('decalQuadWorld（客户端几何语义）', () => {
  it('单位盒中心面四角按盒矩阵摆到世界（平移/缩放）', () => {
    const q = decalQuadWorld(REC)
    expect(q.positions).toEqual([
      9, 18, 30,
      11, 18, 30,
      11, 22, 30,
      9, 22, 30,
    ])
    expect(q.indices).toEqual([0, 1, 2, 0, 2, 3])
  })

  it('UV = uvOffset + uvScale·(ms.xy+0.5)（v 不翻：图集按文件行序嵌入）', () => {
    const q = decalQuadWorld(REC)
    expect(q.uvs).toEqual([
      0.5, 0.25,
      0.75, 0.25,
      0.75, 0.375,
      0.5, 0.375,
    ])
  })

  it('旋转四元数生效（绕客户端 z 轴转 90°：x→y）', () => {
    const half = Math.SQRT1_2
    const q = decalQuadWorld({ ...REC, box: { ...REC.box, rotation: [0, 0, half, half] } })
    expect(q.positions[0]).toBeCloseTo(10 + 2, 6)
    expect(q.positions[1]).toBeCloseTo(20 - 1, 6)
    expect(q.positions[2]).toBeCloseTo(30, 6)
  })
})

describe('DECAL_BLEND_PARAMS（blending.slh 枚举映射）', () => {
  it('三种在内容出现的 blending：alphaBlend/additive/multiplicative', () => {
    expect(DECAL_BLEND_PARAMS.alphaBlend).toMatchObject({ transparent: true, premultLerp: false })
    expect(DECAL_BLEND_PARAMS.additive).toMatchObject({ blending: THREE.AdditiveBlending, premultLerp: false })
    const mul = DECAL_BLEND_PARAMS.multiplicative
    expect(mul).toMatchObject({ blending: THREE.CustomBlending, premultLerp: true })
    expect(mul.blending).toBe(THREE.CustomBlending)
  })
})

describe('buildDecalMeshes（按 blending 合并，非 GL 断言只看结构）', () => {
  it('同 blending 合并成一个 mesh；未知 blending/坏记录被跳过', () => {
    const atlas = new THREE.Texture()
    const good = { ...REC }
    const good2 = { ...REC, name: 'dark_line2', box: { ...REC.box, translation: [1, 2, 3] } }
    const alphaOne = { ...REC, blending: 1, blendingName: 'alphaBlend', box: { ...REC.box, translation: [5, 5, 5] } }
    const bad = { ...REC, blendingName: 'unknownMode' }
    const { group, dispose } = buildDecalMeshes(doc([good, good2, alphaOne, bad, null]), atlas)
    expect(group.children.length).toBe(2)
    const kinds = new Set(group.children.map((c) => c.userData.annotationSurface))
    expect(kinds.has(false)).toBe(true)
    const merged = group.children.find((c) => c.geometry.attributes.position.count === 8)
    expect(merged).toBeTruthy()
    dispose()
  })

  it('记录的 texture 键不在 doc.textures ⇒ 跳过（fail-closed，不猜兜底图）', () => {
    const atlas = new THREE.Texture()
    const orphan = { ...REC, texture: 'decals/missing.tex' }
    const { group, dispose } = buildDecalMeshes(doc([orphan]), atlas)
    expect(group.children.length).toBe(0)
    dispose()
  })
})
