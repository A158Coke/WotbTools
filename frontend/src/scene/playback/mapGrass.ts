// 草系统静态消费（上游 tools/export_map_glb.py 产物 map/<key>/grass.{json,bin,glb}，
// 2026-11-17 上游审计 H1；数据面证据见导出器区块头注）。
//
// 客户端 VegetationRenderObject = 程序化植被：几何内嵌在 .sc2（4 变体 × 3 LOD）、
// 逐图 albedo、密度取草地植被/光照图 alpha、128×128 网格翻转位、风参数逐层。
// 本模块把上游烘好的实例（60k/图，9 字节/实例）铺成 **按变体 × 世界分块的 InstancedMesh**
// （每块独立包围球 ⇒ 视锥剔除有效），风动在顶点着色器里按作者参数摆动。
//
// 帧与坐标：上游实例是**客户端世界系**（z 上）；本模块的 group 施加与 mapScenery 同款
// qFrame（Ry(π)·Rx(−π/2)），故位置用客户端 (x, y, z=地形高) 直接构造，旋转绕客户端 z 轴，
// 风摆在客户端 xy 平面内——与草原型几何的坐标系一致。
//
// 高度：调用方给 heightAt(客户端 x, 客户端 y)（渲染用地形高度场），实例贴地。
import * as THREE from 'three'

/** grass.json 契约（上游 export_grass 的写出形状）。 */
export interface GrassDoc {
  space: string
  version: number
  params: {
    baseColorMultiplier: number
    scaleVariation: number[]
    rotationVariation: number[]
    windAmplitude: number[]
    windDrag: number[]
    windSpring: number[]
    visibilityDistance: number[]
    lodRanges: number[]
    isLit: boolean
    densitySource: string
    [key: string]: unknown
  }
  meta: {
    grid: number
    target: number
    count: number
    densitySource: string
    cellsWithGrass: number
    bounds: { min: number[]; max: number[] }
    variations: number
    [key: string]: unknown
  }
  prototype: string
  instances: string
  instanceStride: number
}

/** 解码后的一条草实例（客户端世界系；flipped 为作者翻转位，仅留档）。 */
export interface GrassInstance {
  x: number
  y: number
  rot: number
  scale: number
  variation: number
  flipped: boolean
  /** 逐实例植被色（0..1；客户端 grass-vp.sl:117 的 vegetationColorMap 采样） */
  r: number
  g: number
  b: number
}

const STRIDE = 12
const SCALE_MIN = 0.4
const SCALE_MAX = 1.6

/**
 * 解析 grass.bin → 实例数组（纯函数，测试锚点）。
 * 布局（小端）：u16 xQ / u16 zQ / u16 rotQ / u8 scaleQ / u8 variation / u8 flipped /
 * u8 r / u8 g / u8 b（逐实例植被色 = vegetationColorMap 采样，客户端 grass-vp.sl:117）。
 * 长度不是 stride 的整数倍 / meta 缺失 ⇒ 返回 null（fail-closed 不渲染半截草层）。
 */
export function parseGrassBin(doc: GrassDoc, buffer: ArrayBuffer | Uint8Array): GrassInstance[] | null {
  if (!doc || !doc.meta || !doc.meta.bounds) return null
  if (doc.instanceStride !== undefined && doc.instanceStride !== STRIDE) return null
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer)
  if (!bytes.length || bytes.length % STRIDE !== 0) return null
  const bmin = doc.meta.bounds.min
  const bmax = doc.meta.bounds.max
  if (!Array.isArray(bmin) || !Array.isArray(bmax) || bmin.length < 2 || bmax.length < 2) return null
  const x0 = bmin[0]
  const y0 = bmin[1]
  const sx = bmax[0] - x0
  const sy = bmax[1] - y0
  if (!(sx > 0) || !(sy > 0)) return null
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const count = bytes.length / STRIDE
  const out: GrassInstance[] = new Array(count)
  for (let i = 0; i < count; i++) {
    const off = i * STRIDE
    const xq = view.getUint16(off, true)
    const zq = view.getUint16(off + 2, true)
    const rq = view.getUint16(off + 4, true)
    const sq = view.getUint8(off + 6)
    const variation = view.getUint8(off + 7)
    const flipped = view.getUint8(off + 8)
    out[i] = {
      x: x0 + (xq / 65535) * sx,
      y: y0 + (zq / 65535) * sy,
      rot: (rq / 65535) * Math.PI * 2,
      scale: SCALE_MIN + (sq / 255) * (SCALE_MAX - SCALE_MIN),
      variation,
      flipped: flipped !== 0,
      r: view.getUint8(off + 9) / 255,
      g: view.getUint8(off + 10) / 255,
      b: view.getUint8(off + 11) / 255,
    }
  }
  return out
}

/** 草材质（作者 albedo × baseColorMultiplier，alpha 裁切 + 作者风摆参数）。 */
export function makeGrassMaterial(map: THREE.Texture | null, params: GrassDoc['params'], maxZ: number): THREE.ShaderMaterial {
  if (map) { map.colorSpace = THREE.NoColorSpace; map.needsUpdate = true }
  const amp = Array.isArray(params.windAmplitude) && params.windAmplitude.length ? params.windAmplitude[0] : 0.2
  const spring = Array.isArray(params.windSpring) && params.windSpring.length ? params.windSpring[0] : 15
  const mult = typeof params.baseColorMultiplier === 'number' ? params.baseColorMultiplier : 1
  return new THREE.ShaderMaterial({
    uniforms: {
      map: { value: map },
      uTime: { value: 0 },
      uAmp: { value: amp },
      uSpring: { value: spring },
      uColorMul: { value: mult },
      uMaxZ: { value: maxZ > 1e-3 ? maxZ : 1 },
      uAlphaCutoff: { value: 0.5 },
    },
    vertexShader: `
      #include <common>
      #include <logdepthbuf_pars_vertex>
      uniform float uTime;
      uniform float uAmp;
      uniform float uSpring;
      uniform float uMaxZ;
      attribute vec3 aVegColor;
      varying vec2 vUv;
      varying vec3 vVegColor;
      void main() {
        #ifdef USE_INSTANCING
        mat4 im = modelMatrix * instanceMatrix;
        #else
        mat4 im = modelMatrix;
        #endif
        vUv = uv;
        vVegColor = aVegColor;
        vec3 p = position;
        // 作者风摆：高度权重平方（根部不动、梢部最大）；相位取实例平移的哈希
        float h = clamp(p.z / uMaxZ, 0.0, 1.0);
        float phase = fract(sin(dot(im[3].xy, vec2(12.9898, 78.233))) * 43758.5453) * 6.2831853;
        float sway = sin(uTime * uSpring + phase) * uAmp * h * h;
        p.xy += vec2(sway, sway * 0.45);
        gl_Position = projectionMatrix * viewMatrix * im * vec4(p, 1.0);
        #include <logdepthbuf_vertex>
      }`,
    fragmentShader: `
      #include <common>
      #include <logdepthbuf_pars_fragment>
      uniform sampler2D map;
      uniform float uColorMul;
      uniform float uAlphaCutoff;
      varying vec2 vUv;
      varying vec3 vVegColor;
      void main() {
        #include <logdepthbuf_fragment>
        vec4 c = texture2D(map, vUv);
        if (c.a < uAlphaCutoff) discard;
        // 客户端 grass-fp.sl:103（isLit=false 分支）：
        //   color = albedo.rgb × vegetationColor.rgb × grassBaseColorMult
        // albedo 是灰度形状图，颜色全靠逐实例 vegetationColor（同一张 grass map 的 RGB）。
        gl_FragColor = vec4(c.rgb * vVegColor * uColorMul, 1.0);
      }`,
    side: THREE.DoubleSide,
    transparent: false,
    depthWrite: true,
  })
}

/** 每块的世界边长（米，客户端系）：块级 InstancedMesh 独立包围球 ⇒ 视锥剔除有效。 */
const TILE_SIZE = 128

/**
 * 实例 + 原型 → 渲染组（纯构造，无 IO）。
 *
 * @param geometries 上游 grass.glb 的变体几何（**客户端坐标系**，调用方持有所有权）
 * @param options.heightAt 客户端 (x, y) → 地形 z；缺省 0
 * @param options.albedo 原型 albedo（由 extractGrassPrototypes 取）
 * @returns group 已施加 qFrame；materials 需由调用方每帧写 uTime（回放时钟）
 */
export function buildGrassMeshes(
  doc: GrassDoc,
  instances: GrassInstance[],
  geometries: THREE.BufferGeometry[],
  options?: {
    heightAt?: ((x: number, y: number) => number) | null
    albedo?: THREE.Texture | null
    /** 画质档实例预算（QUALITY_FEATURES.grass.instances）。缺省/负数 = 全量。
     *  超出预算时按等步长抽取（保持空间分布），不取前缀（前缀会按导出顺序聚集）。 */
    maxInstances?: number | null
  },
): { group: THREE.Group; materials: THREE.ShaderMaterial[]; dispose(): void } {
  const opts = options || {}
  const group = new THREE.Group()
  group.name = 'grassLayer'
  group.rotation.order = 'YXZ'
  group.rotation.set(-Math.PI / 2, Math.PI, 0)   // qFrame，与 mapScenery 同帧
  const buckets = new Map<string, { variation: number; matrices: THREE.Matrix4[]; colors: number[] }>()
  const mat4 = new THREE.Matrix4()
  const quat = new THREE.Quaternion()
  const pos = new THREE.Vector3()
  const scl = new THREE.Vector3()
  const zAxis = new THREE.Vector3(0, 0, 1)
  const total = instances.length
  const budget = typeof opts.maxInstances === 'number' && Number.isFinite(opts.maxInstances)
    ? Math.max(0, Math.min(total, Math.floor(opts.maxInstances)))
    : total
  const stride = budget > 0 && budget < total ? total / budget : 0
  for (let k = 0; k < budget; k++) {
    const i = stride ? Math.min(total - 1, Math.floor(k * stride)) : k
    const inst = instances[i]
    if (geometries.length === 0) break
    const variation = Math.min(inst.variation, geometries.length - 1)
    const tx = Math.floor(inst.x / TILE_SIZE)
    const ty = Math.floor(inst.y / TILE_SIZE)
    const key = variation + ':' + tx + ':' + ty
    let bucket = buckets.get(key)
    if (!bucket) { bucket = { variation, matrices: [], colors: [] }; buckets.set(key, bucket) }
    const gz = opts.heightAt ? opts.heightAt(inst.x, inst.y) : 0
    pos.set(inst.x, inst.y, gz)
    quat.setFromAxisAngle(zAxis, inst.rot)
    // flipped 格 = 几何镜像（逐格打散重复；客户端 flippedDensityMap 的用途，见导出器注）
    scl.set(inst.flipped ? -inst.scale : inst.scale, inst.scale, inst.scale)
    mat4.compose(pos, quat, scl)
    bucket.matrices.push(mat4.clone())
    bucket.colors.push(inst.r, inst.g, inst.b)
  }
  let maxZ = 1
  for (let gi = 0; gi < geometries.length; gi++) {
    const geo = geometries[gi]
    if (!geo) continue
    if (!geo.boundingBox) geo.computeBoundingBox()
    if (geo.boundingBox) maxZ = Math.max(maxZ, geo.boundingBox.max.z)
  }
  const material = makeGrassMaterial(opts.albedo || null, doc.params, maxZ)
  const materials = [material]
  const ownedGeometries: THREE.BufferGeometry[] = []
  const instancedMeshes: THREE.InstancedMesh[] = []
  for (const bucket of buckets.values()) {
    const proto = geometries[bucket.variation]
    if (!proto) continue
    // 每桶 clone 一份几何挂逐实例颜色属性（原型几何跨桶共享，直接加属性会互相覆盖）
    const geo = proto.clone()
    geo.setAttribute('aVegColor', new THREE.InstancedBufferAttribute(
      new Float32Array(bucket.colors), 3))
    ownedGeometries.push(geo)
    const mesh = new THREE.InstancedMesh(geo, material, bucket.matrices.length)
    instancedMeshes.push(mesh)
    for (let k = 0; k < bucket.matrices.length; k++) mesh.setMatrixAt(k, bucket.matrices[k])
    mesh.instanceMatrix.needsUpdate = true
    if (typeof mesh.computeBoundingSphere === 'function') mesh.computeBoundingSphere()
    else mesh.frustumCulled = false
    mesh.userData.annotationSurface = false
    group.add(mesh)
  }
  return {
    group,
    materials,
    dispose() {
      material.dispose()
      for (const mesh of instancedMeshes) mesh.dispose()   // 释放 instanceMatrix GPU 缓冲
      for (const g of ownedGeometries) g.dispose()
      group.clear()
    },
  }
}

/**
 * 从上游 grass.glb 提取变体几何（按节点 extras.grassVariation；按变体序号去重）。
 * 几何 **归原型 GLB 场景所有**（随它 dispose）；材质/贴图由本模块替换。
 */
export function extractGrassPrototypes(gltfScene: THREE.Object3D): {
  geometries: THREE.BufferGeometry[]
  albedo: THREE.Texture | null
} {
  const geometries: THREE.BufferGeometry[] = []
  let albedo: THREE.Texture | null = null
  gltfScene.traverse((node) => {
    const mesh = node as THREE.Mesh
    if (!mesh.isMesh || !mesh.geometry) return
    const ud = (mesh.userData || {}) as { grassVariation?: number }
    if (typeof ud.grassVariation !== 'number') return
    const idx = ud.grassVariation
    if (!geometries[idx]) geometries[idx] = mesh.geometry
    if (!albedo) {
      const m = (Array.isArray(mesh.material) ? mesh.material[0] : mesh.material) as THREE.MeshStandardMaterial | undefined
      if (m && m.map) albedo = m.map
    }
  })
  return { geometries: geometries.filter((g) => !!g), albedo }
}
