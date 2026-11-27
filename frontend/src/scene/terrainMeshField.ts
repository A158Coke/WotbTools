export const TERRAIN_LAYOUT_ENGINE_VERTEX = 2

export interface TerrainMeta {
  size?: number | string | null
  terrainLayout?: number | null
  zmin?: number | null
  zmax?: number | null
  worldBounds?: { min?: readonly unknown[]; max?: readonly unknown[] } | null
  terrainBinSha256?: string | null
}

export function terrainFieldMetaValid(meta: TerrainMeta | null): boolean {
  if (!meta || typeof meta !== 'object') return false;
  const n = Number(meta.size);
  if (!Number.isInteger(n) || n < 2) return false;
  const layout = meta.terrainLayout;
  if (layout !== 1 && layout !== TERRAIN_LAYOUT_ENGINE_VERTEX) return false;
  const zmin = meta.zmin, zmax = meta.zmax;
  if (typeof zmin !== 'number' || typeof zmax !== 'number') return false;
  return Number.isFinite(zmin) && Number.isFinite(zmax) && zmax >= zmin;
}

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

function terrainBinSha(meta: TerrainMeta | null): string | null {
  const s = meta && meta.terrainBinSha256;
  return typeof s === 'string' && /^[0-9a-f]{64}$/.test(s) ? s : null;
}

export function pairedTerrainBinUrl(url: string | null | undefined, meta: TerrainMeta | null): string | null | undefined {
  const sha = terrainBinSha(meta);
  if (!url || !sha) return url;
  return `${url}${url.includes('?') ? '&' : '?'}sha256=${sha}`;
}

export async function terrainBinMatchesMeta(buf: ArrayBuffer | null, meta: TerrainMeta | null, subtle: SubtleCrypto | undefined = globalThis.crypto?.subtle): Promise<boolean> {
  const sha = terrainBinSha(meta);
  if (!sha) return true;
  if (!subtle || !buf) return false;
  const digest = new Uint8Array(await subtle.digest('SHA-256', buf));
  let hex = '';
  for (const b of digest) hex += b.toString(16).padStart(2, '0');
  return hex === sha;
}
