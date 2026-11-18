interface TerrainSurfaceInput {
  positions: Float32Array
  sizeAt: Int32Array
  originIAt: Uint16Array | Uint32Array
  originJAt: Uint16Array | Uint32Array
  vertexIndexAt: Int32Array
  n: number
  span: number
}

/**
 * 常数时间采样自适应地形网格的真实三角面高度。
 * 使用 buildAdaptiveTerrain 生成时的 cell→step / grid-vertex→index 表和最终顶点高度，
 * 因此涵盖当前 LOD、morph 与跨 LOD 缝合，不做 mesh traversal 或重建。
 * 每格拓扑与发射器一致：沿反对角 (i+1,j)→(i,j+1) 分成两个三角形。
 */
export function terrainSurfaceHeightAt({ positions, sizeAt, originIAt, originJAt, vertexIndexAt, n, span }: TerrainSurfaceInput, x: number, z: number): number | null {
  if (!positions || !sizeAt || !originIAt || !originJAt || !vertexIndexAt || !Number.isInteger(n) || n < 2
    || !Number.isFinite(span) || span <= 0 || !Number.isFinite(x) || !Number.isFinite(z)) return null;
  const gx = (x / span + 0.5) * n, gz = (z / span + 0.5) * n;
  if (gx < 0 || gz < 0 || gx >= n || gz >= n) return null;
  const j = Math.floor(gx), i = Math.floor(gz);
  const step = sizeAt[i * n + j];
  if (!Number.isInteger(step) || step < 1) return null;
  const cell = i * n + j;
  const i0 = originIAt[cell], j0 = originJAt[cell];
  const i1 = Math.min(n, i0 + step), j1 = Math.min(n, j0 + step);
  if (i1 <= i0 || j1 <= j0) return null;
  const width = n + 1;
  const id00 = vertexIndexAt[i0 * width + j0], id01 = vertexIndexAt[i0 * width + j1];
  const id10 = vertexIndexAt[i1 * width + j0], id11 = vertexIndexAt[i1 * width + j1];
  if (id00 < 0 || id01 < 0 || id10 < 0 || id11 < 0) return null;
  const y00 = positions[id00 * 3 + 1], y01 = positions[id01 * 3 + 1];
  const y10 = positions[id10 * 3 + 1], y11 = positions[id11 * 3 + 1];
  if (!Number.isFinite(y00) || !Number.isFinite(y01) || !Number.isFinite(y10) || !Number.isFinite(y11)) return null;
  const tx = (gx - j0) / (j1 - j0), tz = (gz - i0) / (i1 - i0);
  return tx + tz <= 1
    ? y00 * (1 - tx - tz) + y01 * tx + y10 * tz
    : y01 * (1 - tz) + y10 * (1 - tx) + y11 * (tx + tz - 1);
}
