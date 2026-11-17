// 投影贴花静态消费（deferredDecals.ts）纯函数单测：npx vitest run src/scene/playback/deferredDecals.test.js
//
// 上游契约（Agent 仓 tools/export_map_glb.py 的 decals.json，2026-11-17 审计 B9）：
//   盒矩阵 = 平移·旋转·缩放；贴片 = 盒局部 xy 平面 z=0 的 [-0.5,0.5]² 四边形；
//   UV = uvOffset + uvScale·(ms.xy + 0.5)（客户端 deferred-decal-fp.sl:100-101 同式）。
// fail-closed：字段缺失/数值非有限/blendingName 不在客户端 blending.slh 枚举内 ⇒ 跳过该条。
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
    // fuseBlendAdd(8) 是 blending.slh 的合法枚举，但当前内容只出现 1/2/5；
    // 模块只映射三种在内容出现的模式，其余 fail-closed 跳过（宁缺不猜）
    expect(validDecalRecord({ ...REC, blendingName: 'fuseBlendAdd' })).toBe(false)
    expect(validDecalRecord({ ...REC, blendingName: ' invented ' })).toBe(false)
  })
})

describe('decalQuadWorld（客户端几何语义）', () => {
  it('单位盒中心面四角按盒矩阵摆到世界（平移/缩放）', () => {
    const q = decalQuadWorld(REC)
    expect(q.positions).toEqual([
      9, 18, 30,   // (−0.5,−0.5) × (2,4) + (10,20,30)
      11, 18, 30,
      11, 22, 30,
      9, 22, 30,
    ])
    expect(q.indices).toEqual([0, 1, 2, 0, 2, 3])
  })

  it('UV = uvOffset + uvScale·(ms.xy+0.5)（v 不翻：图集按文件行序嵌入）', () => {
    const q = decalQuadWorld(REC)
    expect(q.uvs).toEqual([
      0.5, 0.25,            // (−0.5,−0.5) → x+0.5=0 ⇒ 不偏
      0.75, 0.25,           // (+0.5,−0.5) → x+0.5=1 ⇒ +uvScale.x
      0.75, 0.375,          // (+0.5,+0.5) ⇒ +两者
      0.5, 0.375,
    ])
  })

  it('旋转四元数生效（绕客户端 z 轴转 90°：x→y）', () => {
    const half = Math.SQRT1_2
    const q = decalQuadWorld({ ...REC, box: { ...REC.box, rotation: [0, 0, half, half] } })
    // M = T·R·S：先缩放 (−0.5,−0.5)×(2,4)=(−1,−2)，再绕 z 转 90°((x,y)→(−y,x))=(2,−1)，再平移
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
    // multiplicative 2 条 → 1 mesh；alphaBlend 1 条 → 1 mesh；bad + null 跳过
    expect(group.children.length).toBe(2)
    const kinds = new Set(group.children.map((c) => c.userData.annotationSurface))
    expect(kinds.has(false)).toBe(true)   // 效果层语义：不可作为 3D annotation 表面
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
