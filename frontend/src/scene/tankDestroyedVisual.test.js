import { describe, expect, it, vi } from 'vitest'
import * as THREE from 'three'
import { patchTankMaterial } from './sceneryMaterials.js'
import { applyTankDestroyedVisual, destroyedVisualAmount, disposeTankDestroyedVisual, prepareTankDestroyedVisual } from './tankDestroyedVisual.js'

const dead = { lifeState: 'DESTROYED', destroyedKnownAtSec: 10 }

describe('destroyed visual replay clock', () => {
  it.each([[9, 0], [10, 0], [10.29, 0], [10.30, 0], [10.55, 0.5], [10.80, 1], [100, 1]])('time %s -> amount %s', (t, amount) => {
    expect(destroyedVisualAmount(dead, t)).toBeCloseTo(amount)
  })
  it('alive/unknown, rewind, missing timestamp and invalid numbers are deterministic', () => {
    expect(destroyedVisualAmount({ lifeState: 'ALIVE' }, 100)).toBe(0)
    expect(destroyedVisualAmount(null, 100)).toBe(0)
    expect(destroyedVisualAmount(dead, 100)).toBe(1)
    expect(destroyedVisualAmount(dead, 9)).toBe(0)
    for (const timestamp of [null, undefined, NaN, Infinity]) {
      expect(destroyedVisualAmount({ lifeState: 'DESTROYED', destroyedKnownAtSec: timestamp }, 20)).toBe(1)
    }
    for (const time of [NaN, Infinity, undefined]) expect(destroyedVisualAmount(dead, time)).toBe(0)
  })
})

function model(material) {
  const root = new THREE.Group()
  const geometry = new THREE.BoxGeometry()
  root.add(new THREE.Mesh(geometry, material), new THREE.Mesh(geometry, [material, material]))
  return root
}
function compile(material, name = 'standard') {
  const shader = { uniforms: {}, fragmentShader: THREE.ShaderLib[name].fragmentShader }
  material.onBeforeCompile(shader, {})
  return shader
}

describe('per-vehicle destroyed material ownership', () => {
  it('isolates two copies while retaining geometry, texture and same-vehicle material reuse', () => {
    const texture = new THREE.Texture()
    const source = new THREE.MeshStandardMaterial({ map: texture, roughness: 0.9, metalness: 0.8, emissive: 0x224466, opacity: 0.8 })
    const template = model(source)
    const a = template.clone(), b = template.clone()
    const va = prepareTankDestroyedVisual(a), vb = prepareTankDestroyedVisual(b)
    const ma = a.children[0].material, mb = b.children[0].material
    const initialEmissive = source.emissive.clone()
    const version = ma.version, key = ma.customProgramCacheKey()
    const shader = compile(ma)
    applyTankDestroyedVisual(va, 0.5)
    expect(shader.uniforms.uDestroyedAmount.value).toBe(0.5)
    applyTankDestroyedVisual(va, 1)
    expect(ma.roughness).toBe(1)
    expect(ma.metalness).toBeCloseTo(0.24)
    expect(ma.emissive.getHex()).toBe(0)
    expect(ma.opacity).toBe(0.8)
    expect(ma.color.equals(source.color)).toBe(true)
    expect(mb.roughness).toBe(0.9)
    expect(vb.materials[0].uniform.value).toBe(0)
    expect(source.roughness).toBe(0.9)
    expect(source.userData.__tankAmbientFixed).toBeUndefined()
    expect(ma).not.toBe(mb)
    expect(a.children[1].material).toEqual([ma, ma])
    expect(va.materials).toHaveLength(1)
    expect(ma.map).toBe(texture)
    expect(a.children[0].geometry).toBe(template.children[0].geometry)
    applyTankDestroyedVisual(va, 0)
    expect(ma.roughness).toBe(0.9)
    expect(ma.metalness).toBe(0.8)
    expect(ma.emissive.equals(initialEmissive)).toBe(true)
    expect(ma.version).toBe(version)
    expect(ma.customProgramCacheKey()).toBe(key)
  })

  it('composes existing shader hook/cache key and tank lighting, including patched templates', () => {
    const source = new THREE.MeshStandardMaterial()
    source.onBeforeCompile = vi.fn(shader => { shader.fragmentShader += '\n// previous hook' })
    source.customProgramCacheKey = () => 'existing-variant'
    patchTankMaterial(source)
    const root = model(source)
    prepareTankDestroyedVisual(root)
    const material = root.children[0].material
    const shader = compile(material)
    expect(shader.fragmentShader).toContain('// previous hook')
    expect(shader.fragmentShader.match(/irradiance = vec3/g)).toHaveLength(1)
    expect(shader.fragmentShader).toContain('uniform float uDestroyedAmount;')
    expect(shader.fragmentShader.indexOf('destroyedLuma')).toBeGreaterThan(shader.fragmentShader.indexOf('vec3 outgoingLight'))
    expect(shader.fragmentShader.indexOf('destroyedLuma')).toBeLessThan(shader.fragmentShader.indexOf('#include <opaque_fragment>'))
    expect(material.customProgramCacheKey()).toBe('existing-variant|tank-noambient|tank-destroyed-v1')
    expect(source.onBeforeCompile).not.toBe(material.onBeforeCompile)
  })

  it('proxy uses the same shader without changing the author ring', () => {
    const source = new THREE.MeshLambertMaterial({ color: 0x336699 })
    const root = model(source)
    const ring = new THREE.Mesh(new THREE.RingGeometry(), new THREE.MeshBasicMaterial({ color: 0xe8b23c }))
    ring.userData.keepWithGlb = true
    root.add(ring)
    const hook = ring.material.onBeforeCompile, color = ring.material.color.clone()
    const visual = prepareTankDestroyedVisual(root, { cloneMaterials: false })
    const shader = compile(source, 'lambert')
    applyTankDestroyedVisual(visual, 1)
    expect(shader.uniforms.uDestroyedAmount.value).toBe(1)
    expect(root.children[0].material).toBe(source)
    expect(ring.material.onBeforeCompile).toBe(hook)
    expect(ring.material.color.equals(color)).toBe(true)
    expect(visual.materials).toHaveLength(1)
    applyTankDestroyedVisual(visual, NaN)
    expect(shader.uniforms.uDestroyedAmount.value).toBe(0)
  })

  it('disposes each owned clone once and leaves borrowed textures/geometry/template intact', () => {
    const texture = new THREE.Texture(), source = new THREE.MeshStandardMaterial({ map: texture })
    const template = model(source)
    const disposeTexture = vi.spyOn(texture, 'dispose'), disposeGeometry = vi.spyOn(template.children[0].geometry, 'dispose')
    const disposeSource = vi.spyOn(source, 'dispose')
    for (let i = 0; i < 3; i++) {
      const visual = prepareTankDestroyedVisual(template.clone())
      const dispose = vi.spyOn(visual.materials[0].material, 'dispose')
      disposeTankDestroyedVisual(visual)
      disposeTankDestroyedVisual(visual)
      expect(dispose).toHaveBeenCalledTimes(1)
      expect(visual.materials).toHaveLength(0)
    }
    expect(disposeTexture).not.toHaveBeenCalled()
    expect(disposeGeometry).not.toHaveBeenCalled()
    expect(disposeSource).not.toHaveBeenCalled()
  })
})
