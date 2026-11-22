// 录像者 Sniper 视角的单目标穿深着色。装甲规则与着色器全部复用装甲查看器
// （viewer/armorPlateModel.js + viewer/armorShaders.js），本模块只负责：资格判定、
// 选目标、把 armor 网格摆到**画面上那台车的实际姿态**，以及在主渲染之后叠加 pass。
//
// 主渲染完全不动：关闭/不满足资格时零额外 pass。叠加顺序：
//   ① 间隙甲状态/厚度 RT（标准深度）
//   ② 清深度后重画不透明世界的深度——装甲网格在视觉外壳内侧，若沿用主渲染深度，
//      目标自己的车模会把装甲挡住；重画时排除目标，遮挡就只来自真实世界几何
//   ③ primary 排除深度 + 着色
import * as THREE from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import type { Box3, Frustum, Group, Material, Mesh, Object3D, PerspectiveCamera, Scene, Sphere, WebGLRenderer } from 'three'
import type { AimedVehicleCandidate } from './armorHighlightPick.js'
import { bucketedRtSize, cropFrustum, OCCLUDER_LAYER, screenRect, spacedRectOf } from './armorHighlightPick.js'
import { createArmorTargets } from './armorHighlightTargets.js'
import type { BuiltTarget } from './armorHighlightTargets.js'
import { createLoadRetry } from './armorHighlightPolicy.js'
import type { ArmorHighlightFrame, ArmorHighlightPerfStats, ArmorRenderTargetStats } from './armorHighlightTypes.js'
import { createArmorShaderContext, createDepthStencilTexture, standardDepthMaterial } from '../viewer/armorShaders.js'
import { useFaceNormals } from '../viewer/armorPlateModel.js'

/** 重画世界深度专用 layer（owner = armorHighlightPick；本处 re-export）。 */
export { OCCLUDER_LAYER } from './armorHighlightPick.js'
/** 裁剪矩形外扩的像素：包住光栅化取整，矩形边上不留缝。 */
const SCISSOR_MARGIN_PX = 2

const _occluderSphere = new THREE.Sphere()
const _occluderOffset = new THREE.Vector3()
/** `view` = {frustum, origin, forward, maxDepth}：物体落在目标屏幕矩形外或完全在目标之后就挡不住它。 */
/** 遮挡剔除的视锥视图（cropFrustum 产出 + 目标深度上界）。 */
export interface OccluderView {
  frustum: Frustum
  origin: THREE.Vector3
  forward: THREE.Vector3
  maxDepth: number
}

const _occluderBox = new THREE.Box3()
const _occluderHalf = new THREE.Vector3()
export function canOccludeTarget(object: Object3D, view: OccluderView): boolean {
  if (object.frustumCulled === false) return true
  const withGeometry = object as Object3D & Partial<Mesh> & { boundingSphere?: Sphere | null }
  // 悬挂形变后的 bounds 只在拾取时刷新，友军履带等非候选车辆可能还是旧值，不能据此剔除
  if (withGeometry.geometry?.userData?.pickBoundsStale) return true
  // InstancedMesh 批次优先用批次世界 AABB（refreshBatchSphere 产出的 userData.occluderBox，
  // 局部系批次盒——宫格批次的包围球是整格尺寸，远目标长视锥会把整批实例拉进遮挡集；
  // AABB 是保守包围，只少画不漏画。可破坏物批次（实例矩阵运行期会变）置 null 回退球。
  const occluderBox = (object.userData as { occluderBox?: THREE.Box3 | null } | undefined)?.occluderBox
  if (occluderBox) {
    _occluderBox.copy(occluderBox).applyMatrix4(object.matrixWorld)
    if (!view.frustum.intersectsBox(_occluderBox)) return false
    _occluderHalf.subVectors(_occluderBox.max, _occluderBox.min).multiplyScalar(0.5)
    const depth = _occluderOffset
      .set(
        (_occluderBox.min.x + _occluderBox.max.x) / 2,
        (_occluderBox.min.y + _occluderBox.max.y) / 2,
        (_occluderBox.min.z + _occluderBox.max.z) / 2,
      )
      .sub(view.origin)
      .dot(view.forward)
      - _occluderHalf.x * Math.abs(view.forward.x)
      - _occluderHalf.y * Math.abs(view.forward.y)
      - _occluderHalf.z * Math.abs(view.forward.z)
    return depth <= view.maxDepth
  }
  // InstancedMesh 的包围球在对象上，几何上的只是单个实例；未算出时不能回落到几何
  const sphere = withGeometry.boundingSphere !== undefined ? withGeometry.boundingSphere : withGeometry.geometry?.boundingSphere
  if (!sphere) return true
  _occluderSphere.copy(sphere).applyMatrix4(object.matrixWorld)
  if (!view.frustum.intersectsSphere(_occluderSphere)) return false
  const depth = _occluderOffset.subVectors(_occluderSphere.center, view.origin).dot(view.forward)
  return depth - _occluderSphere.radius <= view.maxDepth
}

/** 能挡住炮弹视线的世界几何：不透明、写深度，且不是植被（树丛不挡弹）。 */
export function isSolidOccluder(object: Object3D): boolean {
  const mesh = object as Mesh
  const materials = Array.isArray(mesh.material) ? mesh.material : (mesh.material ? [mesh.material] : [])
  return materials.every((m) => !!m && !m.transparent && m.depthWrite !== false && !(m as Material & { uniforms?: Record<string, unknown> }).uniforms?.uFoliageClip)
}

/** 炮塔/炮管 armor 网格跟随的姿态：与 glbParts 的 poseT/poseG 一一对应。 */

/** render(frame) 的装配参数（宿主 renderArmorHighlight 现取现传）。 */
export function createArmorHighlight({ renderer, assetProvider }: {
  renderer: WebGLRenderer
  /** logical asset API（scene/assetProvider 的结构面） */
  assetProvider: { bytes(path: string): Promise<Uint8Array> }
}): { render(frame: ArmorHighlightFrame): void; prefetch(vehicles: AimedVehicleCandidate[]): void; prewarm(camera: PerspectiveCamera): void; releaseRenderTargets(): void; dispose(): void } {
  const shaders = createArmorShaderContext()
  const templates = new Map<number, Promise<Object3D | null>>()    // tankId → Promise<armor 模板 | null>
  const targets = new Map<number, { glb: Group; armor: BuiltTarget | null }>()      // eid → 已构建的目标（外部模块引用该车的 GLB 实例）
  const pending = new Set<number>()
  const templateRetry = createLoadRetry()
  const excludeMaterial = new THREE.MeshBasicMaterial({ colorWrite: false, depthTest: true, depthWrite: true })
  const occluderMaterial = new THREE.MeshBasicMaterial({ colorWrite: false, side: THREE.DoubleSide })
  const depthMaterials = {
    omit: standardDepthMaterial(),
    spacedOmit: standardDepthMaterial(THREE.DoubleSide),
    externalDepth: standardDepthMaterial(),
  }
  let stateRT: THREE.WebGLRenderTarget | null = null, spacedRT: THREE.WebGLRenderTarget | null = null
  let rtStats: ArmorRenderTargetStats | null = null
  const size = new THREE.Vector2()
  const clearColor = new THREE.Color()
  const world = new THREE.Vector3()
  const clipMatrix = new THREE.Matrix4()
  const identity = new THREE.Matrix4()
  const clipNormal = new THREE.Vector3(0, 1, 0)
  const clipPoint = new THREE.Vector3()
  // 目标生命周期 owner（#LOC 结构拆分出仓 armorHighlightTargets.ts；GPU/模板缓存仍在本工厂）
  const armorTargets = createArmorTargets({
    shaders,
    depthMaterials,
    excludeMaterial,
    targets,
    pending,
    templateRetry,
    isDisposed: () => disposed,
    loadTemplate,
    identity,
    clipNormal,
    clipPoint,
    clipMatrix,
    world,
  })
  const armorBox = new THREE.Box3()
  const armorSphere = new THREE.Sphere()
  const scissor = new THREE.Vector4()
  const savedScissor = new THREE.Vector4()
  const savedViewport = new THREE.Vector4()
  const occluderView = {
    frustum: new THREE.Frustum(), origin: new THREE.Vector3(), forward: new THREE.Vector3(), maxDepth: 0,
  }
  // 辅助 RT pass 的视口偏移相机（主相机的拷贝 + setViewOffset 到目标矩形）；color pass 仍用主相机。
  const armorCamera = new THREE.PerspectiveCamera()
  const spacedRect = new THREE.Vector4(0, 0, 1, 1)
  /** ?perf 逐 pass 计时：renderer.render 返回 ≠ GPU 完成，这些是 CPU submit 时间。 */
  function passBegin(stats: ArmorHighlightPerfStats | null): number {
    if (!stats) return 0
    stats._t0 = performance.now()
    return renderer.info.render.calls
  }
  function passEnd(stats: ArmorHighlightPerfStats | null, key: 'stateMs' | 'thicknessMs' | 'occluderMs' | 'colorMs', callKey: 'stateCalls' | 'thicknessCalls' | 'occluderCalls' | 'colorCalls', beginCalls: number): void {
    if (!stats) return
    stats[key] += performance.now() - stats._t0
    const calls = renderer.info.render.calls - beginCalls
    stats[callKey] += calls
    stats.calls += calls
  }
  function renderPass(frame: ArmorHighlightFrame, pass: 'state' | 'thickness' | 'occluder' | 'color', scene: Scene, camera: PerspectiveCamera): void {
    const started = frame.gpu?.begin(pass) ?? false
    try { renderer.render(scene, camera) } finally { if (started) frame.gpu?.end() }
  }

  function loadTemplate(tankId: number, url: string): Promise<Object3D | null> {
    const cached = templates.get(tankId)
    if (cached) return cached
    const promise: Promise<Object3D | null> = assetProvider.bytes(url)
      .then((bytes) => new Promise<Object3D | null>((resolve) => {
        new GLTFLoader().parse(bytes.buffer as ArrayBuffer, '', (gltf) => resolve(gltf.scene), () => resolve(null))
      }))
      .then((model) => { if (model) useFaceNormals(model); return model })
      .catch((error) => { console.warn('[playback] armor 模型加载失败 tank_id=' + tankId + ':', error); return null })
      .then((model) => {
        if (model) templateRetry.succeed(tankId)
        else { templates.delete(tankId); templateRetry.fail(tankId) }
        return model
      })
    templates.set(tankId, promise)
    return promise
  }

  function ensureTargets(rtW: number, rtH: number, shrinking = false): void {
    if (stateRT && stateRT.width >= rtW && stateRT.height >= rtH) return
    const resizing = shrinking || stateRT !== null
    disposeTargets()
    const floatCapable = renderer.extensions.has('EXT_color_buffer_float')
      || renderer.extensions.has('EXT_color_buffer_half_float')
    const options = () => ({
      type: floatCapable ? THREE.HalfFloatType : THREE.UnsignedByteType,
      depthTexture: new THREE.DepthTexture(rtW, rtH),
    })
    stateRT = new THREE.WebGLRenderTarget(rtW, rtH, options())
    // stencilBuffer：厚度通道开放间隙板 front 写/back 测的同板去重位（与装甲查看器
    // penetrationRT 同语义；stateRT 深度独占不需要）。深度纹理由
    // createDepthStencilTexture 统一构造（DepthStencilFormat）；本 RT 每次尺寸变化都
    // 整体重建，不存在「原地替换深度纹理」路径。
    spacedRT = new THREE.WebGLRenderTarget(rtW, rtH, { ...options(), depthTexture: createDepthStencilTexture(rtW, rtH), stencilBuffer: true })
    if (rtStats) {
      rtStats.creates += 2
      if (resizing) rtStats.resizes += 2
      rtStats.width = rtW
      rtStats.height = rtH
      // 仅两张 RGBA 颜色纹理；不包含 depth texture、驱动填充或真实显存占用。
      rtStats.colorEstimateBytes = rtW * rtH * 2 * (floatCapable ? 8 : 4)
    }
  }

  function bindBuffers(target: BuiltTarget, camera: PerspectiveCamera, spacedRect: THREE.Vector4): void {
    const rt = stateRT as THREE.WebGLRenderTarget
    const spaced = spacedRT as THREE.WebGLRenderTarget
    const satGuard = rt.texture.type === THREE.HalfFloatType ? 0 : 1
    target.color.traverse((node: THREE.Object3D) => {
      const meshNode = node as Mesh
      const u = meshNode.isMesh
        ? (meshNode.material as Material & { uniforms?: Record<string, { value: unknown }> }).uniforms
        : undefined
      if (!u || !u.spacedArmorBuffer) return
      u.spacedArmorBuffer.value = spaced.texture
      u.spacedStateBuffer.value = rt.texture
      u.spacedArmorDepth.value = spaced.depthTexture
      u.spacedSatGuard.value = satGuard
      u.inverseProjectionMatrix.value = camera.projectionMatrixInverse
      if (u.spacedRect) u.spacedRect.value = spacedRect.clone()
    })
  }

  /** 目标 armor 的世界包围盒（逐块按本帧姿态，炮塔转动后仍贴合）。 */
  function armorBounds(target: BuiltTarget): Box3 {
    armorBox.makeEmpty()
    for (const clone of target.clones) {
      if (!clone.geometry.boundingSphere) clone.geometry.computeBoundingSphere()
      const cloneSphere = clone.geometry.boundingSphere as THREE.Sphere
      armorSphere.copy(cloneSphere).applyMatrix4(clone.matrix)
      armorBox.expandByPoint(world.copy(armorSphere.center).addScalar(armorSphere.radius))
      armorBox.expandByPoint(world.copy(armorSphere.center).subScalar(armorSphere.radius))
    }
    return armorBox
  }

  /** NDC 矩形 → 绘制缓冲像素（外扩后钳到缓冲内）。 */
  function scissorRect(rect: { x0: number; y0: number; x1: number; y1: number }): THREE.Vector4 {
    const left = Math.max(Math.floor((rect.x0 + 1) / 2 * size.x) - SCISSOR_MARGIN_PX, 0)
    const bottom = Math.max(Math.floor((rect.y0 + 1) / 2 * size.y) - SCISSOR_MARGIN_PX, 0)
    const right = Math.min(Math.ceil((rect.x1 + 1) / 2 * size.x) + SCISSOR_MARGIN_PX, size.x)
    const top = Math.min(Math.ceil((rect.y1 + 1) / 2 * size.y) + SCISSOR_MARGIN_PX, size.y)
    return scissor.set(left, bottom, right - left, top - bottom)
  }

  /** 目标整棵子树不进遮挡集：否则目标车模自己挡住装甲。 */
  function markOccluders(camera: PerspectiveCamera, vehicle: ArmorHighlightFrame['vehicle'], view: OccluderView, roots: Object3D[]): number {
    // 语义化遮挡根（调用方给：地形/场景 GLB/占位地面/每车低模组、GLB/飞炮塔），不做全场景
    // traverseVisible——特效/轨迹/标注/基地/边界/天穹都是透明、非网格或无穷远，本来就
    // 挡不住弹道，从遍历里省掉（遮挡语义不变：墙体/车辆遮挡、树丛不遮挡）。
    let count = 0
    for (const root of roots) {
      if (!root || !root.visible) continue
      root.traverseVisible((object) => {
        const meshNode = object as Mesh
        if (!meshNode.isMesh) return
        let ancestor: Object3D | null = object
        while (ancestor && ancestor !== vehicle.glb && ancestor !== vehicle.group) ancestor = ancestor.parent
        if (ancestor) { object.layers.disable(OCCLUDER_LAYER); return }
        if (object.layers.test(camera.layers) && isSolidOccluder(object) && canOccludeTarget(object, view)) {
          object.layers.enable(OCCLUDER_LAYER)
          count++
        } else object.layers.disable(OCCLUDER_LAYER)
      })
    }
    vehicle.glb.traverse((node) => node.layers.disable(OCCLUDER_LAYER))
    vehicle.group?.traverse((node) => node.layers.disable(OCCLUDER_LAYER))
    return count
  }

  function drawOccluderDepth(frame: ArmorHighlightFrame, view: OccluderView, roots: Object3D[]): void {
    const { scene, camera, vehicle } = frame
    const count = markOccluders(camera, vehicle, view, roots)
    // 零遮挡快速路径：走廊内没有任何能挡住目标的实体（开阔地直射的常见形态），
    // clearDepth 已把目标矩形深度清空——装甲不被任何世界几何挡住，跳过整个世界重绘。
    if (count === 0) return
    const mask = camera.layers.mask, background = scene.background, overrideMaterial = scene.overrideMaterial
    camera.layers.set(OCCLUDER_LAYER)
    scene.background = null
    scene.overrideMaterial = occluderMaterial
    try { renderPass(frame, 'occluder', scene, camera) } finally {
      scene.overrideMaterial = overrideMaterial
      scene.background = background
      camera.layers.mask = mask
    }
  }

  let disposed = false
  let rtShrinkStreak = 0
  /**
   * 主渲染之后调用。`frame` = {scene, camera, vehicle, tankData, config, shell, caliber,
   * penMul, thickMul, onReady}；目标 armor 未就绪时不画（本帧画面与关闭时相同）。
   */
  function render(frame: ArmorHighlightFrame): void {
    const { scene, camera, vehicle } = frame
    const stats = frame.stats ?? null
    if (stats) {
      rtStats = stats.rt ??= { width: null, height: null, creates: 0, resizes: 0, disposes: 0, colorEstimateBytes: null, estimateKind: 'color-only-estimate' }
      if (stateRT && spacedRT && rtStats.width === null) {
        rtStats.width = stateRT.width; rtStats.height = stateRT.height
        rtStats.colorEstimateBytes = stateRT.width * stateRT.height * 2 * (stateRT.texture.type === THREE.HalfFloatType ? 8 : 4)
      }
    } else rtStats = null
    if (stats) {
      stats.stateMs = 0; stats.thicknessMs = 0; stats.occluderMs = 0; stats.colorMs = 0; stats.calls = 0
      stats.stateCalls = 0; stats.thicknessCalls = 0; stats.occluderCalls = 0; stats.colorCalls = 0
    }
    const target = armorTargets.targetArmor(vehicle, frame.tankData, frame.config as import('../viewer/armorPlateModel.js').TankArmorConfig | null, frame.onReady)
    if (!target) return
    renderer.getDrawingBufferSize(size)
    armorTargets.syncPose(target, vehicle)
    const bounds = armorBounds(target)
    const rect = screenRect(bounds, camera)
    if (!rect) return
    armorTargets.syncUniforms(target, camera, frame)

    // 所有叠加 pass 只碰目标的屏幕矩形；遮挡集只留能挡住它的物体，主渲染的画面不受影响
    cropFrustum(camera, rect, occluderView.frustum)
    occluderView.origin.copy(camera.position)
    camera.getWorldDirection(occluderView.forward)
    bounds.getBoundingSphere(armorSphere)
    occluderView.maxDepth = world.subVectors(armorSphere.center, camera.position).dot(occluderView.forward)
      + armorSphere.radius
    scissorRect(rect)

    // RT 只需罩住目标矩形（64px 取整、只增不减 + 收缩滞回）；两张辅助 RT 用视口偏移相机
    // 把该矩形拉伸到整张 RT（setViewOffset 只偏移投影 xy，NDC z 与主相机逐位一致）。
    // color pass 仍画回默认帧缓冲的目标矩形，buffer 采样经 spacedRect 从全画面 UV 映射回 RT 局部。
    const rtW = bucketedRtSize(scissor.z, size.x)
    const rtH = bucketedRtSize(scissor.w, size.y)
    let shrinking = false
    if (stateRT && rtW * rtH * 4 <= stateRT.width * stateRT.height) {
      if (++rtShrinkStreak >= 90) { disposeTargets(); rtShrinkStreak = 0; shrinking = true }
    } else rtShrinkStreak = 0
    ensureTargets(rtW, rtH, shrinking)
    shaders.resUniform.value.copy(size)
    spacedRectOf(scissor.x, scissor.y, scissor.z, scissor.w, size.x, size.y, spacedRect)
    armorCamera.copy(camera)
    armorCamera.setViewOffset(size.x, size.y, scissor.x, size.y - (scissor.y + scissor.w), scissor.z, scissor.w)
    armorCamera.updateProjectionMatrix()
    bindBuffers(target, camera, spacedRect)
    for (const rt of [stateRT, spacedRT]) {
      if (!rt) continue
      rt.scissor.set(0, 0, rtW, rtH)
      rt.scissorTest = false
    }

    const autoClear = renderer.autoClear, clipping = renderer.localClippingEnabled
    const shadows = renderer.shadowMap.autoUpdate, clearAlpha = renderer.getClearAlpha()
    const scissorTest = renderer.getScissorTest()
    const renderTarget = renderer.getRenderTarget()
    renderer.getViewport(savedViewport)
    renderer.getScissor(savedScissor)
    renderer.getClearColor(clearColor)
    try {
      renderer.localClippingEnabled = true
      renderer.shadowMap.autoUpdate = false
      renderer.setClearColor(0x000000, 0)
      renderer.autoClear = true
      let calls = passBegin(stats)
      renderer.setRenderTarget(stateRT)
      renderPass(frame, 'state', target.state, armorCamera)
      passEnd(stats, 'stateMs', 'stateCalls', calls)
      calls = passBegin(stats)
      renderer.setRenderTarget(spacedRT)
      renderPass(frame, 'thickness', target.thickness, armorCamera)
      passEnd(stats, 'thicknessMs', 'thicknessCalls', calls)
      renderer.setRenderTarget(null)
      const pixelRatio = renderer.getPixelRatio()
      renderer.setScissor(scissor.x / pixelRatio, scissor.y / pixelRatio, scissor.z / pixelRatio, scissor.w / pixelRatio)
      renderer.setScissorTest(true)
      renderer.autoClear = false
      renderer.clearDepth()
      calls = passBegin(stats)
      drawOccluderDepth(frame, occluderView, frame.occluderRoots ?? [scene])
      passEnd(stats, 'occluderMs', 'occluderCalls', calls)
      calls = passBegin(stats)
      renderPass(frame, 'color', target.color, camera)
      passEnd(stats, 'colorMs', 'colorCalls', calls)
    } finally {
      renderer.setRenderTarget(renderTarget)
      renderer.setViewport(savedViewport)
      renderer.setScissorTest(scissorTest)
      renderer.setScissor(savedScissor)
      renderer.autoClear = autoClear
      renderer.localClippingEnabled = clipping
      renderer.shadowMap.autoUpdate = shadows
      renderer.setClearColor(clearColor, clearAlpha)
    }
  }

  function disposeTargets(): void {
    for (const rt of [stateRT, spacedRT]) {
      if (!rt) continue
      rt.depthTexture?.dispose()
      rt.dispose()
      if (rtStats) rtStats.disposes++
    }
    stateRT = spacedRT = null
    if (rtStats) { rtStats.width = null; rtStats.height = null; rtStats.colorEstimateBytes = null }
  }

  /** 离开开镜/关闭开关时释放装甲 RT；下次命中目标时 `ensureTargets` 按需重建。 */
  function releaseRenderTargets(): void {
    disposeTargets()
    rtShrinkStreak = 0
  }

  /** 进开镜后后台预取本场敌方车型的 armor 模板（按 tank_id 去重，失败走同一重试表）。 */
  function prefetch(vehicles: AimedVehicleCandidate[]): void {
    for (const vehicle of vehicles) {
      const tankId = vehicle.def?.tank_id
      const url = (vehicle.tankData as { model_url?: string | null } | undefined)?.model_url
      if (!tankId || !url || templates.has(tankId) || !templateRetry.allowed(tankId)) continue
      loadTemplate(tankId, url)
    }
  }


  function dispose(): void {
    if (disposed) return
    disposed = true
    for (const target of targets.values()) armorTargets.disposeTarget(target.armor)
    targets.clear()
    for (const promise of templates.values()) {
      promise.then((model) => model?.traverse((node) => (node as Mesh).geometry?.dispose()))
    }
    templates.clear()
    disposeTargets()
    for (const material of new Set([excludeMaterial, occluderMaterial, ...Object.values(depthMaterials), ...(warmMaterials ?? [])])) material.dispose()
    warmMaterials = null
    shaders.dispose()
  }

  let warmMaterials: Material[] | null = null
  /** 装甲材质变体预热：占位几何 + 每个运行期变体（含裁切/双面分支）提前 `renderer.compile`，
   *  把首次编译从「第一次瞄准新车型的那一帧」挪到加载阶段。预热材质必须持有引用不释放
   *  （program 缓存按 cacheKey 共享，材质释放会连同释放 program）。幂等。 */
  function prewarm(camera: PerspectiveCamera): void {
    if (warmMaterials || disposed) return
    if (typeof renderer.compile !== 'function') return
    try {
      const clipPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0)
      const clippedDepth = depthMaterials.externalDepth.clone()
      clippedDepth.side = THREE.DoubleSide
      clippedDepth.clippingPlanes = [clipPlane]
      warmMaterials = [
        excludeMaterial, occluderMaterial,
        depthMaterials.omit, depthMaterials.spacedOmit, depthMaterials.externalDepth, clippedDepth,
        shaders.penetrationMaterial(0), shaders.penetrationMaterial(60),
        shaders.spacedMaterial(0, 200, THREE.FrontSide), shaders.spacedMaterial(0, 200, THREE.DoubleSide),
        shaders.spacedStateMaterial(0, 200),
        shaders.externalMaterial(20, 200, null), shaders.externalMaterial(20, 200, clipPlane),
        shaders.moduleStateMaterial(null), shaders.moduleStateMaterial(clipPlane),
      ]
      const geo = new THREE.BoxGeometry(1, 1, 1)
      const scene = new THREE.Scene()
      for (const material of warmMaterials) {
        const mesh = new THREE.Mesh(geo, material)
        mesh.frustumCulled = false
        scene.add(mesh)
      }
      const wasClipping = renderer.localClippingEnabled
      renderer.localClippingEnabled = true
      try { renderer.compile(scene, camera) } finally { renderer.localClippingEnabled = wasClipping }
      scene.clear()
    } catch (e) {
      console.warn('[playback] armor 材质预热失败（忽略）:', e)
    }
  }

  return { render, prefetch, prewarm, releaseRenderTargets, dispose }
}

// ---- 公共 API（#LOC 结构拆分出仓后 re-export，导入方零改动）----
export {
  aimedVehicle,
  armorPosePart,
  armorWorldMatrix,
  bucketedRtSize,
  cropFrustum,
  markPickBoundsStale,
  reticleAimDirection,
  RT_BUCKET_PX,
  screenRect,
  spacedBufferUv,
  spacedRectOf,
} from './armorHighlightPick.js'
export type { AimedVehicleCandidate } from './armorHighlightPick.js'
export {
  armorEquipmentCoeffs,
  armorHighlightBlock,
  authorShellAt,
  createLoadRetry,
  mountedShell,
} from './armorHighlightPolicy.js'
export type { LoadRetry, MountedShell, HighlightConfig } from './armorHighlightPolicy.js'
export type { ArmorHighlightFrame, ArmorHighlightPerfStats, ArmorRenderTargetStats } from './armorHighlightTypes.js'
export { buildTarget } from './armorHighlightTargets.js'
export type { BuiltTarget } from './armorHighlightTargets.js'
