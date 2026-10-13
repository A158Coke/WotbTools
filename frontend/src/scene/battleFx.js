/**
 * 3D 回放战斗特效（只服务 3D 场景；2D 回放与 `utils/battlePlayback.js` 的 2D 常量不受影响）。
 *
 * 职责：击毁爆炸、开火、命中、残骸持续烟、曳光弹头与弹道光迹的外观，画质档位预算，
 * 以及这些特效的 GPU 资源（唯一 owner）。`playbackScene.js` 只负责"何时发生"（事件泵、
 * seek 语义、生命判据），这里负责"长什么样"。
 *
 * 结构：
 * - 所有 billboard 粒子（火球、烟、尘、碎片、炮口焰、命中火光、火星头）每帧**立即模式**
 *   写进两个实例化批次：加色一批、普通混合一批（后者按视深从远到近排序），各一次 draw call；
 *   火星拖尾一个 `LineSegments`。容量按档位封顶，超出的粒子直接丢弃——交火再激烈、残骸
 *   再多，粒子的 GPU 成本也有上限。
 * - 每个粒子的状态都是「特效年龄 → 外观」的纯函数（确定性哈希取随机），不积累逐粒子状态：
 *   seek、暂停、重绘任何一帧都得到同一结果。
 * - 曳光弹头 / 弹道光迹是相机朝向的条带 shader，宽度取「世界宽度」与「屏幕像素下限」的较大者，
 *   拉远看全场也不会细到消失。条带对象由本模块池化，`playbackScene` 只借用与归还。
 *
 * 时钟：爆炸 / 开火 / 命中按**壁钟**（与旧 impact 同语义：任意倍速下可读时长一致，暂停时自然
 * 播完）；弹道光迹停留与残骸烟是否存在按**回放时钟**（由调用方传入），残骸烟的翻滚相位由调用方
 * 传入的"播放中壁钟累计秒"驱动（倍速不加快、暂停冻结，不强制重绘）。
 *
 * 自定义 shader 一律手挂 logdepthbuf 代码块（`?logdepth` 开启时深度与内建材质一致），
 * 且不做 tone mapping（特效颜色直出，不被逐图曝光压暗）。
 */
import * as THREE from 'three'

/**
 * 画质档位预算（键与 `QUALITY_PRESETS` 一一对应；`QUALITY_PRESETS[k].fx` 引用这里）。
 * 信息类元素（曳光、光迹、命中火光、爆炸闪光）四档都有；氛围元素按档裁剪。
 * capacity = 每个粒子批次（加色 / 普通混合各一）的实例上限。
 */
export const FX_BUDGETS = Object.freeze({
  low: Object.freeze({
    capacity: 256, muzzleBrake: false, muzzleSmoke: 0, impactSparks: 6, impactSmoke: 0,
    burstFire: 5, burstSmoke: 6, burstSparks: 16, burstDebris: 0, burstDust: 0, wreckSmoke: 0, wreckEmbers: false,
  }),
  mid: Object.freeze({
    capacity: 512, muzzleBrake: true, muzzleSmoke: 0, impactSparks: 10, impactSmoke: 2,
    burstFire: 8, burstSmoke: 10, burstSparks: 32, burstDebris: 0, burstDust: 10, wreckSmoke: 0, wreckEmbers: false,
  }),
  high: Object.freeze({
    capacity: 1024, muzzleBrake: true, muzzleSmoke: 3, impactSparks: 16, impactSmoke: 4,
    burstFire: 11, burstSmoke: 16, burstSparks: 56, burstDebris: 12, burstDust: 16, wreckSmoke: 8, wreckEmbers: false,
  }),
  ultra: Object.freeze({
    capacity: 1536, muzzleBrake: true, muzzleSmoke: 6, impactSparks: 16, impactSmoke: 6,
    burstFire: 14, burstSmoke: 20, burstSparks: 80, burstDebris: 16, burstDust: 20, wreckSmoke: 12, wreckEmbers: true,
  }),
})

/** 击毁爆炸壁钟寿命（秒）。3D 专用，不再由 2D 的 `BURST_MS` 推导。 */
export const BURST_SECS = 4.2
/** 弹道光迹：弹头走完全程后停留 / 淡出（回放秒）。 */
export const TRAIL_HOLD_SECS = 2.5
export const TRAIL_FADE_SECS = 1.5
/** 曳光弹头尾迹长度（米）。 */
export const TRACER_STREAK_M = 14

const MUZZLE_FLASH_SECS = 0.24
const MUZZLE_SMOKE_SECS = 1.8
const IMPACT_FLASH_SECS = { pen: 0.18, nonpen: 0.13, ricochet: 0.1 }
const IMPACT_SMOKE_SECS = { pen: 1.8, nonpen: 1.4, ricochet: 1.2 }
const IMPACT_SPARK_SECS = 0.8
const MAX_FIRE = FX_BUDGETS.ultra.burstFire
const MAX_SMOKE = FX_BUDGETS.ultra.burstSmoke
const MAX_DUST = FX_BUDGETS.ultra.burstDust
const G = 9.8
const TAU = Math.PI * 2

/** 弹道光迹不透明度系数：`secsAfterFlight` = 回放时刻 − 弹头到达终点时刻（飞行中为负）。 */
export function trailOpacityAt(secsAfterFlight) {
  if (!(secsAfterFlight > TRAIL_HOLD_SECS)) return 1
  return Math.max(0, 1 - (secsAfterFlight - TRAIL_HOLD_SECS) / TRAIL_FADE_SECS)
}

const clamp01 = (x) => Math.max(0, Math.min(1, x))
const easeOut = (x) => 1 - (1 - clamp01(x)) ** 3
const smooth = (x) => { const t = clamp01(x); return t * t * (3 - 2 * t) }
/** 确定性哈希随机 [0,1)：同一 (seed, i, k) 永远同值——特效外观只依赖年龄。 */
function rnd(seed, i, k) {
  let x = Math.imul((seed | 0) ^ 0x9e3779b9, 0x85ebca6b) ^ Math.imul(i + 1, 0xc2b2ae35) ^ Math.imul(k + 1, 0x27d4eb2f)
  x ^= x >>> 15; x = Math.imul(x, 0x2c1b3c6d)
  x ^= x >>> 12; x = Math.imul(x, 0x297a2d39)
  x ^= x >>> 15
  return (x >>> 0) / 4294967296
}
const noop = () => {}

// ---------- 程序化贴图图集（4×2 格，每格 128 px，只用 alpha） ----------
const TILE = 128
const ATLAS_COLS = 4
const ATLAS_ROWS = 2
const FLAME_TILES = [0, 1, 7]
const SOOT_TILES = [2, 3]
const GLOW_TILE = 4
const STAR_TILE = 5
const CHUNK_TILE = 6
const turb = (u, v, p) => Math.sin(u * 9 + p + Math.sin(v * 7 + p * 1.3)) * Math.cos(v * 11 - u * 4 + p * 0.7)
  + 0.5 * Math.sin(u * 19 + v * 13 + p * 2.1)
const TILE_ALPHA = [
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
function flameAlpha(u, v, p) {
  const r = Math.hypot(u, v), t1 = turb(u, v, p), t2 = turb(u * 1.7, v * 1.7, p + 2.3)
  return Math.max(0, 1 - r * (1 + 0.18 * t1 + 0.08 * t2)) ** 1.4 * (0.8 + 0.2 * t2)
}
function sootAlpha(u, v, p) {
  const r = Math.hypot(u, v), t1 = turb(u, v, p), t2 = turb(u * 1.6, v * 1.6, p + 1.1)
  return Math.max(0, 1 - r * (1 + 0.22 * t1 + 0.1 * t2)) ** 1.1 * (0.62 + 0.24 * t1 + 0.14 * t2)
}
let atlasPixels = null
/** 图集像素只算一次（模块级缓存）；每个会话的 DataTexture 共用同一份只读数据。 */
function atlasData() {
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
const PARTICLE_VS = /* glsl */`
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
const PARTICLE_FS = /* glsl */`
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
const RIBBON_VS = /* glsl */`
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
const RIBBON_FS = /* glsl */`
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

// ---------- 颜色（three 线性空间；shader 末尾转输出色彩空间） ----------
const C = (hex) => new THREE.Color(hex)
const HOT = C(0xfff4dc), YEL = C(0xffc864), ORA = C(0xff7f2a), RED = C(0xa6381a)
const LIT = C(0x6e3d22), SOOT = C(0x1f1b18), ASH = C(0x46423d)
const DUST0 = C(0x8c7c63), DUST1 = C(0x6f685e)
const SPARK0 = C(0xfff0c0), SPARK1 = C(0xff6a1a)
const FLASH = C(0xfff0cc), GROUND_GLOW = C(0xff8a3a), MUZZLE = C(0xffc777), WHITE = C(0xffffff)
const PEN_SMOKE0 = C(0x3b3733), PEN_SMOKE1 = C(0x5b5751), GREY0 = C(0xa7a197), GREY1 = C(0x8d887f)
const MUZZLE_SMOKE = C(0xa29c92), DEBRIS = C(0x23201d)
const TRACER_HOT = C(0xff4d0f)

// ---------- 粒子批次 ----------
function createBatch(capacity, map, { additive, sorted, name }) {
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
  const stage = sorted ? attrs.map(() => new Float32Array(capacity * 4)) : attrs.map((attr) => attr.array)
  const depth = sorted ? new Float32Array(capacity) : null
  const order = []
  let count = 0, uploaded = 0
  return {
    mesh,
    capacity,
    get count() { return count },
    begin() { count = 0 },
    push(x, y, z, rot, w, h, tile, color, alpha) {
      if (count >= capacity || !(alpha > 0.002) || !(w > 0) || !(h > 0)) return
      const o = count * 4
      const [A, B, D] = stage
      A[o] = x; A[o + 1] = y; A[o + 2] = z; A[o + 3] = rot
      B[o] = w; B[o + 1] = h; B[o + 2] = tile; B[o + 3] = 0
      D[o] = color.r; D[o + 1] = color.g; D[o + 2] = color.b; D[o + 3] = Math.min(1, alpha)
      count++
    },
    finish(view) {
      if (sorted && count > 0) {
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
    dispose() { geometry.dispose(); material.dispose() },
  }
}

function createSparkLines(capacity) {
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
    push(x, y, z, tx, ty, tz, color, k) {
      if (count >= capacity) return
      const p = pos.array, c = col.array, o = count * 6
      p[o] = x; p[o + 1] = y; p[o + 2] = z; p[o + 3] = tx; p[o + 4] = ty; p[o + 5] = tz
      c[o] = color.r * k; c[o + 1] = color.g * k; c[o + 2] = color.b * k
      c[o + 3] = color.r * k * 0.15; c[o + 4] = color.g * k * 0.15; c[o + 5] = color.b * k * 0.15
      count++
    },
    finish() {
      geometry.setDrawRange(0, count * 2)
      pos.needsUpdate = col.needsUpdate = count > 0
      lines.visible = count > 0
    },
    dispose() { geometry.dispose(); material.dispose() },
  }
}

/**
 * 创建一个会话的战斗特效实例。`root` 由调用方加进场景；`dispose()` 释放全部 GPU 资源。
 * @param {typeof FX_BUDGETS.low} budget
 */
export function createBattleFx(budget) {
  const root = new THREE.Group()
  root.name = 'battle-fx'
  const atlas = new THREE.DataTexture(atlasData(), TILE * ATLAS_COLS, TILE * ATLAS_ROWS)
  atlas.generateMipmaps = true
  atlas.minFilter = THREE.LinearMipmapLinearFilter
  atlas.magFilter = THREE.LinearFilter
  atlas.needsUpdate = true
  const glow = createBatch(budget.capacity, atlas, { additive: true, sorted: false, name: 'battle-fx-glow' })
  const smoke = createBatch(budget.capacity, atlas, { additive: false, sorted: true, name: 'battle-fx-smoke' })
  const sparks = createSparkLines(Math.ceil(budget.capacity / 2))
  // 特效不写深度：排在场景其他透明物（水面、贴花等）之后画，组内按 光迹 → 烟 → 曳光 → 火光 叠放
  smoke.mesh.renderOrder = 10
  glow.mesh.renderOrder = sparks.lines.renderOrder = 12
  root.add(smoke.mesh, glow.mesh, sparks.lines)

  const pxScale = { value: 0.001 }
  const ribbonGeometry = new THREE.PlaneGeometry(1, 1, 1, 1)
  const ribbonPool = { tracer: [], trail: [] }
  const ribbonsOut = new Set()
  const teamColors = new Map()
  const bursts = [], muzzles = [], impacts = []
  const _c = new THREE.Color()

  function makeRibbon(kind) {
    const additive = kind === 'tracer'
    const mesh = new THREE.Mesh(ribbonGeometry, new THREE.ShaderMaterial({
      name: 'battle-fx-' + kind, vertexShader: RIBBON_VS, fragmentShader: RIBBON_FS,
      transparent: true, depthWrite: false, toneMapped: false, side: THREE.DoubleSide,
      blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
      uniforms: {
        uA: { value: new THREE.Vector3() }, uB: { value: new THREE.Vector3() },
        uWA: { value: 0.1 }, uWB: { value: 0.1 }, uMinPx: { value: 0 }, uPxScale: pxScale,
        uCA: { value: new THREE.Color() }, uCB: { value: new THREE.Color() },
        uAA: { value: 0 }, uAB: { value: 1 }, uCore: { value: 0 }, uCoreAlong: { value: 0 }, uOpacity: { value: 1 },
      },
    }))
    mesh.name = 'battle-fx-' + kind
    mesh.renderOrder = additive ? 11 : 9
    mesh.userData.ribbonKind = kind
    mesh.frustumCulled = false   // 顶点在 shader 里展开，几何包围球不代表真实位置
    mesh.matrixAutoUpdate = false
    mesh.raycast = noop
    return mesh
  }
  function teamColor(hex) {
    let entry = teamColors.get(hex)
    if (!entry) {
      const team = new THREE.Color(hex)
      entry = { team, head: team.clone().lerp(WHITE, 0.45), glow: team.clone().lerp(WHITE, 0.3) }
      teamColors.set(hex, entry)
    }
    return entry
  }
  function writeRibbon(mesh, a, b, wA, wB, minPx, cA, cB, aA, aB, core, coreAlong, opacity) {
    const u = mesh.material.uniforms
    u.uA.value.copy(a); u.uB.value.copy(b)
    u.uWA.value = wA; u.uWB.value = wB; u.uMinPx.value = minPx
    u.uCA.value.copy(cA); u.uCB.value.copy(cB)
    u.uAA.value = aA; u.uAB.value = aB; u.uCore.value = core; u.uCoreAlong.value = coreAlong
    u.uOpacity.value = opacity
  }

  /** 加色粒子 + 拖尾线段组成的一颗火星。 */
  function spark(x, y, z, vx, vy, vz, color, k, tail) {
    glow.push(x, y, z, 0, 0.28, 0.28, GLOW_TILE, color, k)
    sparks.push(x, y, z, x - vx * tail, y - vy * tail, z - vz * tail, color, k)
  }

  function emitBurst(e, a) {
    const { x, y, z, seed } = e
    if (a < 0.22) {
      const s = 9 + 8 * easeOut(a / 0.12)
      glow.push(x, y + 1.7, z, 0.4, s, s, STAR_TILE, FLASH, (1 - a / 0.22) ** 2)
    }
    if (a < 0.8) {
      // 贴地光斑：压扁的大光晕，模拟爆炸照亮地面
      const k = a / 0.8, s = 9 + 7 * easeOut(k)
      glow.push(x, y + 0.35, z, 0, s, s * 0.45, GLOW_TILE, GROUND_GLOW, 0.55 * (1 - k) ** 1.6)
    }
    const nFire = budget.burstFire, fireScale = (MAX_FIRE / nFire) ** 0.35
    for (let i = 0; i < nFire; i++) {
      const t = a - (i === 0 ? 0 : 0.01 + rnd(seed, i, 0) * 0.07), life = t / 1.0
      if (t < 0 || life >= 1) continue
      const th = rnd(seed, i, 1) * TAU, el = Math.asin(0.15 + rnd(seed, i, 2) * 0.85)
      const grow = easeOut(t / 0.3), r = 0.25 + 1.9 * grow
      const size = (2.0 + rnd(seed, i, 4) * 1.7) * fireScale * (0.45 + 1.75 * grow) * (1 + 0.25 * life)
      if (life < 0.1) _c.lerpColors(HOT, YEL, life / 0.1)
      else if (life < 0.45) _c.lerpColors(YEL, ORA, (life - 0.1) / 0.35)
      else _c.lerpColors(ORA, RED, (life - 0.45) / 0.55)
      glow.push(
        x + Math.cos(th) * Math.cos(el) * r,
        y + 1.5 + Math.sin(el) * r * 0.8 + life * (0.6 + rnd(seed, i, 3)) * 1.4,
        z + Math.sin(th) * Math.cos(el) * r,
        rnd(seed, i, 5) * TAU + (rnd(seed, i, 6) - 0.5) * 1.4 * t,
        size, size, FLAME_TILES[i % 3], _c, 0.78 * (1 - life) ** 1.4)
    }
    const nSmoke = budget.burstSmoke, smokeScale = (MAX_SMOKE / nSmoke) ** 0.3
    for (let i = 0; i < nSmoke; i++) {
      const delay = 0.10 + (i % 16) * 0.045 + rnd(seed, i, 10) * 0.03
      const t = a - delay, L = BURST_SECS - delay, life = t / L
      if (t < 0 || life >= 1) continue
      const th = rnd(seed, i, 11) * TAU, el = Math.asin(0.15 + rnd(seed, i, 12) * 0.85)
      const spread = 0.5 + 1.5 * easeOut(life)
      const size = (2.0 + rnd(seed, i, 13) * 1.2 + t * (1.8 + rnd(seed, i, 14) * 1.4)) * smokeScale
      if (t < 0.35) _c.lerpColors(LIT, SOOT, t / 0.35)
      else _c.lerpColors(SOOT, ASH, (t - 0.35) / (L - 0.35))
      smoke.push(
        x + Math.cos(th) * Math.cos(el) * spread + t * 0.45,
        y + 1.6 + t * (1.6 + rnd(seed, i, 15) * 1.5) * (1 - 0.3 * life),
        z + Math.sin(th) * Math.cos(el) * spread,
        rnd(seed, i, 16) * TAU + (rnd(seed, i, 17) - 0.5) * 0.5 * t,
        size, size * 1.08, SOOT_TILES[i % 2], _c, Math.min(1, t / 0.15) * 0.95 * (1 - life) ** 0.9)
    }
    const nDust = budget.burstDust
    for (let i = 0; i < nDust; i++) {
      const t = a - 0.02 - rnd(seed, i, 20) * 0.06, life = t / 1.8
      if (t < 0 || life >= 1) continue
      const angle = (i / nDust) * TAU + (rnd(seed, i, 21) - 0.5) * 0.35
      const dist = 5.5 + rnd(seed, i, 22) * 3.5
      const r = 1.8 + (dist - 1.8) * easeOut(t / 1.1)
      const size = (2.0 + rnd(seed, i, 23) * 1.6) * (0.6 + 1.1 * easeOut(life)) * (MAX_DUST / nDust) ** 0.3
      _c.lerpColors(DUST0, DUST1, life)
      smoke.push(x + Math.cos(angle) * r, y + 0.45 + 0.7 * life, z + Math.sin(angle) * r,
        rnd(seed, i, 24) * TAU, size * 1.3, size * 0.8, SOOT_TILES[i % 2], _c,
        Math.min(1, t / 0.05) * 0.55 * (1 - life) ** 1.4)
    }
    if (a < 1.5) {
      for (let i = 0; i < budget.burstSparks; i++) {
        const t = a - rnd(seed, i, 30) * 0.05, life = t / (0.55 + rnd(seed, i, 31) * 0.8)
        if (t < 0 || life >= 1) continue
        const th = rnd(seed, i, 32) * TAU, el = 0.2 + rnd(seed, i, 33) * 1.2, spd = 8 + rnd(seed, i, 34) * 16
        const vx0 = Math.cos(th) * Math.cos(el) * spd, vy0 = Math.sin(el) * spd, vz0 = Math.sin(th) * Math.cos(el) * spd
        let py = y + 1.6 + vy0 * t - 0.5 * G * t * t, vy = vy0 - G * t, k = (1 - life) ** 1.5
        if (py < y + 0.06) { py = y + 0.06; vy = 0; k *= 0.6 }
        _c.lerpColors(SPARK0, SPARK1, life)
        spark(x + vx0 * t, py, z + vz0 * t, vx0, vy, vz0, _c, k, 0.035)
      }
    }
    if (a < 3.4) {
      const fade = 1 - smooth((a - 2.6) / 0.8)
      for (let i = 0; i < budget.burstDebris; i++) {
        const th = rnd(seed, i, 40) * TAU, h = 2.5 + rnd(seed, i, 41) * 6, size = 0.3 + rnd(seed, i, 42) * 0.45
        const vy0 = 4 + rnd(seed, i, 43) * 7
        const tHit = (vy0 + Math.sqrt(vy0 * vy0 + 2 * G * 1.5)) / G
        const t = Math.min(a, tHit)
        smoke.push(x + Math.cos(th) * h * t, y + Math.max(0.05, 1.5 + vy0 * t - 0.5 * G * t * t), z + Math.sin(th) * h * t,
          rnd(seed, i, 44) * TAU + (rnd(seed, i, 45) - 0.5) * 14 * t,
          size, size * (0.5 + rnd(seed, i, 46) * 0.5), CHUNK_TILE, DEBRIS, fade)
      }
    }
  }

  function emitMuzzle(e, m) {
    const { x, y, z, dx, dy, dz, sx, sz, seed } = e
    if (m < MUZZLE_FLASH_SECS) {
      const f = m / MUZZLE_FLASH_SECS
      for (let i = 0; i < 3; i++) {
        const d = [0.5, 1.2, 2.0][i] * (0.7 + 0.5 * f), s = [1.9, 1.5, 1.0][i] * (0.8 + 0.5 * f)
        _c.lerpColors(WHITE, MUZZLE, f)
        glow.push(x + dx * d, y + dy * d, z + dz * d, rnd(seed, i, 0) * TAU, s, s, FLAME_TILES[i], _c, 0.95 * (1 - f) ** 2)
      }
    }
    if (m < 0.14) glow.push(x, y, z, rnd(seed, 0, 1) * TAU, 2.6, 2.6, STAR_TILE, WHITE, (1 - m / 0.14) ** 2)
    if (budget.muzzleBrake && m < 0.18) {
      for (const sgn of [1, -1]) {
        glow.push(x - dx * 0.25 + sx * sgn * 0.7, y - dy * 0.25, z - dz * 0.25 + sz * sgn * 0.7,
          0, 1, 1, FLAME_TILES[1], MUZZLE, 0.8 * (1 - m / 0.18) ** 2)
      }
    }
    const life = m / MUZZLE_SMOKE_SECS
    if (life < 1) {
      for (let i = 0; i < budget.muzzleSmoke; i++) {
        const d = (1.5 + rnd(seed, i, 10) * 3.2) * easeOut(m / 0.9)
        const fwd = 0.5 + rnd(seed, i, 11) * 0.5, lat = rnd(seed, i, 12) - 0.5, up = rnd(seed, i, 13) * 0.3
        const s = 0.7 + 2.6 * easeOut(m / 1.4)
        smoke.push(x + (dx * fwd + sx * lat) * d, y + dy * fwd * d + up * d + m * 0.4, z + (dz * fwd + sz * lat) * d,
          rnd(seed, i, 14) * TAU + m * 0.3, s, s, SOOT_TILES[i % 2], MUZZLE_SMOKE,
          Math.min(1, m / 0.04) * 0.55 * (1 - life) ** 1.3)
      }
    }
  }

  function emitImpact(e, a) {
    const { kind, x, y, z, dx, dy, dz, seed } = e
    const flashSecs = IMPACT_FLASH_SECS[kind]
    if (a < flashSecs) {
      const f = a / flashSecs
      const s = (kind === 'pen' ? 1.5 : kind === 'nonpen' ? 1.1 : 0.9) * (1 + 0.5 * easeOut(f * 2))
      _c.lerpColors(HOT, kind === 'pen' ? ORA : YEL, f)
      glow.push(x - dx * 0.2, y - dy * 0.2, z - dz * 0.2, rnd(seed, 0, 0) * TAU, s, s, FLAME_TILES[0], _c, (1 - f) ** 1.5)
    }
    // 命中点余火：击穿留一点橙色火光，未击穿只闪一下亮点；跳弹不留
    const glowSecs = kind === 'pen' ? 0.9 : kind === 'nonpen' ? 0.4 : 0
    if (a < glowSecs) {
      const s = kind === 'pen' ? 0.9 : 0.6
      glow.push(x - dx * 0.15, y - dy * 0.15, z - dz * 0.15, 0, s, s, GLOW_TILE, kind === 'pen' ? ORA : YEL,
        0.9 * (1 - a / glowSecs) ** 1.5)
    }
    const smokeSecs = IMPACT_SMOKE_SECS[kind]
    const nSmoke = kind === 'ricochet' ? Math.ceil(budget.impactSmoke / 2) : budget.impactSmoke
    const peak = kind === 'pen' ? 0.8 : kind === 'nonpen' ? 0.65 : 0.45
    for (let i = 0; i < nSmoke; i++) {
      const t = a - (0.03 + rnd(seed, i, 10) * 0.12), life = t / smokeSecs
      if (t < 0 || life >= 1) continue
      const spread = 0.4 + t, back = 0.4 + t * 0.3
      const s = (0.6 + rnd(seed, i, 11) * 0.4) * (1 + 2.2 * easeOut(life))
      if (kind === 'pen') _c.lerpColors(PEN_SMOKE0, PEN_SMOKE1, life)
      else _c.lerpColors(GREY0, GREY1, life)
      smoke.push(x - dx * back + (rnd(seed, i, 12) - 0.5) * 0.8 * spread,
        y - dy * back + t * (0.9 + rnd(seed, i, 13) * 0.8),
        z - dz * back + (rnd(seed, i, 14) - 0.5) * 0.8 * spread,
        rnd(seed, i, 15) * TAU + t * 0.4, s, s, SOOT_TILES[i % 2], _c,
        Math.min(1, t / 0.08) * peak * (1 - life) ** 1.4)
    }
    if (a < IMPACT_SPARK_SECS) {
      const head = kind === 'pen' ? ORA : SPARK0
      for (let i = 0; i < budget.impactSparks; i++) {
        const rx = (rnd(seed, i, 20) - 0.5) * 2, ry = rnd(seed, i, 21) * 1.6, rz = (rnd(seed, i, 22) - 0.5) * 2
        let vx, vy0, vz, lifeSecs
        if (kind === 'ricochet') {
          // 沿偏转方向的窄锥
          const spd = 12 + rnd(seed, i, 23) * 10
          vx = e.ox * spd + rx * 2.2; vy0 = e.oy * spd + ry * 2.2; vz = e.oz * spd + rz * 2.2
          lifeSecs = 0.25 + rnd(seed, i, 24) * 0.25
        } else {
          // 迎着来弹方向回溅：击穿低速橙色，未击穿高速亮白
          let bx = -dx * 0.6 + rx, by = -dy * 0.6 + ry, bz = -dz * 0.6 + rz
          const n = Math.hypot(bx, by, bz) || 1
          const spd = kind === 'pen' ? 3 + rnd(seed, i, 23) * 4 : 6 + rnd(seed, i, 23) * 8
          bx /= n; by /= n; bz /= n
          vx = bx * spd; vy0 = by * spd; vz = bz * spd
          lifeSecs = (kind === 'pen' ? 0.35 : 0.3) + rnd(seed, i, 24) * 0.3
        }
        const life = a / lifeSecs
        if (life >= 1) continue
        // 命中点在车体上、地面高度未知：不做落地钳制（寿命 ≤0.65 s，落到地下的部分由深度测试遮住）
        _c.lerpColors(head, SPARK1, life)
        spark(x + vx * a, y + vy0 * a - 0.5 * G * a * a, z + vz * a, vx, vy0 - G * a, vz, _c,
          (1 - life) ** 1.4, kind === 'ricochet' ? 0.06 : 0.035)
      }
    }
  }

  /** 残骸持续烟（+ 极致档余火）。`since` 回放秒（未知死亡时刻传 Infinity），`phase` 播放中壁钟累计秒。 */
  function emitWreck(x, y, z, yaw, since, phase, seed) {
    // 车体局部 (lx, lz) → 世界 xz（绕 Y 转 yaw；车头 +z，发动机舱在 -z 侧）
    const cos = Math.cos(yaw), sin = Math.sin(yaw)
    const n = budget.wreckSmoke
    const ramp = n > 0 ? smooth((since - 1.4) / 2.2) : 0
    if (ramp > 0) {
      const offset = rnd(seed, 0, 50)
      for (let i = 0; i < n; i++) {
        const ph = (phase * 0.2 + i / n + offset) % 1, age = ph * 5
        const lx = (rnd(seed, i, 51) - 0.5) * 0.8 + age * (0.7 + rnd(seed, i, 52) * 0.6) * 0.7
        const lz = -1.6 + (rnd(seed, i, 53) - 0.5) * 0.8 + age * 0.25
        const size = 1.4 + ph * 5.5
        _c.lerpColors(SOOT, ASH, ph)
        smoke.push(x + lx * cos + lz * sin, y + 1.7 + ph * 11, z - lx * sin + lz * cos,
          i * 2.39996323 + ph * 0.9, size, size * 1.1, SOOT_TILES[i % 2], _c,
          ramp * smooth(ph / 0.12) * (1 - ph) ** 1.3 * 0.85)
      }
    }
    if (budget.wreckEmbers) {
      const er = smooth((since - 0.7) / 0.6) * (1 - smooth((since - 6) / 4))
      if (er > 0.001) {
        for (let i = 0; i < 3; i++) {
          const f = 0.55 + 0.45 * Math.sin(phase * (9 + rnd(seed, i, 60) * 6) + i * 2.1) * Math.sin(phase * (5 + rnd(seed, i, 61) * 4) + i)
          const size = 0.8 + 0.5 * f
          const lx = (i - 1) * 0.6, lz = -1.9 + rnd(seed, i, 62) * 0.5
          _c.lerpColors(ORA, YEL, f * 0.6)
          glow.push(x + lx * cos + lz * sin, y + 1.75 + 0.2 * f, z - lx * sin + lz * cos,
            0, size, size * 1.5, FLAME_TILES[i], _c, 0.6 * er * f)
        }
      }
    }
  }

  const replayEmit = {
    /** 曳光弹头光晕（阵营色偏白）。 */
    headGlow(pos, hex) {
      glow.push(pos.x, pos.y, pos.z, 0, 2.2, 2.2, GLOW_TILE, teamColor(hex).glow, 0.9)
    },
    wreck: emitWreck,
  }

  function expireAndEmit(list, lifeSecs, nowMs, emit) {
    for (let i = list.length - 1; i >= 0; i--) {
      const e = list[i], age = (nowMs - e.bornMs) / 1000
      if (age >= lifeSecs(e)) { list.splice(i, 1); continue }
      emit(e, Math.max(0, age))
    }
  }
  const burstLife = () => BURST_SECS
  const muzzleLife = () => (budget.muzzleSmoke > 0 ? MUZZLE_SMOKE_SECS : MUZZLE_FLASH_SECS)
  const impactLife = (e) => Math.max(IMPACT_SPARK_SECS, budget.impactSmoke > 0 ? IMPACT_SMOKE_SECS[e.kind] + 0.15 : 0,
    e.kind === 'pen' ? 0.9 : 0)

  return {
    root,
    budget,

    /** 借一条条带（`tracer` = 加色曳光弹头，`trail` = 普通混合弹道光迹），已挂进 root。 */
    takeRibbon(kind) {
      const mesh = ribbonPool[kind].pop() || makeRibbon(kind)
      mesh.visible = true
      ribbonsOut.add(mesh)
      root.add(mesh)
      return mesh
    },
    giveRibbon(mesh) {
      if (!ribbonsOut.delete(mesh)) return
      root.remove(mesh)
      mesh.visible = false
      ribbonPool[mesh.userData.ribbonKind].push(mesh)
    },
    /** 曳光弹头：tail → head，白热弹头 + 阵营色渐隐尾迹。 */
    setTracer(mesh, tail, head, hex) {
      const c = teamColor(hex)
      writeRibbon(mesh, tail, head, 0.08, 0.6, 2.4, c.team, c.head, 0, 1, 0.35, 1, 1)
    },
    /** 弹道光迹：阵营色细线、柔边、整段等宽，`opacity` 见 trailOpacityAt。 */
    setTrail(mesh, a, b, hex, opacity) {
      const c = teamColor(hex)
      writeRibbon(mesh, a, b, 0.16, 0.16, 1.6, c.team, c.team, 0.62, 0.62, 0.3, 0, opacity)
    },

    spawnBurst(pos, nowMs, seed) {
      bursts.push({ x: pos.x, y: pos.y, z: pos.z, seed: seed | 0, bornMs: nowMs })
    },
    /** dir：炮口朝向（单位向量）。 */
    spawnMuzzle(pos, dir, nowMs, seed) {
      const sl = Math.hypot(dir.z, dir.x) || 1
      muzzles.push({ x: pos.x, y: pos.y, z: pos.z, dx: dir.x, dy: dir.y, dz: dir.z,
        sx: dir.z / sl, sz: -dir.x / sl, seed: seed | 0, bornMs: nowMs })
    },
    /** kind：impactKind() 的结果；dir：来弹方向；out：跳弹出射方向（缺省按来弹方向上挑）。 */
    spawnImpact(kind, pos, dir, out, nowMs, seed) {
      if (!IMPACT_FLASH_SECS[kind]) return
      let ox = 0, oy = 0, oz = 0
      if (kind === 'ricochet') {
        const o = out || { x: dir.x, y: dir.y + 0.8, z: dir.z }
        const n = Math.hypot(o.x, o.y, o.z) || 1
        ox = o.x / n; oy = o.y / n; oz = o.z / n
      }
      impacts.push({ kind, x: pos.x, y: pos.y, z: pos.z, dx: dir.x, dy: dir.y, dz: dir.z, ox, oy, oz,
        seed: seed | 0, bornMs: nowMs })
    },

    /** 有尚未播完的壁钟特效（爆炸 / 开火 / 命中）：调用方据此保持逐帧重绘。 */
    active() { return bursts.length > 0 || muzzles.length > 0 || impacts.length > 0 },
    /** 存活中的爆炸（只读快照：位置、种子、出生壁钟）。 */
    activeBursts() { return bursts.map(({ x, y, z, seed, bornMs }) => ({ x, y, z, seed, bornMs })) },
    stats() {
      return { bursts: bursts.length, muzzles: muzzles.length, impacts: impacts.length,
        glow: glow.count, smoke: smoke.count, sparks: sparks.count, ribbons: ribbonsOut.size }
    },
    /** seek：壁钟特效直接清空，不补播；回放时钟驱动的条带由调用方归还。 */
    clearTransients() { bursts.length = 0; muzzles.length = 0; impacts.length = 0 },

    /**
     * 每个渲染帧调用一次（render 之前）：按优先级（命中 → 开火 → 爆炸 → 回放驱动粒子）
     * 写粒子，容量满时低优先级的先被丢弃。
     * @param {(emit: typeof replayEmit) => void} [emitReplay] 回放时钟驱动的粒子（弹头光晕、残骸烟）
     */
    frame(nowMs, camera, viewportHeightPx, emitReplay) {
      pxScale.value = 2 * Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2) / Math.max(1, viewportHeightPx)
      glow.begin(); smoke.begin(); sparks.begin()
      expireAndEmit(impacts, impactLife, nowMs, emitImpact)
      expireAndEmit(muzzles, muzzleLife, nowMs, emitMuzzle)
      expireAndEmit(bursts, burstLife, nowMs, emitBurst)
      if (emitReplay) emitReplay(replayEmit)
      camera.updateMatrixWorld()
      smoke.finish(camera.matrixWorldInverse.elements)
      glow.finish()
      sparks.finish()
    },

    /** 着色器预热：临时显示批次与两种条带样本，交给调用方的 compile。 */
    prewarm(compile) {
      const samples = [this.takeRibbon('tracer'), this.takeRibbon('trail')]
      const objects = [glow.mesh, smoke.mesh, sparks.lines]
      const was = objects.map((o) => o.visible)
      for (const o of objects) o.visible = true
      try { compile() } finally {
        objects.forEach((o, i) => { o.visible = was[i] })
        for (const s of samples) this.giveRibbon(s)
      }
    },

    dispose() {
      root.parent?.remove(root)
      glow.dispose(); smoke.dispose(); sparks.dispose()
      for (const mesh of [...ribbonsOut, ...ribbonPool.tracer, ...ribbonPool.trail]) mesh.material.dispose()
      ribbonsOut.clear(); ribbonPool.tracer.length = 0; ribbonPool.trail.length = 0
      ribbonGeometry.dispose()
      atlas.dispose()
      bursts.length = 0; muzzles.length = 0; impacts.length = 0
    },
  }
}
