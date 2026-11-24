// @vitest-environment happy-dom
// 屏幕空间覆盖物原语：恒定线宽、深色描边、点尺寸、resolution 同步与资源释放。
import { describe, expect, it, vi } from 'vitest'
import * as THREE from 'three'
import { Line2 } from 'three/addons/lines/Line2.js'
import {
  createScreenSpaceDot, createScreenSpacePolyline, disposeHitMarker, disposeOverlayObject,
  setOverlayDotColor, updateOverlayResolution,
} from './overlayStroke.js'

function linesOf(group: THREE.Object3D): Line2[] {
  const out: Line2[] = []
  group.traverse((o) => { if (o instanceof Line2) out.push(o) })
  return out
}

describe('overlayStroke · 折线', () => {
  const a = new THREE.Vector3(0, 0, 0)
  const b = new THREE.Vector3(0, 0, 10)

  it('两点折线 = 描边 + 核心两层，线宽/颜色/renderOrder/深度语义固定', () => {
    const group = createScreenSpacePolyline([a, b], {
      color: 0x3ee08a, widthPx: 2, haloWidthPx: 4, haloColor: 0x05070a, haloOpacity: 0.5,
    })!
    expect(group).not.toBeNull()
    const lines = linesOf(group)
    expect(lines).toHaveLength(2)
    const halo = lines.find((l) => (l.material as unknown as { linewidth: number }).linewidth === 4)!
    const core = lines.find((l) => (l.material as unknown as { linewidth: number }).linewidth === 2)!
    expect(halo.renderOrder).toBe(996)
    expect(core.renderOrder).toBe(997)
    expect((halo.material as unknown as { color: THREE.Color }).color.getHex()).toBe(0x05070a)
    expect((core.material as unknown as { color: THREE.Color }).color.getHex()).toBe(0x3ee08a)
    expect(halo.material.opacity).toBe(0.5)
    expect(core.material.opacity).toBe(1)
    for (const line of lines) {
      expect(line.material.toneMapped).toBe(false)
      expect(line.material.depthTest).toBe(false)
      expect(line.frustumCulled).toBe(false)
    }
  })

  it('少于两个点返回 null（不产生空几何）', () => {
    expect(createScreenSpacePolyline([a], { color: 0xffffff })).toBeNull()
  })

  it('dashed：材质开启虚线并生成 instanceDistanceStart', () => {
    const group = createScreenSpacePolyline([a, b], {
      color: 0x00ccff, dashed: true, dashSize: 1.2, gapSize: 0.8,
    })!
    const core = linesOf(group).find((l) => (l.material as unknown as { linewidth: number }).linewidth === 2)!
    expect((core.material as unknown as { dashed: boolean }).dashed).toBe(true)
    expect(core.geometry.attributes.instanceDistanceStart).toBeTruthy()
  })

  it('updateOverlayResolution：写入每个 LineMaterial 的 resolution uniform', () => {
    const group = createScreenSpacePolyline([a, b], { color: 0xffffff })!
    updateOverlayResolution(group, 800, 600)
    for (const line of linesOf(group)) {
      const resolution = (line.material as unknown as { resolution: THREE.Vector2 }).resolution
      expect(resolution.x).toBe(800)
      expect(resolution.y).toBe(600)
    }
    // 非法尺寸不写入（0 高度时保持原值）
    updateOverlayResolution(group, 0, 0)
    expect((linesOf(group)[0].material as unknown as { resolution: THREE.Vector2 }).resolution.x).toBe(800)
  })

  it('disposeOverlayObject 释放几何与材质', () => {
    const group = createScreenSpacePolyline([a, b], { color: 0xffffff })!
    const geometries = linesOf(group).map((l) => l.geometry)
    const materials = linesOf(group).map((l) => l.material)
    const geoSpy = geometries.map((g) => vi.spyOn(g, 'dispose'))
    const matSpy = materials.map((m) => vi.spyOn(m, 'dispose'))
    disposeOverlayObject(group)
    for (const spy of geoSpy) expect(spy).toHaveBeenCalledTimes(1)
    for (const spy of matSpy) expect(spy).toHaveBeenCalledTimes(1)
  })
})

describe('overlayStroke · 圆点', () => {
  it('屏幕空间圆点：size 不随距离衰减、toneMapped false、renderOrder 999', () => {
    const dot = createScreenSpaceDot(new THREE.Vector3(1, 2, 3), 0xff5f52, 9)
    const mat = dot.material as THREE.PointsMaterial
    expect(dot).toBeInstanceOf(THREE.Points)
    expect(mat.size).toBe(9)
    expect(mat.sizeAttenuation).toBe(false)
    expect(mat.toneMapped).toBe(false)
    expect(mat.depthTest).toBe(false)
    expect(mat.color.getHex()).toBe(0xff5f52)
    expect(dot.renderOrder).toBe(999)
    expect(dot.frustumCulled).toBe(false)
  })

  it('size 只传 CSS px，不预乘 DPR（renderer 的 refreshUniformsPoints 会乘一次）', () => {
    const original = window.devicePixelRatio
    try {
      for (const dpr of [1, 2]) {
        Object.defineProperty(window, 'devicePixelRatio', { configurable: true, value: dpr })
        const dot = createScreenSpaceDot(new THREE.Vector3(), 0xffffff, 9)
        expect((dot.material as THREE.PointsMaterial).size).toBe(9)
      }
    } finally {
      Object.defineProperty(window, 'devicePixelRatio', { configurable: true, value: original })
    }
  })

  it('setOverlayDotColor 更新命中点颜色；null 安全', () => {
    const dot = createScreenSpaceDot(new THREE.Vector3(), 0xf5f5f5, 9)
    setOverlayDotColor(dot, 0x3ee08a)
    expect((dot.material as THREE.PointsMaterial).color.getHex()).toBe(0x3ee08a)
    expect(() => setOverlayDotColor(null, 0xffffff)).not.toThrow()
  })

  it('disposeHitMarker 移除并释放全局命中点', () => {
    const scene = new THREE.Scene()
    const dot = createScreenSpaceDot(new THREE.Vector3(), 0xffffff, 9)
    scene.add(dot)
    window.__hitMarker = dot
    const geoSpy = vi.spyOn(dot.geometry, 'dispose')
    const matSpy = vi.spyOn(dot.material as THREE.Material, 'dispose')
    disposeHitMarker(scene)
    expect(scene.children).toHaveLength(0)
    expect(window.__hitMarker).toBeNull()
    expect(geoSpy).toHaveBeenCalledTimes(1)
    expect(matSpy).toHaveBeenCalledTimes(1)
  })
})
