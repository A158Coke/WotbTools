/**
 * Texture-Baked Top-View prototype（Phase B，Maus-only developer 路线）——
 * 纯函数库（vitest 与 bake CLI 共用）。
 *
 * 确定性软件 bake：GLB 真实几何 + UV + 材质 + 纹理 → 正交俯视 RGBA。
 * - z-buffer：每像素取最上方可见 surface（面内双线性 z 插值）；
 * - UV：barycentric 插值 → 确定性纹理采样（wrap + bilinear）；
 * - alpha test：MASK 材质 alpha < cutoff 的片元丢弃（不写 z）；
 * - 中性化（B8）：真实纹理采样 → luminance / restrained desaturation，
 *   保留局部对比（grille/panel/AO/relief）——不制造阵营色；
 * - 无 dynamic light / shadow / reflection / gloss / outline / fake bevel。
 * 所有视觉信息来自 BlitzKit model.glb + 内嵌材质/纹理，确定性生成。
 */
import { deflateSync } from 'node:zlib'

/**
 * 确定性 bilinear + wrap 纹理采样（RGBA float 数组，行主序）。
 * @param {Float32Array} tex 像素数据（4 通道）
 * @param {number} w
 * @param {number} h
 * @param {number} u [0,1)（外部 wrap）
 * @param {number} v
 * @returns {[number,number,number,number]} rgba 0..255
 */
export function sampleTexture(tex, w, h, u, v) {
  const uu = u - Math.floor(u)
  const vv = v - Math.floor(v)
  const x = uu * w - 0.5
  const y = vv * h - 0.5
  const x0 = Math.max(0, Math.min(w - 1, Math.floor(x)))
  const y0 = Math.max(0, Math.min(h - 1, Math.floor(y)))
  const x1 = Math.max(0, Math.min(w - 1, x0 + 1))
  const y1 = Math.max(0, Math.min(h - 1, y0 + 1))
  const fx = x - x0
  const fy = y - y0
  const at = (px, py, c) => tex[(py * w + px) * 4 + c]
  const out = []
  for (let c = 0; c < 4; c++) {
    const c00 = at(x0, y0, c)
    const c10 = at(x1, y0, c)
    const c01 = at(x0, y1, c)
    const c11 = at(x1, y1, c)
    out.push(c00 * (1 - fx) * (1 - fy) + c10 * fx * (1 - fy) + c01 * (1 - fx) * fy + c11 * fx * fy)
  }
  return out
}

/**
 * UV barycentric 插值（确定性）：给定三角形 3 顶点 UV 与重心坐标 → UV。
 * 纯函数（B16 #9）。
 */
export function interpolateUV(uvs, w0, w1, w2) {
  return [
    w0 * uvs[0] + w1 * uvs[2] + w2 * uvs[4],
    w0 * uvs[1] + w1 * uvs[3] + w2 * uvs[5],
  ]
}

/**
 * 中性化（B8）：真实采样 → luminance / restrained desaturation → 保留局部对比。
 * @param {number[]} rgb [r,g,b] 0..255
 * @param {number} amount 去色强度（0=原色，1=纯灰）
 */
export function neutralize(rgb, amount = 0.75) {
  const luma = 0.299 * rgb[0] + 0.587 * rgb[1] + 0.114 * rgb[2]
  return [luma * (1 - amount) + rgb[0] * amount, luma * (1 - amount) + rgb[1] * amount, luma * (1 - amount) + rgb[2] * amount]
}

/**
 * 确定性正交俯视 bake（B2）：
 * 在 resolution×resolution 栅格上逐像素 z-buffer（面内 z 插值），赢家像素
 * 由 barycentric UV → 采样 baseColor × occlusion × normal-z relief → 中性化。
 * MASK 材质在 z 写入前做 alpha test（alpha < cutoff 的片元丢弃）。
 *
 * @param {object} opts
 *   triangles: [{ p: number[9]（模型坐标 x宽,y长,z高）, uv: number[6]|null, material: number }]
 *   textures: [{ data: Uint8Array|Float32Array（RGBA）, width, height }]
 *   materials: [{ baseColor: number, occlusion: number, normal: number,
 *                 alphaMode: 'OPAQUE'|'MASK', alphaCutoff: number }]
 *   bounds: { minX, minY, maxX, maxY }（世界）
 *   resolution: number（输出边长）
 *   desaturate: 0..1（默认 0.75）
 * @returns {{ rgba: Uint8Array, width, height, covered: number }}
 */
export function bakeTopView({ triangles, textures, materials, bounds, resolution = 640, desaturate = 0.75 }) {
  const texData = textures.map((t) => (t.data instanceof Float32Array ? t.data : new Float32Array(t.data)))
  const w = bounds.maxX - bounds.minX
  const h = bounds.maxY - bounds.minY
  if (!(w > 0) || !(h > 0)) throw new Error('bake bounds 无效')
  const scale = resolution / Math.max(w, h)
  const W = Math.max(1, Math.ceil(w * scale))
  const H = Math.max(1, Math.ceil(h * scale))
  const zbuf = new Float32Array(W * H).fill(-Infinity)
  const rgba = new Float32Array(W * H * 4).fill(0)
  const covered = new Uint8Array(W * H)
  for (const tri of triangles) {
    const mat = materials[tri.material]
    const baseTex = mat && texData[mat.baseColor] ? texData[mat.baseColor] : null
    const occTex = mat && texData[mat.occlusion] ? texData[mat.occlusion] : null
    const nrmTex = mat && texData[mat.normal] ? texData[mat.normal] : null
    const texW = mat && textures[mat.baseColor] ? textures[mat.baseColor].width : 0
    const texH = mat && textures[mat.baseColor] ? textures[mat.baseColor].height : 0
    const a = [tri.p[0], tri.p[1], tri.p[2]]
    const b = [tri.p[3], tri.p[4], tri.p[5]]
    const c = [tri.p[6], tri.p[7], tri.p[8]]
    // 投影 bbox（栅格）
    const ax = (a[0] - bounds.minX) * scale
    const ay = (a[1] - bounds.minY) * scale
    const bx = (b[0] - bounds.minX) * scale
    const by = (b[1] - bounds.minY) * scale
    const cx = (c[0] - bounds.minX) * scale
    const cy = (c[1] - bounds.minY) * scale
    const x0 = Math.max(0, Math.floor(Math.min(ax, bx, cx)))
    const x1 = Math.min(W - 1, Math.ceil(Math.max(ax, bx, cx)))
    const y0 = Math.max(0, Math.floor(Math.min(ay, by, cy)))
    const y1 = Math.min(H - 1, Math.ceil(Math.max(ay, by, cy)))
    if (x1 < x0 || y1 < y0) continue
    const v0x = bx - ax
    const v0y = by - ay
    const v1x = cx - ax
    const v1y = cy - ay
    const d = v0x * v1y - v0y * v1x
    if (Math.abs(d) < 1e-12) continue
    for (let y = y0; y <= y1; y++) {
      const row = y * W
      for (let x = x0; x <= x1; x++) {
        const qx = x + 0.5 - ax
        const qy = y + 0.5 - ay
        const w1 = (qx * v1y - qy * v1x) / d
        const w2 = (v0x * qy - v0y * qx) / d
        const w0 = 1 - w1 - w2
        if (w0 < 0 || w1 < 0 || w2 < 0) continue
        const z = w0 * a[2] + w1 * b[2] + w2 * c[2]
        const idx = row + x
        if (z <= zbuf[idx]) continue
        // MASK alpha test（在 z 写入前——失败片元不遮挡下层）
        let alpha = 255
        if (mat && mat.alphaMode === 'MASK' && tri.uv && baseTex) {
          const [u, v] = interpolateUV(tri.uv, w0, w1, w2)
          alpha = sampleTexture(baseTex, texW, texH, u, v)[3]
          if (alpha < (mat.alphaCutoff ?? 0.05) * 255) continue
        }
        zbuf[idx] = z
        // 颜色：baseColor × occlusion × normal-z relief
        let r = 255
        let g = 255
        let b2 = 255
        if (tri.uv && baseTex) {
          const [u, v] = interpolateUV(tri.uv, w0, w1, w2)
          const col = sampleTexture(baseTex, texW, texH, u, v)
          r = col[0]
          g = col[1]
          b2 = col[2]
          alpha = alpha === 255 ? col[3] : alpha
          if (occTex) {
            const o = sampleTexture(occTex, textures[mat.occlusion].width, textures[mat.occlusion].height, u, v)[0]
            const ao = 0.25 + 0.75 * (o / 255)
            r *= ao
            g *= ao
            b2 *= ao
          }
          if (nrmTex) {
            const n = sampleTexture(nrmTex, textures[mat.normal].width, textures[mat.normal].height, u, v)
            const nz = n[2] / 255 // 起伏 relief（不做夸张 3D 光照）
            const relief = 0.6 + 0.4 * nz
            r *= relief
            g *= relief
            b2 *= relief
          }
        }
        const [nr, ng, nb] = neutralize([r, g, b2], desaturate)
        rgba[idx * 4] = nr
        rgba[idx * 4 + 1] = ng
        rgba[idx * 4 + 2] = nb
        rgba[idx * 4 + 3] = alpha
        covered[idx] = 1
      }
    }
  }
  const out = new Uint8Array(W * H * 4)
  for (let i = 0; i < out.length; i++) out[i] = Math.max(0, Math.min(255, Math.round(rgba[i])))
  let cnt = 0
  for (let i = 0; i < covered.length; i++) cnt += covered[i]
  return { rgba: out, width: W, height: H, covered: cnt }
}

// —— PNG 编码（确定性，Node 内置 zlib；无外部依赖）——
const CRC_TABLE = (() => {
  const t = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    t[n] = c >>> 0
  }
  return t
})()
function crc32(buf) {
  let c = 0xffffffff
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}
function chunk(type, data) {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length)
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(body))
  return Buffer.concat([len, body, crc])
}

/**
 * RGBA → PNG（确定性编码，B16 #16 stable hash 用）。
 */
export function encodePng(rgba, width, height) {
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(width, 0)
  ihdr.writeUInt32BE(height, 4)
  ihdr[8] = 8 // bit depth
  ihdr[9] = 6 // color type RGBA
  // raw scanlines with filter byte 0
  const raw = Buffer.alloc(height * (width * 4 + 1))
  for (let y = 0; y < height; y++) {
    raw[y * (width * 4 + 1)] = 0
    rgba.subarray(y * width * 4, (y + 1) * width * 4).forEach((v, i) => {
      raw[y * (width * 4 + 1) + 1 + i] = v
    })
  }
  const idat = deflateSync(raw, { level: 9 })
  return Buffer.concat([sig, chunk('IHDR', ihdr), chunk('IDAT', idat), chunk('IEND', Buffer.alloc(0))])
}
