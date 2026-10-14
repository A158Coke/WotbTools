// 俯视烘焙地面 pass 的输入完整性：分层地表读取 + 地形配对判定（**页面侧**：由
// scripts/bake-ground-overhead.mjs 的 /bake 页面以 vite 模块 URL 导入，同 shader-check-page.js；
// 独立成文件是为了让读取/判定策略可被 vitest 直接执行）。
//
// fail-closed（PR #621 review blocker）：此前页面内联读取在 ground.layers.json 或任一
// ground/<layer>.webp 缺失/解码失败时只 console.warn、留 groundLayers=null，随后仍以
// mapTexture:null 建地面网格——groundPass.makeGroundMaterial 的回退档即无贴图
// MeshBasicMaterial（不透明纯白）——meta 却写 ground=true，tools/composite_overhead.py
// 据此"覆盖即替换"，把白地面盖到 ground.webp 上。烘焙侧没有回退底图（回退档只对 3D 运行时
// 合法：那里 mapTexture 是真实资源），所以这里只有两种结局：返回完整分层，或抛出带资源名的
// 错误（抛出前释放已解码的纹理）。键集 = groundPass.groundLayerKeys（与运行时同一份）；
// 上传契约（setupGroundTextures）由调用方按渲染器能力施加。
import { groundLayerKeys } from '../src/scene/groundPass.js'

// TextureLoader 解码失败 reject 的是 DOM Event（无 message）——取 type，免得日志只剩 [object Event]
const reason = (e) => (e && (e.message || e.type)) || String(e)

/**
 * @param {{ base: string, fetchFn: (url: string) => Promise<Response>,
 *           loadTexture: (blob: Blob) => Promise<import('three').Texture> }} opts
 *   base = 地图目录 URL（以 `/` 结尾）；loadTexture = blob → 纹理（页面侧 TextureLoader 解码）
 * @returns {Promise<{ layers: object, texs: Record<string, import('three').Texture> }>}
 */
export async function loadBakeGroundLayers({ base, fetchFn, loadTexture }) {
  let r
  try { r = await fetchFn(base + 'ground.layers.json') } catch (e) { throw new Error(`ground.layers.json 下载失败: ${reason(e)}`) }
  if (!r.ok) throw new Error(`ground.layers.json 缺失（HTTP ${r.status}）`)
  let layers
  try { layers = await r.json() } catch (e) { throw new Error(`ground.layers.json 无法解析: ${reason(e)}`) }
  if (!layers || typeof layers !== 'object') throw new Error('ground.layers.json 无法解析: 顶层不是对象')
  const texs = {}
  try {
    for (const k of groundLayerKeys(layers)) {
      let tr
      try { tr = await fetchFn(base + 'ground/' + k + '.webp') } catch (e) { throw new Error(`ground layer 下载失败: ${k}: ${reason(e)}`) }
      if (!tr.ok) throw new Error(`ground layer 缺失: ${k}（HTTP ${tr.status}）`)
      let blob
      try { blob = await tr.blob() } catch (e) { throw new Error(`ground layer 下载失败: ${k}: ${reason(e)}`) }
      try { texs[k] = await loadTexture(blob) } catch (e) { throw new Error(`ground layer 解码失败: ${k}: ${reason(e)}`) }
    }
  } catch (e) {
    for (const k in texs) texs[k].dispose()
    throw e
  }
  return { layers, texs }
}

const httpOk = (s) => s >= 200 && s < 300

/**
 * 地形配对 fail-closed 判定（PR #621 re-review P2）：按 loadTerrain 回报的 HTTP 事实判定，不靠 meta 是否有键猜。
 *   json 404 + bin 404 → 整图无地形：返回 false（无地面口径，ground=false）
 *   json 有效 + field 解出 → 返回 true（渲染地面 pass）
 *   其余一律抛出——尤其 json 缺而 bin 在：loadTerrain 会以缺省 size/layout/zmin/zmax 解码，field 非空也不可信。
 * @param {{ field: Float32Array|null, metaStatus: number|null, binStatus: number|null }} t
 * @returns {boolean} 是否有地形
 */
export function requireBakeTerrain({ field, metaStatus, binStatus }) {
  if (httpOk(metaStatus) && field) return true
  if (metaStatus === 404 && binStatus === 404) return false
  if (!httpOk(metaStatus) && httpOk(binStatus)) {
    throw new Error(`terrain 不完整: terrain.json 缺失（HTTP ${metaStatus}）但 terrain.u16.bin 存在——拒绝以缺省 size/layout/zmin/zmax 解码`)
  }
  if (!httpOk(metaStatus)) throw new Error(`terrain 不完整: terrain.json 读取失败（HTTP ${metaStatus}）`)
  if (!httpOk(binStatus)) throw new Error(`terrain 不完整: terrain.json 存在但 terrain.u16.bin 缺失（HTTP ${binStatus}）`)
  throw new Error('terrain 不完整: terrain.u16.bin 与 terrain.json 不配对（terrainBinSha256 不符或尺寸/布局无法解码）')
}
