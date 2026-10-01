import { describe, expect, it } from 'vitest'
import { orientDiscUv } from './baseDecal.js'

// 顶点：北（-z）、东（+x）、南（+z）、西（-x）
const offsets = new Float32Array([0, -1, 1, 0, 0, 1, -1, 0])
const uvOf = (ux, uz) => Array.from(orientDiscUv(offsets, new Float32Array(8), ux, uz), (v) => Math.round(v * 100) / 100)

describe('orientDiscUv', () => {
  it('相机在南面朝北看：北边是字的上方，东边是观者右手', () => {
    // 从相机指向基地 = 朝北 (0, -1)
    expect(uvOf(0, -1)).toEqual([0.5, 1, 1, 0.5, 0.5, 0, 0, 0.5])
  })

  it('相机在东面朝西看：西边是上方，北边是右手（向西看时右手指北）', () => {
    const [nU, nV, , , , , wU, wV] = uvOf(-1, 0)
    expect([wU, wV]).toEqual([0.5, 1])
    expect([nU, nV]).toEqual([1, 0.5])
  })
})
