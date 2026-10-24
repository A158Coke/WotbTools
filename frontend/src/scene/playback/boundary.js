// 地图边界带（2026-10-24 自 initPlayback 闭包出仓为工厂，拆分计划见
// docs/current-plan.md；代码与搬移前逐字一致，boundaryGroup 改由本工厂私有持有）。
import * as THREE from 'three'

// ---------- 地图边界带 ----------
// 边界 = 游戏内实际战场范围（playableBoundsMeters），比真实地图 worldBounds(±300) 小。
// 边界线是连续带（不是离散分段标注）：沿闭合矩形按 BOUNDARY_STEP 采样、逐顶点贴地，
// 起伏地形上不被埋掉。与上游 Agent 同式（上游表按数字 map_id，本表按 mapCode）。
const BOUNDARY_COLOR = 0xff2f2f;
const BOUNDARY_THICK = 1.8;   // 带宽（米）
const BOUNDARY_STEP = 2.0;    // 采样步长（米）：越小越贴合地形

/**
 * @param {Object} deps
 * @param {() => THREE.Scene} deps.getScene 场景 getter（scene 在 initScene 才创建，
 *   工厂创建期不可直接捕获）
 * @param {(root: THREE.Object3D, shared?: unknown) => void} deps.disposeObject3D
 *   会话统一的子树释放器（与场景其余 teardown 同一份）
 * @param {(x: number, z: number) => number} deps.groundY 贴地高度采样（闭包内
 *   函数声明，创建期引用安全——调用时才求值）
 */
export function createBoundaryBand({ getScene, disposeObject3D, groundY }) {
  let boundaryGroup = null;

  function clear() {
    if (!boundaryGroup) return;
    const old = boundaryGroup.userData.sharedMaterial;
    if (old) old.dispose();
    getScene().remove(boundaryGroup);
    disposeObject3D(boundaryGroup);
    boundaryGroup = null;
  }

  // 边界只认权威可玩范围（playableBounds）：**fail-closed**——拿不到就不画。
  // 车辆范围 / 地形 span / worldBounds 都不是「游戏内红色战场边界」的证据，
  // 不得作为兜底（历史实现曾用车辆 ext 与 terrain span 兜底，会凭空画出一条
  // 与玩法不符的边界）。
  function build(bounds, thick) {
    clear();
    if (!bounds) return;
    const { cx, cz, hx, hz } = bounds;
    const x0 = cx - hx, x1 = cx + hx, z0 = cz - hz, z1 = cz + hz;
    // 闭合路径（顺时针四条边，角点精确落在 (±hx, ±hz)）
    const path = [];
    const push = (ax, az, bx, bz) => {
      const len = Math.hypot(bx - ax, bz - az);
      const n = Math.max(2, Math.ceil(len / BOUNDARY_STEP));
      for (let i = 0; i < n; i++) {
        const t = i / n;
        path.push([ax + (bx - ax) * t, az + (bz - az) * t]);
      }
    };
    push(x0, z0, x1, z0);   // 北
    push(x1, z0, x1, z1);   // 东
    push(x1, z1, x0, z1);   // 南
    push(x0, z1, x0, z0);   // 西
    const N = path.length;
    const pos = new Float32Array(N * 2 * 3);
    const idx = [];
    const half = thick / 2;
    for (let i = 0; i < N; i++) {
      const [px, pz] = path[i];
      const [nx2, nz2] = path[(i + 1) % N];
      const [ox, oz] = path[(i - 1 + N) % N];
      let tx = nx2 - ox, tz = nz2 - oz;               // 切线 → 水平面内左法线
      const tl = Math.hypot(tx, tz) || 1; tx /= tl; tz /= tl;
      const lx = -tz, lz = tx;
      const y = groundY(px, pz) + 0.06;               // 贴地面（随地形起伏）
      pos[i * 6] = px + lx * half; pos[i * 6 + 1] = y; pos[i * 6 + 2] = pz + lz * half;
      pos[i * 6 + 3] = px - lx * half; pos[i * 6 + 4] = y; pos[i * 6 + 5] = pz - lz * half;
    }
    for (let i = 0; i < N; i++) {
      const j = (i + 1) % N;
      idx.push(i * 2, i * 2 + 1, j * 2, i * 2 + 1, j * 2 + 1, j * 2);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setIndex(idx);
    geo.computeVertexNormals();
    // 标记/反馈层约定：`toneMapped: false` 字面色直出——逐图曝光（toneMappingExposure =
    // 基准太阳强度/该图强度）只服务受光内容，不得让 UI 语义色的标记随图变深
    //（2026-10-11 用户报"作者圆环与边界红线在加了光照后变深"：山地图 expo≈0.21 会压到 1/5）。
    const mat = new THREE.MeshBasicMaterial({
      color: BOUNDARY_COLOR, side: THREE.DoubleSide, toneMapped: false,
      polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,   // 防与地形 z-fighting
    });
    const g = new THREE.Group();
    g.add(new THREE.Mesh(geo, mat));
    g.userData.sharedMaterial = mat;
    boundaryGroup = g;
    getScene().add(g);
  }

  return { build, clear };
}

export { BOUNDARY_THICK };
