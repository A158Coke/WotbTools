// 水面 HIGH/ULTRA 档：动态平面反射（客户端 `REAL_REFLECTION` 的查看器实现）。
//
// 客户端 HIGH = `PIXEL_LIT + REAL_REFLECTION + FRESNEL_TO_ALPHA`：反射来自**当帧场景**
// （water-fp.sl 采样 dynamicReflection，投影坐标 + 波法线 × reflectionDistortion）。
// 本模块用镜像相机把场景渲进半分辨率 RT，水面着色时按屏幕 UV 取样；MEDIUM 档仍用
// 逐图 cubemap（uUseReflection=0，行为不变）。
//
// 边界：水面自身在反射 pass 中隐藏（否则镜像相机会看到背面）；斜裁剪面只保留水面
// 以上几何（防止水下地形/倒影穿帮）。未启用/无水面/相机在水下时跳过，不产生 RT。
import * as THREE from 'three'

/** RT 相对主画面尺寸（客户端 HIGH 档用半分辨率）。 */
export const WATER_REFLECTION_SCALE = 0.5
/** 斜裁剪面深度偏置（防共面漏光）。 */
const CLIP_BIAS = 0.003

export interface WaterReflectionOptions {
  getWaterMeshes: () => THREE.Object3D[] | null | undefined
  getWaterLevel: () => number | null | undefined
  /** RT 相对主画面比例（画质档表；缺省 0.5） */
  scale?: number
  /** 反射 pass 更新间隔帧数（1 = 每帧；≤0 按 1 处理） */
  intervalFrames?: number
  /** 反射 pass 期间隐藏的覆盖层根（草/战斗特效/标注；缺省无） */
  getExcludedRoots?: () => Array<THREE.Object3D | null | undefined> | null | undefined
}

export interface WaterReflection {
  /** 每帧主渲染前调用；内部负责 resize / 镜像渲染 / uniform 回填。 */
  update(renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.PerspectiveCamera): void
  setEnabled(on: boolean): void
  /** 请求下一帧强制刷新一次（seek / 按需渲染的单次 dirty frame；不受隔帧间隔限制）。 */
  requestRefresh(): void
  /** 运行时按画质档调整 RT 比例/更新间隔（RT 尺寸在下一帧按新比例惰性重建）。 */
  configure(options: { scale?: number; intervalFrames?: number }): void
  /** 诊断/单测：当前反射 RT（未创建时为 null）。 */
  debugTarget(): THREE.WebGLRenderTarget | null
  dispose(): void
}

/**
 * 水平镜面（世界 y=level）的镜像相机（纯函数，单测锚点）。
 * 相机在水面以下 / 与水面重合时返回 false（不产生无效反射）。
 */
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
  // up 必须取**相机实际朝向基**（matrixWorld 的 Y 列），不能取 `camera.up` 配置值：
  // 正俯视时配置值仍是 (0,1,0)，与反射后的 forward 共线 ⇒ lookAt NaN。Reflector 同式。
  const rotation = new THREE.Matrix4().extractRotation(camera.matrixWorld)
  const up = new THREE.Vector3(0, 1, 0).applyMatrix4(rotation)
  up.y *= -1
  // 真正的退化（反射后 up 与 forward 共线）才 fail-closed；正常正俯视不会命中。
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

  // 斜近裁剪面：把 near plane 贴到水面上（Reflector 同式），只保留水面上方几何。
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
  // bias × 镜像相机 VP：把世界坐标投到反射 RT 的 [0,1] 纹理坐标（Reflector 同式）
  const reflectionMatrix = new THREE.Matrix4()
  const materials = new Set<THREE.ShaderMaterial>()
  const lastReflectionTex: { value: unknown } = { value: null }

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
    // 与主画面同一个输出色彩空间（否则倒影会整体偏亮/偏暗）
    target.texture.colorSpace = THREE.SRGBColorSpace
    targetW = w
    targetH = h
    lastReflectionTex.value = target.texture
    for (const mat of materials) mat.uniforms.uReflectionTex.value = target.texture
  }

  return {
    update(renderer, scene, camera) {
      if (!enabled) return
      frame++
      // 画质档可把反射降为隔帧更新（W3）：跳过帧保留上一张 RT/uniform，不重建。
      // 但按需渲染的 seek/相机静止场景只有一次 dirty frame，不能吞掉——requestRefresh
      // 让该帧无条件刷新；否则反射会停在 seek 前的车辆位置（下一次 rAF 也不再画）。
      const due = forceRefresh || updateInterval <= 1 || (frame - 1) % updateInterval === 0
      forceRefresh = false
      if (!due) return
      const level = getWaterLevel()
      const meshes = getWaterMeshes()
      if (level == null || !meshes || !meshes.length) {
        for (const mat of materials) mat.uniforms.uUseReflection.value = 0
        return
      }
      collectMaterials(meshes)
      if (!mirrorCameraForPlane(camera, level, virtualCamera)) {
        // 相机在水下/正俯视：本帧回退 cubemap，避免采样上一帧的旧 RT。
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

      // 反射 pass 的覆盖层剔除（W3）：草/战斗特效/标注原本直接进镜像 RT，
      // 既抬高填充成本，也让贴地标注在水里出现镜像副本；渲染期临时隐藏、随后恢复。
      const excluded = (getExcludedRoots?.() || []).filter((o): o is THREE.Object3D => !!o)
      const prevVisible = meshes.map((m) => m.visible)
      for (const m of meshes) m.visible = false
      const prevExcluded = excluded.map((o) => o.visible)
      for (const o of excluded) o.visible = false
      const prevTarget = renderer.getRenderTarget()
      renderer.setRenderTarget(target)
      try {
        renderer.render(scene, virtualCamera)
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
        // 关档即释放 RT（W3 验收：切档后无残留 RT）；再开档在下一帧按当前比例重建。
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
