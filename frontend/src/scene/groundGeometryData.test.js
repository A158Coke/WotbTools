// 地形几何纯数据阶段（buildGroundGeometryData）与同步路径 / three 原生计算的一致性护栏。
// 这是「Worker 路径与同步路径几何逐字节相等」的根：Worker 只是 buildGroundGeometryData 的执行位置。
import { describe, it, expect } from 'vitest'
import * as THREE from 'three'
import {
  buildGroundGeometry, buildGroundGeometryData, groundGeometryFromData, groundGeometryTransferables,
} from './groundPass.js'
import { buildAdaptiveTerrain, groundMapUv, buildRefineMask } from './terrainMesh.js'

const N = 128, SPAN = 600
function makeField() {
  const f = new Float32Array(N * N)
  let s = 12345
  const rnd = () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296 }
  for (let i = 0; i < N; i++) for (let j = 0; j < N; j++) {
    f[i * N + j] = 20 * Math.sin(i / 17) * Math.cos(j / 23) + 6 * Math.sin((i + j) / 5) + rnd() * 0.3
  }
  return f
}
const field = makeField()
const mask = (() => { const pts = []; for (let k = 0; k < 40; k++) pts.push(-100 + k * 4, 50 + k) ; return buildRefineMask(pts, N, SPAN, 2) })()
const cases = [
  { name: '近景无掩码', cam: { x: 30, y: 80, z: -20 }, refineMask: null },
  { name: '远景', cam: { x: 0, y: 400, z: 300 }, refineMask: null },
  { name: '走廊掩码', cam: { x: -60, y: 60, z: 90 }, refineMask: mask },
]
const base = { field, n: N, span: SPAN, fovY: 0.9, aspect: 1.9, hFovDeg: 55, cx: 3, cz: -4 }
const bytes = (a) => new Uint8Array(a.buffer, a.byteOffset, a.byteLength)

describe('buildGroundGeometryData', { timeout: 60000 }, () => {
  for (const c of cases) {
    it(`${c.name}：与 three 原生路径逐字节相等（positions/uv/index/normal/boundingSphere）`, () => {
      const args = { ...base, cam: c.cam, refineMask: c.refineMask }
      const data = buildGroundGeometryData(args)
      // 参考实现 = 拆分前的 buildGroundGeometry 逻辑（直接用 three）
      const ref = buildAdaptiveTerrain(args)
      const g = new THREE.BufferGeometry()
      g.setAttribute('position', new THREE.BufferAttribute(ref.positions, 3))
      g.setAttribute('uv', new THREE.BufferAttribute(groundMapUv(ref.positions, SPAN, 3, -4), 2))
      g.setIndex(new THREE.BufferAttribute(ref.indices, 1))
      g.computeVertexNormals()
      g.computeBoundingSphere()
      expect(bytes(data.positions)).toEqual(bytes(g.attributes.position.array))
      expect(bytes(data.uvs)).toEqual(bytes(g.attributes.uv.array))
      expect(bytes(data.indices)).toEqual(bytes(g.index.array))
      expect(bytes(data.normals)).toEqual(bytes(g.attributes.normal.array))
      expect(data.boundingSphere.radius).toBe(g.boundingSphere.radius)
      expect(data.boundingSphere.center).toEqual(g.boundingSphere.center.toArray())
    })

    it(`${c.name}：buildGroundGeometry（同步组合）与 data→fromData 结果相同，且 userData.terrainBuild 完整`, () => {
      const args = { ...base, cam: c.cam, refineMask: c.refineMask }
      const diag = []
      const sync = buildGroundGeometry({ ...args, onDiagnostics: (d) => diag.push(d) })
      const viaData = groundGeometryFromData(buildGroundGeometryData(args))
      for (const k of ['position', 'uv', 'normal']) expect(bytes(sync.attributes[k].array)).toEqual(bytes(viaData.attributes[k].array))
      expect(bytes(sync.index.array)).toEqual(bytes(viaData.index.array))
      expect(sync.boundingSphere.radius).toBe(viaData.boundingSphere.radius)
      expect(Object.keys(sync.userData.terrainBuild).sort()).toEqual(
        ['positions', 'sizeAt', 'originIAt', 'originJAt', 'vertexIndexAt', 'morphRaw', 'quads', 'overBudget', 'n', 'span'].sort())
      expect(diag).toHaveLength(1)
      expect(Object.keys(diag[0]).sort()).toEqual(
        ['adaptiveMs', 'assemblyMs', 'normalsMs', 'boundsMs', 'vertices', 'triangles', 'overBudget'].sort())
    })
  }

  it('不带 measure 时 diagnostics 为 null；transferables 去重且包含 positions 的 buffer', () => {
    const data = buildGroundGeometryData({ ...base, cam: cases[0].cam })
    expect(data.diagnostics).toBeNull()
    const t = groundGeometryTransferables(data)
    expect(new Set(t).size).toBe(t.length)
    expect(t).toContain(data.positions.buffer)
  })

  it('结构化克隆往返（Worker 传输语义）后换装结果仍逐字节相等', () => {
    const args = { ...base, cam: cases[2].cam, refineMask: mask }
    const data = buildGroundGeometryData(args)
    const copy = structuredClone(data, { transfer: groundGeometryTransferables(data) })
    const g1 = groundGeometryFromData(buildGroundGeometryData(args)), g2 = groundGeometryFromData(copy)
    expect(bytes(g1.attributes.normal.array)).toEqual(bytes(g2.attributes.normal.array))
    expect(g2.userData.terrainBuild.positions).toBe(g2.attributes.position.array)
  })
})
