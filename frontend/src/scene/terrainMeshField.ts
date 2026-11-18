/** `terrain.json` / `X-Terrain-Meta` 的 `terrainLayout`：当前唯一认可的数据布局。 */
export const TERRAIN_LAYOUT_ENGINE_VERTEX = 2

export interface TerrainMeta {
  size?: number | string | null
  terrainLayout?: number | null
  zmin?: number | null
  zmax?: number | null
  worldBounds?: { min?: readonly unknown[]; max?: readonly unknown[] } | null
  terrainBinSha256?: string | null
}

/** 高度场解码所需的元字段必须齐全；缺一项就 fail-closed（不能拿缺省 layout/zmax 猜）。 */
export function terrainFieldMetaValid(meta: TerrainMeta | null): boolean {
  if (!meta || typeof meta !== 'object') return false;
  const n = Number(meta.size);
  // size=1 会被解码成单点场，但 buildAdaptiveTerrain 要求 n>=2 会抛错——提前 fail-closed。
  if (!Number.isInteger(n) || n < 2) return false;
  const layout = meta.terrainLayout;
  if (layout !== 1 && layout !== TERRAIN_LAYOUT_ENGINE_VERTEX) return false;
  // 必须先是真正的 number：null / '' / false 经 Number() 会变成 0，会被误认为合法高度范围。
  const zmin = meta.zmin, zmax = meta.zmax;
  if (typeof zmin !== 'number' || typeof zmax !== 'number') return false;
  // 允许 zmax === zmin（完全平坦的地图，k=0）；只拒绝缺失/倒置范围
  return Number.isFinite(zmin) && Number.isFinite(zmax) && zmax >= zmin;
}

/** 当前地形消费口径只支持居中、正方形 worldBounds（±300 契约）；非零中心/非方形 fail-closed。
 *  worldBounds 缺失（旧包）不在此判定，由调用方的 span 校验兜底。 */
export function terrainBoundsOk(meta: TerrainMeta | null): boolean {
  const wb = meta && meta.worldBounds;
  if (!wb) return true;
  const min = wb.min, max = wb.max;
  if (!Array.isArray(min) || !Array.isArray(max) || min.length < 2 || max.length < 2) return false;
  const [minX, minZ, maxX, maxZ] = [min[0] as number, min[1] as number, max[0] as number, max[1] as number];
  if (![minX, minZ, maxX, maxZ].every((v) => typeof v === 'number' && Number.isFinite(v))) return false;
  const cx = (minX + maxX) / 2;
  const cz = (minZ + maxZ) / 2;
  const dx = maxX - minX;
  const dy = maxZ - minZ;
  return Math.abs(cx) <= 1e-6 && Math.abs(cz) <= 1e-6
    && dx > 0 && Math.abs(dx - dy) <= 1e-6;
}

/**
 * 解码 `terrain.u16.bin` → 米制高度场（行主序，索引 = row*n+col）。**输出口径 = 场景系引擎顶点**：
 * 列 j / 行 i 恰是世界点 `((j/n − 0.5)·span, (i/n − 0.5)·span)` 处的引擎顶点高度——
 * 引擎 `Heightmap::GetPoint` 与 `tilemask-vp.sl` 都是 corner 口径（顶点 k 在 `k/size`、取 texel k），
 * 本文件网格（`wx`/`wz`）、`sampleHeight`、拾取诊断与水面岸线纹理都按这一口径读取。
 *
 * 布局（上游打包器 `map_assets.rs::parse_heightmap`；场景 x = −游戏 x 的镜像在列上做）：
 *   · `terrainLayout: 2`：上游按 corner 口径镜像（`out[c] = src[min(size−c, size−1)]`）⇒ 原样使用；
 *   · 缺省（旧包）：上游曾按 `out[c] = src[size−1−c]` 离散翻转——corner 口径下翻转后第 c 列的真实
 *     位置是 `((c+1)/n − 0.5)·span`，**整张地形沿场景 −x 偏一格**（span/512，600 m 图 1.17 m；
 *     2026-10-13 用户"墙前多出土包"——挡土墙低侧朝场景 −x 时路基被推出墙面）。读取边界在此平移
 *     一列补正：`field[c] = 旧[max(c−1, 0)]`；
 *   · 其余值：未知布局 ⇒ fail-closed 返回 null（宁可回退 2D，不画错位地形）。
 * ponytail: 两种布局都丢掉场景 +x 边界那一列顶点（源列 0，n 列表示不下 n+1 个顶点）——该列在
 *   地图包围盒边缘、可玩区之外；要逐点精确需把文件扩成 (n+1) 列（上游格式变更）。
 * @returns Float32Array(n*n) | null（尺寸不符 / 未知布局）
 */
export function decodeTerrainField(buf: ArrayBuffer | null, meta: TerrainMeta = {}): Float32Array | null {
  // 缺 terrain.json / 缺 layout/size/zmax 时**不得**用缺省值猜：layout 1 vs 2 差一列、
  // zmax 缺省会让高度整体缩放错误。旧包没有 layout 标记 ⇒ 同样回退 2D（fail-closed）。
  if (!terrainFieldMetaValid(meta)) return null;
  const n = Number(meta.size);
  if (!buf || buf.byteLength !== n * n * 2) return null;
  const layout = meta.terrainLayout;
  const shift = layout === 1 ? 1 : 0;
  const u16 = new Uint16Array(buf);
  const zmin = Number(meta.zmin);
  const k = (Number(meta.zmax) - zmin) / 65535;
  const field = new Float32Array(n * n);
  for (let r = 0; r < n; r++) {
    const row = r * n;
    for (let c = 0; c < n; c++) field[row + c] = u16[row + Math.max(c - shift, 0)] * k + zmin;
  }
  return field;
}

/**
 * json/bin 配对（PR #615 review P2）：`terrain.json`（no-cache）与 `terrain.u16.bin`（max-age=3600）是两次
 * 独立请求，布局标记只对同一次发布的 bin 成立——发布切换期"新 json + 浏览器缓存的旧 bin"会跳过补正，
 * "旧 json + 新 bin"会对已修正数据再平移一列。上游 `terrain.json` 带 `terrainBinSha256`（bin 的逐文件
 * sha256，与 manifest 同源）：
 *   · `pairedTerrainBinUrl`：以 sha 作 bin 的缓存键（浏览器 HTTP 缓存按完整 URL 区分；对象存储忽略该
 *     查询参数、Android 原生资产代理按 path 取并逐次 ETag 复验）⇒ 不会复用上一次发布缓存的旧 bin；
 *   · `terrainBinMatchesMeta`：解码前核对字节 sha256 ⇒ 发布进行中（json/bin 尚未同批）fail-closed。
 * 无 `terrainBinSha256` 的旧包：无从配对，沿用原行为；**有 sha 但 WebCrypto 不可用**
 * （非安全上下文/旧 WebView）⇒ fail-closed，不能假装配对成功。
 */
function terrainBinSha(meta: TerrainMeta | null): string | null {
  const s = meta && meta.terrainBinSha256;
  return typeof s === 'string' && /^[0-9a-f]{64}$/.test(s) ? s : null;
}

/** bin URL 附 `sha256=<terrainBinSha256>` 作缓存键；meta 无合法 sha 时原样返回。 */
export function pairedTerrainBinUrl(url: string | null | undefined, meta: TerrainMeta | null): string | null | undefined {
  const sha = terrainBinSha(meta);
  if (!url || !sha) return url;
  return `${url}${url.includes('?') ? '&' : '?'}sha256=${sha}`;
}

/** bin 字节与 meta 声明的 sha256 是否一致。
 *  无 sha（旧包）⇒ true（无从校验）；有 sha 但无 WebCrypto/buf ⇒ false（fail-closed）。 */
export async function terrainBinMatchesMeta(buf: ArrayBuffer | null, meta: TerrainMeta | null, subtle: SubtleCrypto | undefined = globalThis.crypto?.subtle): Promise<boolean> {
  const sha = terrainBinSha(meta);
  if (!sha) return true;
  if (!subtle || !buf) return false;
  const digest = new Uint8Array(await subtle.digest('SHA-256', buf));
  let hex = '';
  for (const b of digest) hex += b.toString(16).padStart(2, '0');
  return hex === sha;
}
