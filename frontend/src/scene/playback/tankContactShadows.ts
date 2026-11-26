import * as THREE from 'three'
import type { DirectionalLight, Object3D, Scene } from 'three'
import { createSilhouetteShadow, makeSilhouetteMaterial, planarShadowMatrix, type SilhouetteShadow } from './tankSilhouetteShadow.js'

export interface ShadowFootprint {
  halfW: number
  halfL: number
}

export interface SunShadow {
  centered: boolean
  dirX: number
  dirZ: number
  tailFactor: number
}

interface Vec3Like { x: number, y: number, z: number }

export const PROXY_FOOTPRINT: Readonly<ShadowFootprint> = Object.freeze({ halfW: 1.8, halfL: 3.25 })

const K_TAIL = 0.45
const MAX_TAIL = 0.9
const MIN_DOWN = 0.05
const CENTERED: Readonly<SunShadow> = Object.freeze({ centered: true, dirX: 0, dirZ: 0, tailFactor: 0 })

export function sunShadowFrom(light: Vec3Like, target: Vec3Like): SunShadow {
  const dx = target.x - light.x, dy = target.y - light.y, dz = target.z - light.z
  if (![dx, dy, dz].every(Number.isFinite)) return CENTERED
  const n = Math.hypot(dx, dy, dz)
  if (!(n > 1e-9)) return CENTERED
  const ux = dx / n, uy = dy / n, uz = dz / n
  if (uy > -MIN_DOWN) return CENTERED
  const h = Math.hypot(ux, uz)
  if (!(h > 1e-6)) return CENTERED
  const ratio = h / -uy
  return {
    centered: false,
    dirX: ux / h,
    dirZ: uz / h,
    tailFactor: Math.min(K_TAIL * ratio, MAX_TAIL),
  }
}

const CHASSIS_NODE = /^chassis_(track|wheel)_/i

function localBox(object: Object3D, pick: (node: Object3D) => boolean): THREE.Box3 {
  object.updateWorldMatrix(true, true)
  const toLocal = new THREE.Matrix4().copy(object.matrixWorld).invert()
  const box = new THREE.Box3(), part = new THREE.Box3(), m = new THREE.Matrix4()
  object.traverse((node) => {
    if (!pick(node)) return
    node.traverse((child) => {
      const geo = (child as THREE.Mesh).geometry
      if (!(child as THREE.Mesh).isMesh || !geo) return
      if (!geo.boundingBox) geo.computeBoundingBox()
      box.union(part.copy(geo.boundingBox!).applyMatrix4(m.multiplyMatrices(toLocal, child.matrixWorld)))
    })
  })
  return box
}

export function measureShadowFootprint(object: Object3D): ShadowFootprint {
  let box = localBox(object, (node) => CHASSIS_NODE.test(node.name || ''))
  if (box.isEmpty()) box = localBox(object, (node) => node === object)
  const size = box.getSize(new THREE.Vector3())
  const halfW = size.x / 2, halfL = size.y / 2
  if (!Number.isFinite(halfW) || !Number.isFinite(halfL) || halfW < 0.3 || halfL < 0.3 || halfW > 6 || halfL > 12) {
    return { ...PROXY_FOOTPRINT }
  }
  return { halfW, halfL }
}

export const GRID = 5
const LIFT = 0.04
const OPACITY = 0.65
const SILHOUETTE_OPACITY = 0.5
const SHADOW_COLOR = 0x0b0f14

export function shadowMargin(fp: ShadowFootprint): number {
  return Math.min(0.6, Math.max(0.35, fp.halfW * 0.25))
}

function axisOffset(t: number, h: number, mNeg: number, mPos: number): number {
  const a = Math.abs(t)
  const m = t < 0 ? mNeg : mPos
  const d = a <= 0.5 ? a * 2 * h : h + (a - 0.5) * 2 * m
  return t < 0 ? -d : d
}

const SOLID = 0.3

export function shadowAlpha(x: number, y: number): number {
  const qx = Math.max(Math.abs(x) - 0.5, 0) * 2
  const qy = Math.max(Math.abs(y) - 0.5, 0) * 2
  return 1 - THREE.MathUtils.smoothstep(Math.min(1, Math.hypot(qx, qy)), SOLID, 1)
}

export function shadowGridXZ(x: number, z: number, yaw: number, fp: ShadowFootprint, sun: SunShadow, out: Float32Array): Float32Array {
  const c = Math.cos(yaw), s = Math.sin(yaw)
  const m = shadowMargin(fp)
  const tail = sun.tailFactor * fp.halfL
  const ldx = c * sun.dirX - s * sun.dirZ
  const ldz = s * sun.dirX + c * sun.dirZ
  const mxNeg = m + tail * Math.max(-ldx, 0), mxPos = m + tail * Math.max(ldx, 0)
  const mzNeg = m + tail * Math.max(-ldz, 0), mzPos = m + tail * Math.max(ldz, 0)
  let i = 0
  for (let r = 0; r < GRID; r++) {
    const v = (r / (GRID - 1)) * 2 - 1
    for (let q = 0; q < GRID; q++) {
      const u = (q / (GRID - 1)) * 2 - 1
      const lx = axisOffset(u, fp.halfW, mxNeg, mxPos), lz = axisOffset(v, fp.halfL, mzNeg, mzPos)
      out[i++] = x + lx * c + lz * s
      out[i++] = z - lx * s + lz * c
    }
  }
  return out
}

function makeGradientTexture(): THREE.DataTexture {
  const n = 64
  const data = new Uint8Array(n * n * 4)
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      const o = (y * n + x) * 4
      data[o] = data[o + 1] = data[o + 2] = 255
      data[o + 3] = Math.round(255 * shadowAlpha((x + 0.5) / n * 2 - 1, (y + 0.5) / n * 2 - 1))
    }
  }
  const tex = new THREE.DataTexture(data, n, n, THREE.RGBAFormat)
  tex.magFilter = THREE.LinearFilter
  tex.minFilter = THREE.LinearFilter
  tex.needsUpdate = true
  return tex
}

export const DEPTH_PULL = Object.freeze({ height: 0.25, minSin: 0.1, max: 2.5, nearKeep: 1.05 })

export function applyDepthPull(shader: { vertexShader: string }): void {
  const anchor = '#include <project_vertex>'
  if (!shader.vertexShader.includes(anchor)) throw new Error('tankContactShadows: project_vertex chunk missing')
  const f = (n: number) => n.toFixed(4)
  shader.vertexShader = shader.vertexShader.replace(anchor, `${anchor}
  {
    float pullDist = length(mvPosition.xyz);
    vec3 upView = normalize((viewMatrix * vec4(0.0, 1.0, 0.0, 0.0)).xyz);
    float viewSin = max(dot(-mvPosition.xyz / max(pullDist, 1e-4), upView), ${f(DEPTH_PULL.minSin)});
    float pull = min(${f(DEPTH_PULL.height)} / viewSin, ${f(DEPTH_PULL.max)});
    if (isPerspectiveMatrix(projectionMatrix)) {
      // three makePerspective：P[3][2] / (P[2][2] − 1) = near
      float keepDepth = ${f(DEPTH_PULL.nearKeep)} * projectionMatrix[3][2] / (projectionMatrix[2][2] - 1.0);
      float eyeDepth = -mvPosition.z;
      pull = eyeDepth > keepDepth ? min(pull, pullDist * (1.0 - keepDepth / eyeDepth)) : 0.0;
    }
    mvPosition.xyz *= max(pullDist - pull, 0.0) / max(pullDist, 1e-4);
    gl_Position = projectionMatrix * mvPosition;
  }`)
}

interface ShadowEntry {
  mesh: THREE.Mesh
  pos: THREE.BufferAttribute
  footprint: ShadowFootprint
  x: number, z: number, yaw: number
  stamp: number
  wanted: boolean
  grounded: boolean
  silhouette: SilhouetteShadow | null
}

export interface TankContactShadowsOptions {
  scene: Scene
  sunLight: DirectionalLight
  heightAt: (x: number, z: number) => number | null
  silhouettes?: boolean
}

export interface TankContactShadows {
  syncSun(): void
  setFootprint(owner: object, footprint: ShadowFootprint): void
  attachModel(owner: object, model: Object3D): void
  update(owner: object, x: number, z: number, yaw: number, visible: boolean): void
  reground(): void
  count(): number
  silhouetteCount(): number
  dispose(): void
}

export function createTankContactShadows({ scene, sunLight, heightAt, silhouettes = false }: TankContactShadowsOptions): TankContactShadows {
  const texture = makeGradientTexture()
  const material = new THREE.MeshBasicMaterial({
    color: SHADOW_COLOR, map: texture, transparent: true, opacity: OPACITY,
    depthTest: true, depthWrite: false, toneMapped: false,
  })
  material.onBeforeCompile = applyDepthPull
  material.customProgramCacheKey = () => 'tankContactShadow-depthPull'
  const silhouetteMaterial = silhouettes ? makeSilhouetteMaterial(SHADOW_COLOR, SILHOUETTE_OPACITY) : null
  if (silhouetteMaterial) {
    silhouetteMaterial.onBeforeCompile = applyDepthPull
    silhouetteMaterial.customProgramCacheKey = () => 'tankSilhouetteShadow-depthPull'
  }
  const entries = new Map<object, ShadowEntry>()
  const footprints = new Map<object, ShadowFootprint>()
  const models = new Map<object, Object3D>()
  const xz = new Float32Array(GRID * GRID * 2)
  const lightWorld = new THREE.Vector3(), targetWorld = new THREE.Vector3()
  const lightDir = new THREE.Vector3(0, -1, 0)
  const planeU = new THREE.Vector3(), planeV = new THREE.Vector3(), planeN = new THREE.Vector3(), planeP = new THREE.Vector3()
  let sun: SunShadow = CENTERED
  let sunNoTail: SunShadow = CENTERED
  let version = 1
  let disposed = false

  const uvs = new Float32Array(GRID * GRID * 2)
  const index: number[] = []
  for (let r = 0; r < GRID; r++) {
    for (let q = 0; q < GRID; q++) {
      uvs[(r * GRID + q) * 2] = q / (GRID - 1)
      uvs[(r * GRID + q) * 2 + 1] = r / (GRID - 1)
      if (r < GRID - 1 && q < GRID - 1) {
        const i = r * GRID + q
        index.push(i, i + GRID, i + 1, i + 1, i + GRID, i + GRID + 1)
      }
    }
  }

  function entryFor(owner: object): ShadowEntry {
    let e = entries.get(owner)
    if (e) return e
    const geometry = new THREE.BufferGeometry()
    const pos = new THREE.BufferAttribute(new Float32Array(GRID * GRID * 3), 3)
    pos.setUsage(THREE.DynamicDrawUsage)
    geometry.setAttribute('position', pos)
    geometry.setAttribute('uv', new THREE.BufferAttribute(uvs.slice(), 2))
    geometry.setIndex(index)
    const mesh = new THREE.Mesh(geometry, material)
    mesh.name = 'tankContactShadow'
    mesh.visible = false
    mesh.matrixAutoUpdate = false
    scene.add(mesh)
    e = { mesh, pos, footprint: footprints.get(owner) ?? PROXY_FOOTPRINT, x: NaN, z: NaN, yaw: NaN, stamp: 0, wanted: false, grounded: false, silhouette: null }
    const model = models.get(owner)
    if (model && silhouetteMaterial) e.silhouette = createSilhouetteShadow(scene, model, silhouetteMaterial)
    entries.set(owner, e)
    return e
  }

  function placeSilhouette(e: ShadowEntry, arr: Float32Array): void {
    if (!e.silhouette) return
    const c = (GRID * GRID - 1) / 2, h = (GRID - 1) / 4
    const at = (i: number, out: THREE.Vector3) => out.set(arr[i * 3], arr[i * 3 + 1], arr[i * 3 + 2])
    at(c + h, planeU).sub(at(c - h, planeP))
    at(c + h * GRID, planeV).sub(at(c - h * GRID, planeP))
    planeN.crossVectors(planeV, planeU).normalize()
    if (planeN.y < 0) planeN.negate()
    at(c, planeP)
    planarShadowMatrix(planeN, -planeN.dot(planeP), lightDir, e.silhouette.projection)
  }

  function place(e: ShadowEntry): void {
    shadowGridXZ(e.x, e.z, e.yaw, e.footprint, e.silhouette ? sunNoTail : sun, xz)
    const arr = e.pos.array as Float32Array
    for (let i = 0; i < GRID * GRID; i++) {
      const wx = xz[i * 2], wz = xz[i * 2 + 1]
      const y = heightAt(wx, wz)
      if (y == null || !Number.isFinite(y)) {
        e.grounded = false; e.mesh.visible = false; e.silhouette?.setVisible(false)
        return
      }
      arr[i * 3] = wx; arr[i * 3 + 1] = y + LIFT; arr[i * 3 + 2] = wz
    }
    e.pos.needsUpdate = true
    e.mesh.geometry.computeBoundingSphere()
    e.grounded = true
    e.mesh.visible = true
    placeSilhouette(e, arr)
    e.silhouette?.setVisible(true)
  }

  const api: TankContactShadows = {
    syncSun() {
      if (disposed) return
      sunLight.updateMatrixWorld()
      sunLight.target.updateMatrixWorld()
      sunLight.getWorldPosition(lightWorld)
      sunLight.target.getWorldPosition(targetWorld)
      sun = sunShadowFrom(lightWorld, targetWorld)
      sunNoTail = { ...sun, tailFactor: 0 }
      lightDir.subVectors(targetWorld, lightWorld)
      if (sun.centered || !(lightDir.lengthSq() > 1e-12)) lightDir.set(0, -1, 0)
      else lightDir.normalize()
      version++
    },
    setFootprint(owner, footprint) {
      if (disposed) return
      footprints.set(owner, footprint)
      const e = entries.get(owner)
      if (e) { e.footprint = footprint; e.stamp = 0 }
    },
    attachModel(owner, model) {
      if (disposed) return
      models.set(owner, model)
      const e = entries.get(owner)
      if (e && silhouetteMaterial) {
        e.silhouette?.dispose()
        e.silhouette = createSilhouetteShadow(scene, model, silhouetteMaterial)
        e.stamp = 0
      }
    },
    update(owner, x, z, yaw, visible) {
      if (disposed) return
      if (!visible) {
        const e = entries.get(owner)
        if (e) { e.wanted = false; e.mesh.visible = false; e.silhouette?.setVisible(false) }
        return
      }
      if (!Number.isFinite(x) || !Number.isFinite(z) || !Number.isFinite(yaw)) return
      const e = entryFor(owner)
      e.wanted = true
      if (e.stamp === version && e.x === x && e.z === z && e.yaw === yaw) {
        e.mesh.visible = e.grounded
        e.silhouette?.setVisible(e.grounded)
        return
      }
      e.x = x; e.z = z; e.yaw = yaw; e.stamp = version
      place(e)
    },
    reground() {
      if (disposed) return
      version++
      for (const e of entries.values()) {
        if (!e.wanted || !Number.isFinite(e.x)) continue
        e.stamp = version
        place(e)
      }
    },
    count() {
      let n = 0
      for (const e of entries.values()) if (e.mesh.visible) n++
      return n
    },
    silhouetteCount() {
      let n = 0
      for (const e of entries.values()) n += e.silhouette?.count() ?? 0
      return n
    },
    dispose() {
      if (disposed) return
      disposed = true
      for (const e of entries.values()) {
        scene.remove(e.mesh)
        e.mesh.geometry.dispose()
        e.silhouette?.dispose()
      }
      entries.clear()
      footprints.clear()
      models.clear()
      material.dispose()
      silhouetteMaterial?.dispose()
      texture.dispose()
    },
  }
  api.syncSun()
  return api
}
