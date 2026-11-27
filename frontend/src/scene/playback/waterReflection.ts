import * as THREE from 'three'

export const WATER_REFLECTION_SCALE = 0.5
const CLIP_BIAS = 0.003

export interface WaterReflectionOptions {
  getWaterMeshes: () => THREE.Object3D[] | null | undefined
  getWaterLevel: () => number | null | undefined
  scale?: number
  intervalFrames?: number
  getExcludedRoots?: () => Array<THREE.Object3D | null | undefined> | null | undefined
}

export interface WaterReflection {
  update(renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.PerspectiveCamera, timer?: { begin(pass: string): boolean; end(): void } | null): void
  setEnabled(on: boolean): void
  requestRefresh(): void
  configure(options: { scale?: number; intervalFrames?: number }): void
  debugTarget(): THREE.WebGLRenderTarget | null
  dispose(): void
}

export function mirrorCameraForPlane(
  camera: THREE.PerspectiveCamera,
  level: number,
  out: THREE.PerspectiveCamera,
): boolean {
  if (!Number.isFinite(level) || !(camera.position.y > level + 1e-3)) return false
  out.position.set(camera.position.x, 2 * level - camera.position.y, camera.position.z)
  const forward = new THREE.Vector3()
  camera.getWorldDirection(forward)
  forward.y *= -1
  const rotation = new THREE.Matrix4().extractRotation(camera.matrixWorld)
  const up = new THREE.Vector3(0, 1, 0).applyMatrix4(rotation)
  up.y *= -1
  if (Math.abs(up.dot(forward)) > 0.9999) return false
  out.up.copy(up)
  out.lookAt(out.position.clone().add(forward))
  out.near = camera.near
  out.far = camera.far
  out.fov = camera.fov
  out.aspect = camera.aspect
  out.updateProjectionMatrix()
  out.updateMatrixWorld(true)
  out.matrixWorldInverse.copy(out.matrixWorld).invert()

  const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -level)
  plane.applyMatrix4(out.matrixWorldInverse)
  const clip = new THREE.Vector4(plane.normal.x, plane.normal.y, plane.normal.z, plane.constant)
  const pm = out.projectionMatrix
  const q = new THREE.Vector4(
    (Math.sign(clip.x) + pm.elements[8]) / pm.elements[0],
    (Math.sign(clip.y) + pm.elements[9]) / pm.elements[5],
    -1.0,
    (1.0 + pm.elements[10]) / pm.elements[14],
  )
  const denom = clip.dot(q)
  if (!Number.isFinite(denom) || Math.abs(denom) < 1e-8) return false
  clip.multiplyScalar(2.0 / denom)
  pm.elements[2] = clip.x
  pm.elements[6] = clip.y
  pm.elements[10] = clip.z + 1.0 - CLIP_BIAS
  pm.elements[14] = clip.w
  out.projectionMatrixInverse.copy(pm).invert()
  return true
}

export function createWaterReflection({
  getWaterMeshes,
  getWaterLevel,
  getExcludedRoots,
  scale = WATER_REFLECTION_SCALE,
  intervalFrames = 1,
}: WaterReflectionOptions): WaterReflection {
  let enabled = false
  let frame = 0
  let forceRefresh = false
  let rtScale = scale
  let updateInterval = Math.max(1, Math.floor(intervalFrames) || 1)
  let target: THREE.WebGLRenderTarget | null = null
  let targetW = 0
  let targetH = 0
  const virtualCamera = new THREE.PerspectiveCamera()
  const reflectionMatrix = new THREE.Matrix4()
  const materials = new Set<THREE.ShaderMaterial>()
  const lastReflectionTex: { value: unknown } = { value: null }
  const waterBounds = new THREE.Box3()
  const frustum = new THREE.Frustum()
  const projScreen = new THREE.Matrix4()
  let boundsKey: THREE.Object3D[] | null = null
  let boundsValid = false
  let lastWaterVisible = true

  function collectMaterials(meshes: THREE.Object3D[]): void {
    for (const mesh of meshes) {
      const m = mesh as THREE.Mesh
      const list = Array.isArray(m.material) ? m.material : (m.material ? [m.material] : [])
      for (const mat of list) {
        const sm = mat as THREE.ShaderMaterial
        if (sm?.uniforms && sm.uniforms.uReflectionTex) materials.add(sm)
      }
    }
  }

  function refreshWaterBounds(meshes: THREE.Object3D[]): void {
    if (boundsKey === meshes) return
    boundsKey = meshes
    boundsValid = false
    waterBounds.makeEmpty()
    let boxes = 0
    for (const mesh of meshes) {
      const geometry = (mesh as THREE.Mesh).geometry
      if (!geometry || typeof geometry.computeBoundingBox !== 'function') return
      mesh.updateWorldMatrix(true, false)
      if (!geometry.boundingBox) geometry.computeBoundingBox()
      const box = geometry.boundingBox
      if (!box || box.isEmpty()) return
      const world = box.clone().applyMatrix4(mesh.matrixWorld)
      const e = world.min
      const f = world.max
      if (![e.x, e.y, e.z, f.x, f.y, f.z].every(Number.isFinite)) return
      waterBounds.union(world)
      boxes++
    }
    if (!boxes || waterBounds.isEmpty()) return
    boundsValid = true
  }

  function waterProbablyVisible(camera: THREE.PerspectiveCamera, meshes: THREE.Object3D[]): boolean {
    camera.updateMatrixWorld()
    refreshWaterBounds(meshes)
    if (!boundsValid) return true
    frustum.setFromProjectionMatrix(projScreen.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse))
    return frustum.intersectsBox(waterBounds)
  }

  function ensureTarget(renderer: THREE.WebGLRenderer): void {
    const size = renderer.getDrawingBufferSize(new THREE.Vector2())
    const factor = THREE.MathUtils.clamp(rtScale, 0.25, 1)
    const w = Math.max(64, Math.floor(size.x * factor))
    const h = Math.max(64, Math.floor(size.y * factor))
    if (target && targetW === w && targetH === h) return
    target?.dispose()
    target = new THREE.WebGLRenderTarget(w, h, {
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      format: THREE.RGBAFormat,
      type: THREE.UnsignedByteType,
      depthBuffer: true,
      stencilBuffer: false,
    })
    target.texture.colorSpace = THREE.SRGBColorSpace
    targetW = w
    targetH = h
    lastReflectionTex.value = target.texture
    for (const mat of materials) mat.uniforms.uReflectionTex.value = target.texture
  }

  return {
    update(renderer, scene, camera, timer) {
      if (!enabled) return
      frame++
      const scheduled = forceRefresh || updateInterval <= 1 || (frame - 1) % updateInterval === 0
      const level = getWaterLevel()
      const meshes = getWaterMeshes()
      if (level == null || !meshes || !meshes.length) {
        lastWaterVisible = false
        if (scheduled) {
          forceRefresh = false
          for (const mat of materials) mat.uniforms.uUseReflection.value = 0
        }
        return
      }
      const visible = waterProbablyVisible(camera, meshes)
      const reentered = visible && !lastWaterVisible
      lastWaterVisible = visible
      if (!scheduled && !reentered) return
      if (!visible) return
      forceRefresh = false
      collectMaterials(meshes)
      if (!mirrorCameraForPlane(camera, level, virtualCamera)) {
        for (const mat of materials) mat.uniforms.uUseReflection.value = 0
        return
      }
      reflectionMatrix.set(
        0.5, 0, 0, 0.5,
        0, 0.5, 0, 0.5,
        0, 0, 0.5, 0.5,
        0, 0, 0, 1,
      )
      reflectionMatrix.multiply(virtualCamera.projectionMatrix)
      reflectionMatrix.multiply(virtualCamera.matrixWorldInverse)
      ensureTarget(renderer)
      if (!target) return

      const excluded = (getExcludedRoots?.() || []).filter((o): o is THREE.Object3D => !!o)
      const prevVisible = meshes.map((m) => m.visible)
      for (const m of meshes) m.visible = false
      const prevExcluded = excluded.map((o) => o.visible)
      for (const o of excluded) o.visible = false
      const prevTarget = renderer.getRenderTarget()
      renderer.setRenderTarget(target)
      try {
        const activeTimer = timer?.begin('reflection') ? timer : null
        try {
          renderer.render(scene, virtualCamera)
        } finally {
          activeTimer?.end()
        }
      } finally {
        renderer.setRenderTarget(prevTarget)
        meshes.forEach((m, i) => { m.visible = prevVisible[i] })
        excluded.forEach((o, i) => { o.visible = prevExcluded[i] })
      }
      for (const mat of materials) {
        mat.uniforms.uReflectionTex.value = target.texture
        mat.uniforms.uUseReflection.value = 1
        if (mat.uniforms.uReflectionMatrix) mat.uniforms.uReflectionMatrix.value.copy(reflectionMatrix)
      }
    },
    setEnabled(on) {
      enabled = on
      if (!on) {
        for (const mat of materials) {
          mat.uniforms.uUseReflection.value = 0
          if (mat.uniforms.uReflectionTex) mat.uniforms.uReflectionTex.value = null
        }
        target?.dispose()
        target = null
        targetW = 0
        targetH = 0
        lastReflectionTex.value = null
        frame = 0
        forceRefresh = false
      }
    },
    requestRefresh() {
      forceRefresh = true
    },
    configure(options) {
      if (typeof options?.scale === 'number' && Number.isFinite(options.scale)) rtScale = options.scale
      if (typeof options?.intervalFrames === 'number' && Number.isFinite(options.intervalFrames)) {
        updateInterval = Math.max(1, Math.floor(options.intervalFrames) || 1)
      }
    },
    debugTarget: () => target,
    dispose() {
      for (const mat of materials) mat.uniforms.uUseReflection.value = 0
      materials.clear()
      target?.dispose()
      target = null
      targetW = 0
      targetH = 0
      frame = 0
      forceRefresh = false
    },
  }
}
