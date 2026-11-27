import * as THREE from 'three'
import { Line2 } from 'three/addons/lines/Line2.js'
import { LineGeometry } from 'three/addons/lines/LineGeometry.js'
import { LineMaterial } from 'three/addons/lines/LineMaterial.js'

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
    return null
  }
}

export interface ScreenPolylineOptions {
  color: number
  widthPx?: number
  haloWidthPx?: number
  haloColor?: number
  haloOpacity?: number
  opacity?: number
  dashed?: boolean
  dashSize?: number
  gapSize?: number
  renderOrder?: number
}

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
    line.frustumCulled = false
    line.renderOrder = order
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

export function setOverlayDotColor(dot: THREE.Object3D | null | undefined, color: number): void {
  if (!dot) return
  const material = (dot as THREE.Points).material
  if (material instanceof THREE.PointsMaterial) material.color.setHex(color)
}

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

export function disposeHitMarker(scene: THREE.Scene | null | undefined): void {
  if (!scene || typeof window === 'undefined') return
  if (window.__hitMarker) {
    scene.remove(window.__hitMarker)
    disposeOverlayObject(window.__hitMarker)
    window.__hitMarker = null
  }
}
