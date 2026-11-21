// 战斗特效 GPU 资源层：程序化贴图图集、粒子/火花批次与 shader——自 battleFx.ts 出仓
//（2026-11-21 #LOC 结构拆分：代码与搬移前逐字一致，公共入口仍由 battleFx re-export）。
import * as THREE from 'three'
import type { Color, LineSegments, Mesh, Texture } from 'three'

export const clamp01 = (x: number): number => Math.max(0, Math.min(1, x))
export const noop = (): void => {}

// ---------- 程序化贴图图集（4×2 格，每格 128 px，只用 alpha） ----------
export const TILE = 128
export const ATLAS_COLS = 4
export const ATLAS_ROWS = 2
export const FLAME_TILES = [0, 1, 7]
export const SOOT_TILES = [2, 3]
export const GLOW_TILE = 4
export const STAR_TILE = 5
export const CHUNK_TILE = 6
const turb = (u: number, v: number, p: number): number => Math.sin(u * 9 + p + Math.sin(v * 7 + p * 1.3)) * Math.cos(v * 11 - u * 4 + p * 0.7)
  + 0.5 * Math.sin(u * 19 + v * 13 + p * 2.1)
const TILE_ALPHA: Array<(u: number, v: number) => number> = [
  (u, v) => flameAlpha(u, v, 0.6),
  (u, v) => flameAlpha(u, v, 2.5),
  (u, v) => sootAlpha(u, v, 1.3),
  (u, v) => sootAlpha(u, v, 3.7),
  (u, v) => Math.max(0, 1 - Math.hypot(u, v)) ** 2.4,
  (u, v) => {
    const r = Math.hypot(u, v), fall = Math.max(0, 1 - r), ang = Math.atan2(v, u)
    const rays = Math.abs(Math.cos(ang * 4 + 0.3)) ** 8 + 0.7 * Math.abs(Math.cos(ang * 3 + 1.1)) ** 12
    return fall ** 3 + rays * fall ** 1.5 * 0.55
  },
  (u, v) => {
    // 碎片：不规则硬边多边形（只留 1~2 px 抗锯齿边）
    const edge = 0.72 * (1 + 0.22 * Math.sin(Math.atan2(v, u) * 5 + 0.8) + 0.08 * turb(u, v, 5.1))
    return clamp01((edge - Math.hypot(u, v)) * 40)
  },
  (u, v) => flameAlpha(u, v, 4.4),
]
function flameAlpha(u: number, v: number, p: number): number {
  const r = Math.hypot(u, v), t1 = turb(u, v, p), t2 = turb(u * 1.7, v * 1.7, p + 2.3)
  return Math.max(0, 1 - r * (1 + 0.18 * t1 + 0.08 * t2)) ** 1.4 * (0.8 + 0.2 * t2)
}
function sootAlpha(u: number, v: number, p: number): number {
  const r = Math.hypot(u, v), t1 = turb(u, v, p), t2 = turb(u * 1.6, v * 1.6, p + 1.1)
  return Math.max(0, 1 - r * (1 + 0.22 * t1 + 0.1 * t2)) ** 1.1 * (0.62 + 0.24 * t1 + 0.14 * t2)
}
let atlasPixels: Uint8Array | null = null
/** 图集像素只算一次（模块级缓存）；每个会话的 DataTexture 共用同一份只读数据。 */
export function atlasData(): Uint8Array {
  if (atlasPixels) return atlasPixels
  const w = TILE * ATLAS_COLS, h = TILE * ATLAS_ROWS
  const px = new Uint8Array(w * h * 4)
  for (let tile = 0; tile < TILE_ALPHA.length; tile++) {
    const ox = (tile % ATLAS_COLS) * TILE, oy = Math.floor(tile / ATLAS_COLS) * TILE
    const alpha = TILE_ALPHA[tile]
    for (let y = 0; y < TILE; y++) for (let x = 0; x < TILE; x++) {
      const u = (x + 0.5) * 2 / TILE - 1, v = (y + 0.5) * 2 / TILE - 1
      const i = ((oy + y) * w + ox + x) * 4
      px[i] = px[i + 1] = px[i + 2] = 255
      px[i + 3] = Math.round(255 * clamp01(alpha(u, v)))
    }
  }
  atlasPixels = px
  return px
}

// ---------- shader ----------
export const PARTICLE_VS = /* glsl */`
#include <common>
attribute vec4 iA;
attribute vec4 iB;
attribute vec4 iC;
varying vec2 vUv;
varying vec4 vColor;
#include <logdepthbuf_pars_vertex>
void main() {
  vec4 mv = viewMatrix * vec4(iA.xyz, 1.0);
  float c = cos(iA.w), s = sin(iA.w);
  vec2 q = position.xy * iB.xy;
  mv.xy += vec2(c * q.x - s * q.y, s * q.x + c * q.y);
  gl_Position = projectionMatrix * mv;
  float tile = floor(iB.z + 0.5);
  vec2 cell = vec2(mod(tile, ATLAS_COLS), floor(tile / ATLAS_COLS));
  vUv = (cell + uv) / vec2(ATLAS_COLS, ATLAS_ROWS);
  vColor = iC;
  #include <logdepthbuf_vertex>
}`
export const PARTICLE_FS = /* glsl */`
uniform sampler2D uMap;
varying vec2 vUv;
varying vec4 vColor;
#include <logdepthbuf_pars_fragment>
void main() {
  #include <logdepthbuf_fragment>
  float a = texture2D(uMap, vUv).a * vColor.a;
  if (a < 0.004) discard;
  gl_FragColor = vec4(vColor.rgb, a);
  #include <colorspace_fragment>
}`
export const RIBBON_VS = /* glsl */`
#include <common>
uniform vec3 uA;
uniform vec3 uB;
uniform float uWA;
uniform float uWB;
uniform float uMinPx;
uniform float uPxScale;
varying vec2 vUv;
#include <logdepthbuf_pars_vertex>
void main() {
  float s = position.y + 0.5;
  vec3 P = mix(uA, uB, s);
  vec3 dir = uB - uA;
  dir = length(dir) > 1e-4 ? normalize(dir) : vec3(0.0, 0.0, 1.0);
  vec3 toCam = cameraPosition - P;
  vec3 side = cross(dir, toCam);
  side = length(side) > 1e-6 ? normalize(side) : vec3(1.0, 0.0, 0.0);
  float w = max(mix(uWA, uWB, s), uMinPx * length(toCam) * uPxScale);
  P += side * position.x * w;
  vUv = vec2(position.x + 0.5, s);
  gl_Position = projectionMatrix * viewMatrix * vec4(P, 1.0);
  #include <logdepthbuf_vertex>
}`
export const RIBBON_FS = /* glsl */`
uniform vec3 uCA;
uniform vec3 uCB;
uniform float uAA;
uniform float uAB;
uniform float uCore;
uniform float uCoreAlong;
uniform float uOpacity;
varying vec2 vUv;
#include <logdepthbuf_pars_fragment>
void main() {
  #include <logdepthbuf_fragment>
  float across = 1.0 - abs(vUv.x * 2.0 - 1.0);
  vec3 col = mix(uCA, uCB, vUv.y);
  float core = uCore > 0.0 ? smoothstep(1.0 - uCore, 1.0, across) : 0.0;
  col = mix(col, vec3(1.0, 0.97, 0.9), core * mix(1.0, vUv.y, uCoreAlong));
  float a = mix(uAA, uAB, pow(vUv.y, 1.3)) * pow(across, 1.4) * uOpacity;
  if (a < 0.003) discard;
  gl_FragColor = vec4(col, a);
  #include <colorspace_fragment>
}`


// ---------- 粒子批次 ----------
/** 实例化粒子批次（加色 / 普通混合各一；容量按档位封顶）。 */
export interface ParticleBatch {
  mesh: Mesh
  capacity: number
  readonly count: number
  begin(): void
  push(x: number, y: number, z: number, rot: number, w: number, h: number, tile: number, color: Color, alpha: number): void
  finish(view?: ArrayLike<number>): void
  dispose(): void
}

export function createBatch(capacity: number, map: Texture, { additive, sorted, name }: { additive: boolean; sorted: boolean; name: string }): ParticleBatch {
  const geometry = new THREE.InstancedBufferGeometry()
  geometry.setIndex([0, 2, 1, 2, 3, 1])
  geometry.setAttribute('position', new THREE.Float32BufferAttribute([-0.5, 0.5, 0, 0.5, 0.5, 0, -0.5, -0.5, 0, 0.5, -0.5, 0], 3))
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute([0, 1, 1, 1, 0, 0, 1, 0], 2))
  const attrs = ['iA', 'iB', 'iC'].map((key) => {
    const attr = new THREE.InstancedBufferAttribute(new Float32Array(capacity * 4), 4).setUsage(THREE.DynamicDrawUsage)
    geometry.setAttribute(key, attr)
    return attr
  })
  geometry.instanceCount = 0
  const material = new THREE.ShaderMaterial({
    name, vertexShader: PARTICLE_VS, fragmentShader: PARTICLE_FS,
    defines: { ATLAS_COLS: ATLAS_COLS.toFixed(1), ATLAS_ROWS: ATLAS_ROWS.toFixed(1) },
    uniforms: { uMap: { value: map } },
    transparent: true, depthWrite: false, toneMapped: false, side: THREE.DoubleSide,
    blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
  })
  const mesh = new THREE.Mesh(geometry, material)
  mesh.name = name
  mesh.frustumCulled = false
  mesh.matrixAutoUpdate = false
  mesh.visible = false
  mesh.raycast = noop   // 单位四边形几何在原点：不参与拾取
  // 排序批次先写暂存区，按视深排序后再拷进 GPU 数组；加色批次与顺序无关，直写。
  const stage: Float32Array[] = sorted ? attrs.map(() => new Float32Array(capacity * 4)) : attrs.map((attr) => attr.array as Float32Array)
  const depth = sorted ? new Float32Array(capacity) : null
  const order: number[] = []
  let count = 0, uploaded = 0
  return {
    mesh,
    capacity,
    get count() { return count },
    begin() { count = 0 },
    push(x: number, y: number, z: number, rot: number, w: number, h: number, tile: number, color: Color, alpha: number): void {
      if (count >= capacity || !(alpha > 0.002) || !(w > 0) || !(h > 0)) return
      const o = count * 4
      const [A, B, D] = stage
      A[o] = x; A[o + 1] = y; A[o + 2] = z; A[o + 3] = rot
      B[o] = w; B[o + 1] = h; B[o + 2] = tile; B[o + 3] = 0
      D[o] = color.r; D[o + 1] = color.g; D[o + 2] = color.b; D[o + 3] = Math.min(1, alpha)
      count++
    },
    finish(view?: ArrayLike<number>): void {
      if (sorted && depth && view && count > 0) {
        const A = stage[0]
        order.length = count
        for (let i = 0; i < count; i++) {
          order[i] = i
          depth[i] = view[2] * A[i * 4] + view[6] * A[i * 4 + 1] + view[10] * A[i * 4 + 2] + view[14]
        }
        order.sort((a, b) => depth[a] - depth[b])   // 视空间 z 越小越远：远者先画
        for (let k = 0; k < 3; k++) {
          const src = stage[k], dst = attrs[k].array
          for (let i = 0; i < count; i++) {
            const s = order[i] * 4, d = i * 4
            dst[d] = src[s]; dst[d + 1] = src[s + 1]; dst[d + 2] = src[s + 2]; dst[d + 3] = src[s + 3]
          }
        }
      }
      if (count > 0 || uploaded > 0) {
        for (const attr of attrs) {
          attr.clearUpdateRanges()
          attr.addUpdateRange(0, count * 4)
          attr.needsUpdate = true
        }
      }
      uploaded = count
      geometry.instanceCount = count
      mesh.visible = count > 0
    },
    dispose(): void { geometry.dispose(); material.dispose() },
  }
}

export interface SparkLineBatch {
  lines: LineSegments
  readonly count: number
  begin(): void
  push(x: number, y: number, z: number, tx: number, ty: number, tz: number, color: Color, k: number): void
  finish(): void
  dispose(): void
}

export function createSparkLines(capacity: number): SparkLineBatch {
  const geometry = new THREE.BufferGeometry()
  const pos = new THREE.BufferAttribute(new Float32Array(capacity * 6), 3).setUsage(THREE.DynamicDrawUsage)
  const col = new THREE.BufferAttribute(new Float32Array(capacity * 6), 3).setUsage(THREE.DynamicDrawUsage)
  geometry.setAttribute('position', pos)
  geometry.setAttribute('color', col)
  geometry.setDrawRange(0, 0)
  const material = new THREE.LineBasicMaterial({
    vertexColors: true, transparent: true, depthWrite: false, toneMapped: false, blending: THREE.AdditiveBlending,
  })
  const lines = new THREE.LineSegments(geometry, material)
  lines.name = 'battle-fx-spark-trails'
  lines.frustumCulled = false
  lines.matrixAutoUpdate = false
  lines.visible = false
  lines.raycast = noop
  let count = 0
  return {
    lines,
    get count() { return count },
    begin() { count = 0 },
    push(x: number, y: number, z: number, tx: number, ty: number, tz: number, color: Color, k: number): void {
      if (count >= capacity) return
      const p = pos.array as Float32Array, c = col.array as Float32Array, o = count * 6
      p[o] = x; p[o + 1] = y; p[o + 2] = z; p[o + 3] = tx; p[o + 4] = ty; p[o + 5] = tz
      c[o] = color.r * k; c[o + 1] = color.g * k; c[o + 2] = color.b * k
      c[o + 3] = color.r * k * 0.15; c[o + 4] = color.g * k * 0.15; c[o + 5] = color.b * k * 0.15
      count++
    },
    finish(): void {
      geometry.setDrawRange(0, count * 2)
      pos.needsUpdate = col.needsUpdate = count > 0
      lines.visible = count > 0
    },
    dispose(): void { geometry.dispose(); material.dispose() },
  }
}
