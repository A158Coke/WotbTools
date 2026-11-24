/**
 * 装甲查看器 3D 覆盖物原语（屏幕空间恒定宽度）。
 *
 * 射线/弹道弦是细长、跨 3–500m 的标注：世界空间 Tube 在近处过粗、远处亚像素，
 * 且默认受 ACES tone mapping 压暗。本模块统一为：
 * - `Line2` + `LineMaterial`（`worldUnits:false`，线宽 CSS px，恒定屏幕宽度）；
 * - 深色描边在下、结果色核心在上（无描边时绿色射线会消失在绿色热力图板里）；
 * - 层点/命中点为 `Points` 屏幕空间圆点，黑白纹理自带 1.5px 深色描边；
 * - 所有材质 `depthTest:false` + `toneMapped:false`，画在车体/热力图之上并直出字面色。
 *
 * 生命周期：调用方在移除轨迹/命中点时调用 `disposeOverlayObject`；点纹理是模块级共享
 * 资源，只在查看器销毁时用 `disposeOverlayTextures` 释放（之后按需重建）。
 */
import * as THREE from 'three'
import { Line2 } from 'three/addons/lines/Line2.js'
import { LineGeometry } from 'three/addons/lines/LineGeometry.js'
import { LineMaterial } from 'three/addons/lines/LineMaterial.js'

/** 屏幕空间圆点纹理：白色圆盘 + 深色描边（材质 color 只染白色部分，黑边保持不变）。 */
let dotTexture: THREE.Texture | null = null

function getDotTexture(): THREE.Texture | null {
  if (dotTexture) return dotTexture
  if (typeof document === 'undefined') return null
  try {
    const canvas = document.createElement('canvas')
    canvas.width = 64
    canvas.height = 64
    const ctx = canvas.getContext('2d')
    if (!ctx) return null
    ctx.clearRect(0, 0, 64, 64)
    // 黑边：半径 30；白芯：半径 22 → 总直径的 ~25% 是描边（7px 点约 1.8px 边）。
    ctx.beginPath()
    ctx.arc(32, 32, 30, 0, Math.PI * 2)
    ctx.fillStyle = '#05070a'
    ctx.fill()
    ctx.beginPath()
    ctx.arc(32, 32, 22, 0, Math.PI * 2)
    ctx.fillStyle = '#ffffff'
    ctx.fill()
    const texture = new THREE.CanvasTexture(canvas)
    texture.colorSpace = THREE.SRGBColorSpace
    texture.needsUpdate = true
    dotTexture = texture
    return texture
  } catch {
    // 测试/无 canvas 2D 的环境：退回方形 Points（尺寸/颜色/生命周期语义不变）。
    return null
  }
}

export interface ScreenPolylineOptions {
  color: number
  /** 核心线宽（CSS px，默认 2）。 */
  widthPx?: number
  /** 深色描边总宽（CSS px，默认 4；0 表示不画描边）。 */
  haloWidthPx?: number
  haloColor?: number
  haloOpacity?: number
  opacity?: number
  dashed?: boolean
  dashSize?: number
  gapSize?: number
  renderOrder?: number
}

/**
 * 屏幕空间折线：返回含描边层与核心层的 Group；少于两个点返回 null。
 * 线宽恒定，不随距离变化；`resolution` 由 `updateOverlayResolution` 每帧同步。
 */
export function createScreenSpacePolyline(
  points: ReadonlyArray<THREE.Vector3>,
  options: ScreenPolylineOptions,
): THREE.Group | null {
  if (points.length < 2) return null
  const positions: number[] = []
  for (const p of points) positions.push(p.x, p.y, p.z)
  const resolution = new THREE.Vector2(1, 1)
  const group = new THREE.Group()
  const renderOrder = options.renderOrder ?? 997

  const makeLine = (color: number, widthPx: number, opacity: number, order: number): Line2 => {
    const geometry = new LineGeometry()
    geometry.setPositions(positions)
    const material = new LineMaterial({
      color,
      linewidth: widthPx,
      worldUnits: false,
      transparent: true,
      opacity,
      depthTest: false,
      depthWrite: false,
      toneMapped: false,
      ...(options.dashed ? {
        dashed: true,
        dashSize: options.dashSize ?? 1.2,
        gapSize: options.gapSize ?? 0.8,
        dashScale: 1,
      } : {}),
    })
    material.resolution.copy(resolution)
    const line = new Line2(geometry, material)
    // 300m 入射段的包围球可能不覆盖视锥；不裁切避免整段消失。
    line.frustumCulled = false
    line.renderOrder = order
    // 覆盖物不参与点击/拾取（判定只对装甲模型 raycast）。
    line.raycast = () => {}
    if (options.dashed) line.computeLineDistances()
    return line
  }

  const haloWidth = options.haloWidthPx ?? 0
  if (haloWidth > 0) {
    group.add(makeLine(
      options.haloColor ?? 0x05070a,
      haloWidth,
      options.haloOpacity ?? 0.5,
      renderOrder - 1,
    ))
  }
  group.add(makeLine(options.color, options.widthPx ?? 2, options.opacity ?? 1, renderOrder))
  group.userData.overlayRole = 'polyline'
  return group
}

/** 屏幕空间圆点（总直径含深色描边；结果色只染白芯）。 */
export function createScreenSpaceDot(
  point: THREE.Vector3,
  color: number,
  sizePx: number,
  options: { renderOrder?: number } = {},
): THREE.Points {
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.Float32BufferAttribute([point.x, point.y, point.z], 3))
  const texture = getDotTexture()
  const material = new THREE.PointsMaterial({
    color,
    // CSS px；renderer 的 refreshUniformsPoints 会再乘一次 pixelRatio，这里不能预乘。
    size: sizePx,
    sizeAttenuation: false,
    transparent: true,
    depthTest: false,
    depthWrite: false,
    toneMapped: false,
    ...(texture ? { map: texture, alphaTest: 0.5 } : {}),
  })
  const dot = new THREE.Points(geometry, material)
  dot.frustumCulled = false
  dot.renderOrder = options.renderOrder ?? 999
  dot.raycast = () => {}
  dot.userData.overlayRole = 'dot'
  return dot
}

/** 命中点等待判定时的中性色 → 结果返回后改为角色亮变体。 */
export function setOverlayDotColor(dot: THREE.Object3D | null | undefined, color: number): void {
  if (!dot) return
  const material = (dot as THREE.Points).material
  if (material instanceof THREE.PointsMaterial) material.color.setHex(color)
}

/**
 * 同步所有覆盖物材质的 resolution（LineMaterial 线宽以 CSS px 计）。
 * 画布尺寸/DPR 变化后必须调用；正常路径由 renderFxPass 每帧调用（对象数很少）。
 */
export function updateOverlayResolution(root: THREE.Object3D, width: number, height: number): void {
  if (!(width > 0) || !(height > 0)) return
  root.traverse((node) => {
    const material = (node as THREE.Mesh).material as THREE.Material | THREE.Material[] | undefined
    if (!material) return
    const list = Array.isArray(material) ? material : [material]
    for (const mat of list) {
      const uniforms = (mat as THREE.ShaderMaterial).uniforms
      const resolution = uniforms && uniforms.resolution && uniforms.resolution.value
      if (resolution && typeof (resolution as THREE.Vector2).set === 'function') {
        (resolution as THREE.Vector2).set(width, height)
      }
    }
  })
}

/**
 * 释放覆盖物几何/材质。共享点纹理不在此释放（生命周期跟随 app 会话；两个查看器
 * 生命周期可能重叠，按 viewer 销毁会在对方仍引用时释放纹理）。
 */
export function disposeOverlayObject(object: THREE.Object3D | null | undefined): void {
  if (!object) return
  object.traverse((node) => {
    const mesh = node as THREE.Mesh
    const geometry = mesh.geometry as THREE.BufferGeometry | undefined
    if (geometry && typeof geometry.dispose === 'function') geometry.dispose()
    const material = mesh.material as THREE.Material | THREE.Material[] | undefined
    if (!material) return
    const list = Array.isArray(material) ? material : [material]
    for (const mat of list) {
      if (mat && typeof mat.dispose === 'function') mat.dispose()
    }
  })
}

/** 命中标记的唯一清理入口：移除 + dispose + 清全局引用。 */
export function disposeHitMarker(scene: THREE.Scene | null | undefined): void {
  if (!scene || typeof window === 'undefined') return
  if (window.__hitMarker) {
    scene.remove(window.__hitMarker)
    disposeOverlayObject(window.__hitMarker)
    window.__hitMarker = null
  }
}
