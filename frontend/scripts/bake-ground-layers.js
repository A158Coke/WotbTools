// 俯视烘焙的分层地表读取（**页面侧**：由 scripts/bake-ground-overhead.mjs 的 /bake 页面以
// vite 模块 URL 导入，同 shader-check-page.js；独立成文件是为了让读取策略可被 vitest 直接执行）。
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
