import { describe, expect, it, vi } from 'vitest'
import * as THREE from 'three'
import { buildGrassMeshes, makeGrassMaterial, parseGrassBin } from './mapGrass.js'

const DOC = {
  space: '33_neptune_nt',
  version: 1,
  params: {
    baseColorMultiplier: 2.0,
    scaleVariation: [0.5, 0.3, 0.4, 0.2],
    rotationVariation: [180, 180, 180, 180],
    windAmplitude: [0.3, 0.15, 0.24, 0.16],
    windDrag: [1.4, 1.4, 1.4, 1.4],
    windSpring: [8, 10, 8, 12],
    visibilityDistance: [2500, 1600],
    lodRanges: [0, 2, 6],
    isLit: false,
    densitySource: 'landscape/grass/neptune_GrassMap.tex',
  },
  meta: {
    grid: 128,
    target: 60000,
    count: 2,
    densitySource: 'landscape/grass/neptune_GrassMap.tex',
    cellsWithGrass: 1,
    bounds: { min: [-300, -300, 0], max: [300, 300, 70] },
    variations: 4,
  },
  prototype: 'grass.glb',
  instances: 'grass.bin',
  instanceStride: 12,
}

function packInstance(xq, zq, rq, sq, variation, flipped, r = 0, g = 0, b = 0) {
  const buf = new ArrayBuffer(12)
  const v = new DataView(buf)
  v.setUint16(0, xq, true)
  v.setUint16(2, zq, true)
  v.setUint16(4, rq, true)
  v.setUint8(6, sq)
  v.setUint8(7, variation)
  v.setUint8(8, flipped)
  v.setUint8(9, r)
  v.setUint8(10, g)
  v.setUint8(11, b)
  return new Uint8Array(buf)
}

function twoInstances() {
  const a = packInstance(0, 0, 0, 0, 0, 0, 10, 20, 30)
  const b = packInstance(65535, 65535, 32768, 255, 1, 1, 64, 128, 255)
  const out = new Uint8Array(24)
  out.set(a, 0)
  out.set(b, 12)
  return out
}

describe('parseGrassBin', () => {
  it('按 bounds 反归一化位置、量化旋转/缩放', () => {
    const inst = parseGrassBin(DOC, twoInstances())
    expect(inst).not.toBeNull()
    expect(inst.length).toBe(2)
    expect(inst[0].x).toBeCloseTo(-300, 6)
    expect(inst[0].y).toBeCloseTo(-300, 6)
    expect(inst[0].scale).toBeCloseTo(0.4, 6)
    expect(inst[0].variation).toBe(0)
    expect(inst[0].flipped).toBe(false)
    expect(inst[1].x).toBeCloseTo(300, 6)
    expect(inst[1].y).toBeCloseTo(300, 6)
    expect(inst[1].rot).toBeCloseTo(Math.PI, 3)
    expect(inst[1].scale).toBeCloseTo(1.6, 6)
    expect(inst[1].variation).toBe(1)
    expect(inst[1].flipped).toBe(true)
    expect(inst[0].r).toBeCloseTo(10 / 255, 6)
    expect(inst[1].r).toBeCloseTo(64 / 255, 6)
    expect(inst[1].g).toBeCloseTo(128 / 255, 6)
    expect(inst[1].b).toBeCloseTo(1, 6)
  })

  it('fail-closed：stride / 长度 / bounds / 空缓冲', () => {
    expect(parseGrassBin({ ...DOC, instanceStride: 7 }, twoInstances())).toBeNull()
    expect(parseGrassBin(DOC, new Uint8Array(13))).toBeNull()
    expect(parseGrassBin({ ...DOC, meta: { ...DOC.meta, bounds: undefined } }, twoInstances())).toBeNull()
    expect(parseGrassBin({ ...DOC, meta: { ...DOC.meta, bounds: { min: [0, 0, 0], max: [0, 0, 0] } } }, twoInstances())).toBeNull()
    expect(parseGrassBin(DOC, new Uint8Array(0))).toBeNull()
  })
})

describe('makeGrassMaterial（作者风参数）', () => {
  it('uniforms 取 params 首层；色乘子/alpha 裁切', () => {
    const m = makeGrassMaterial(null, DOC.params, 1.3)
    expect(m.uniforms.uAmp.value).toBeCloseTo(0.3, 6)
    expect(m.uniforms.uSpring.value).toBe(8)
    expect(m.uniforms.uColorMul.value).toBe(2.0)
    expect(m.uniforms.uMaxZ.value).toBeCloseTo(1.3, 6)
    expect(m.side).toBe(THREE.DoubleSide)
    expect(m.transparent).toBe(false)
    expect(m.vertexShader).toMatch(/#include <common>/)
    expect(m.vertexShader).toMatch(/#include <logdepthbuf_pars_vertex>/)
    expect(m.vertexShader).toMatch(/#include <logdepthbuf_vertex>/)
    expect(m.fragmentShader).toMatch(/#include <logdepthbuf_pars_fragment>/)
    expect(m.fragmentShader).toMatch(/#include <logdepthbuf_fragment>/)
    m.dispose()
  })
})

describe('buildGrassMeshes（变体 × 世界分块 InstancedMesh）', () => {
  function protoGeos() {
    const geos = []
    for (let i = 0; i < 4; i++) {
      const g = new THREE.BufferGeometry()
      g.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0, 0.1, 0, 0, 0, 0.1, 1.1], 3))
      g.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, 1, 0, 0, 1], 2))
      g.setIndex([0, 1, 2])
      geos.push(g)
    }
    return geos
  }

  it('同变体同块合并为一个 InstancedMesh；组带 qFrame；高度回调生效', () => {
    const inst = parseGrassBin(DOC, twoInstances())
    const geos = protoGeos()
    const seen = []
    const built = buildGrassMeshes(DOC, inst, geos, {
      heightAt: (x, y) => { seen.push([x, y]); return 12.5 },
      albedo: null,
    })
    expect(built.group.children.length).toBe(2)
    expect(built.group.rotation.order).toBe('YXZ')
    expect(built.group.rotation.y).toBeCloseTo(Math.PI, 6)
    expect(built.group.rotation.x).toBeCloseTo(-Math.PI / 2, 6)
    expect(built.materials.length).toBe(1)
    expect(seen.length).toBe(2)
    const matrices = []
    for (const child of built.group.children) {
      const m = new THREE.Matrix4()
      child.getMatrixAt(0, m)
      matrices.push(m.elements.slice(12, 15))
    }
    for (const t of matrices) expect(t[2]).toBeCloseTo(12.5, 6)
    for (const child of built.group.children) {
      const attr = child.geometry.getAttribute('aVegColor')
      expect(attr).toBeTruthy()
      expect(attr.count).toBe(child.count)
    }
    const children = [...built.group.children]
    const disposeSpies = children.map((c) => vi.spyOn(c, 'dispose'))
    built.dispose()
    expect(built.group.children.length).toBe(0)
    for (const spy of disposeSpies) expect(spy).toHaveBeenCalledTimes(1)
    for (const g of geos) g.dispose()
  })

  it('变体越界被夹到最后一个原型；空原型不建网格', () => {
    const inst = parseGrassBin(DOC, twoInstances())
    const geos = protoGeos().slice(0, 2)
    const built = buildGrassMeshes(DOC, inst.map((i) => ({ ...i, variation: 99 })), geos)
    expect(built.group.children.length).toBeLessThanOrEqual(2)
    for (const child of built.group.children) {
      expect(child.count).toBeGreaterThan(0)
    }
    built.dispose()
    const empty = buildGrassMeshes(DOC, inst, [])
    expect(empty.group.children.length).toBe(0)
    empty.dispose()
    for (const g of geos) g.dispose()
  })
})

describe('buildGrassMeshes 实例预算（G1）', () => {
  function manyInstances(n) {
    const out = new Uint8Array(12 * n)
    for (let i = 0; i < n; i++) {
      const xq = Math.round((i / (n - 1)) * 65535)
      out.set(packInstance(xq, xq, 0, 128, 0, 0), i * 12)
    }
    return out
  }
  function countInstances(built) {
    let n = 0
    for (const child of built.group.children) n += child.count
    return n
  }

  it('maxInstances 等步长抽取（保留首尾分布，不取前缀）', () => {
    const inst = parseGrassBin(DOC, manyInstances(8))
    const geos = [
      new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0, 0.1, 0, 0, 0, 0.1, 1], 3)),
    ]
    const all = buildGrassMeshes(DOC, inst, geos)
    expect(countInstances(all)).toBe(8)
    all.dispose()
    const half = buildGrassMeshes(DOC, inst, geos, { maxInstances: 4 })
    expect(countInstances(half)).toBe(4)
    const xs = []
    for (const child of half.group.children) {
      for (let k = 0; k < child.count; k++) {
        const m = new THREE.Matrix4()
        child.getMatrixAt(k, m)
        xs.push(m.elements[12])
      }
    }
    expect(Math.min(...xs)).toBeLessThan(-250)
    expect(Math.max(...xs)).toBeGreaterThan(150)
    half.dispose()
    geos[0].dispose()
  })

  it('预算 0 / 缺省/负数语义：0 不建网格，缺省全量', () => {
    const inst = parseGrassBin(DOC, manyInstances(4))
    const geo = new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0, 0.1, 0, 0, 0, 0.1, 1], 3))
    const zero = buildGrassMeshes(DOC, inst, [geo], { maxInstances: 0 })
    expect(zero.group.children.length).toBe(0)
    zero.dispose()
    const full = buildGrassMeshes(DOC, inst, [geo], { maxInstances: null })
    expect(countInstances(full)).toBe(4)
    full.dispose()
    geo.dispose()
  })
})
