import type { InstancedMesh } from 'three'
import { buildDestructibleIndex, foldDestructibleStates, fallStopAngle } from '../destructibles.js'
import type { DestructibleEvent, DestructibleInstance, DestructibleSlot } from '../destructibles.js'
import type { MapAssemblyContext, MapAssemblyWrites } from './mapAssets.js'
import type { BatchedEntry } from './mapAssets.js'

/**
 * 可破坏物清单 → 批次槽位装配（树倒逐实例矩阵 / 建筑换模槽位 / 树高与停止角 /
 * 动态批次包围球保守扩张）——自 mapAssets.ts 的 assembleMapScenery 出仓
 * （2026-11-21 #LOC 结构拆分：代码与搬移前逐字一致；`mesh.userData.occluderBox = null`
 * 的守卫行仍留在宿主装配段）。
 */

/** 槽位装配产物（宿主发布 writes、算 pickList/meshOwner 并对动态批次回退包围球）。 */
export interface DestructibleAssembly {
  destruct: MapAssemblyWrites['destruct']
  /** 运行期实例矩阵会变的批次（树倒/换模）：宿主对其置 `userData.occluderBox = null`。 */
  volatileBatches: Set<InstancedMesh>
}

/** 可破坏物匹配索引消费段：foldDestructibleStates + 槽位化 + 包围球扩张。 */
export function assembleDestructibleSlots(
  DATA: NonNullable<MapAssemblyContext['DATA']>,
  destructDoc: { instances?: DestructibleInstance[] },
  findMeshes: (px: number, py: number, wantDestroyed: boolean, r?: number) => BatchedEntry[],
  ctx: Pick<MapAssemblyContext, 'heightField' | 'sampleHeight' | 'DEBUG'>,
): DestructibleAssembly {
  const areasByEid = new Map((DATA.destructible_areas || []).map((a) => [a.eid, a]));
  const index = buildDestructibleIndex(destructDoc);
  const states = foldDestructibleStates(DATA.destructible_events as DestructibleEvent[], areasByEid, index);
  // 可破坏物**槽位化**：不再重挂 pivot——状态持 { mesh, idx, base } 槽位。
  // 树倒 = T(p)·R·T(−p)·base 逐实例矩阵（与旧 pivot 装配逐值等价，等价性由
  // sceneryInstancing.geometry.test.js 随机位姿锁定）；建筑换模 = 完好/损毁槽位在 base
  // 与隐藏矩阵之间翻转。pivot 原点/树高/停止角公式与旧实现逐项一致。
  const slotOf = (e: BatchedEntry): DestructibleSlot => ({ mesh: e.batch.mesh, idx: e.idx, base: e.matrix });
  for (const st of states) {
    const [px, py] = st.inst.pos;
    if (st.prop === 3) {
      const hits = findMeshes(px, py, false);
      if (!hits.length) continue;
      const pivotZ = hits[0].z;
      // 树高 = 各网格几何在 pivot 局部系（z 上）的上界 + 网格自身 z 偏移（= 0，
      // 同实例批次同锚点）——倒伏时长 T ∝ √(L/g) 用它（见 destructibles.js）。
      let heightM = 0;
      for (const h of hits) {
        const geo = h.node.geometry;
        if (!geo) continue;
        if (!geo.boundingBox) geo.computeBoundingBox();
        const bb = geo.boundingBox;
        if (bb) heightM = Math.max(heightM, (bb.max.z ?? 0) + (h.z - pivotZ));
      }
      st.slots = hits.map(slotOf);
      st.heightM = heightM;
      st.pivotPos = { x: px, y: py, z: pivotZ };
      st.fallQuat = { w: 1 };   // settled 自校验读的倒伏旋转（destructibles.js）
      st.upright = true;
      // 停止角 = 树干沿倒向**触地**的角度（客户端"停在地形上"，因而随位置/倒向变化）。
      // 高度场在**世界系**（见 rebuildGround 注释：世界 x = −场景局部 x），而 pivot 在
      // gltf.scene 局部系（z 上）→ 采样用 (lx, ly) → (世界 −lx, 世界 lz=ly)。
      // 无高度场（2D 资源平面）→ sampleHeight 恒 0，此时按平坦地面（90°）。
      st.stopRad = ctx.heightField
        ? fallStopAngle(st.fallDir, st.pivotPos, heightM, (lx: number, ly: number) => ctx.sampleHeight(-lx, ly))
        : Math.PI / 2;
    } else {
      st.intactSlots = findMeshes(px, py, false).map(slotOf);
      st.deadSlots = findMeshes(px, py, true).map(slotOf);
    }
  }
  const destruct: NonNullable<MapAssemblyWrites['destruct']> = { states, ptr: 0, lastT: -1, animating: false };
  // 可破坏物批次实例矩阵运行期会变（树倒 / 换模翻转），refreshBatchSphere 按构建位姿算的
  // 批次 AABB 不再保守——置 null 回退包围球（树批次的球已被扩张到覆盖倒伏触及）。
  const volatileBatches = new Set<InstancedMesh>();
  for (const st of states) {
    for (const s of st.slots ?? []) volatileBatches.add(s.mesh);
    for (const s of st.intactSlots ?? []) volatileBatches.add(s.mesh);
    for (const s of st.deadSlots ?? []) volatileBatches.add(s.mesh);
  }
  // 动态批次包围球保守扩张（评审 P2 二轮修正）：树倒 = 绕基点旋转，树梢会
  // 伸出 buildInstancedMesh 按直立位算的包围球。扩张量必须计入**槽位实际
  // 变换**——heightM 是原型几何高度，导出节点带非均匀缩放（erlenberg
  // Spruce2 ≈ [3.1, 2.39, 2.39]）时实高可差数倍，未缩放扩张不保守（倒下
  // 仍漏剔除/漏拾取）。正确量 = 几何球经 s.base 变换后的世界球（含缩放），
  // 再算该球到 pivot 的最远距离 = |center−pivot| + radius；hidden 槽位
  // （y=-1e6）不参与。
  for (const st of states) {
    if (st.prop !== 3 || !st.slots || !st.pivotPos) continue;
    for (const s of st.slots) {
      const sph = s.mesh.boundingSphere;
      if (!sph) continue;
      if (!s.mesh.geometry.boundingSphere) s.mesh.geometry.boundingSphere = sph.clone();
      const geo = s.mesh.geometry.boundingSphere;
      // 几何球经 base 变换：center 仿射变换，radius 按最大轴缩放（保守）
      const e = s.base.elements;
      const cx = e[0] * geo.center.x + e[4] * geo.center.y + e[8] * geo.center.z + e[12];
      const cy = e[1] * geo.center.x + e[5] * geo.center.y + e[9] * geo.center.z + e[13];
      const cz = e[2] * geo.center.x + e[6] * geo.center.y + e[10] * geo.center.z + e[14];
      const sx = Math.hypot(e[0], e[1], e[2]);
      const sy = Math.hypot(e[4], e[5], e[6]);
      const sz = Math.hypot(e[8], e[9], e[10]);
      const r = geo.radius * Math.max(sx, sy, sz);
      // 倒伏最远触及（以**批次球心**度量，评审四轮）：旋转保点到 pivot
      // 的距离 → 任一倒角下，树体所有点到 pivot 的距离 ≤ |p−c_geom|+r；
      // 到批次球心 c 的距离再 +|c−p|（多树共批时 c 与树位相差可达半格宽，
      // 漏掉这一项 = 单棵树测试过、同批双树反例仍 0 命中）。
      const dGeo = Math.hypot(cx - st.pivotPos.x, cy - st.pivotPos.y, cz - st.pivotPos.z);
      const dCenter = Math.hypot(
        sph.center.x - st.pivotPos.x,
        sph.center.y - st.pivotPos.y,
        sph.center.z - st.pivotPos.z);
      const need = dCenter + dGeo + r + 2;
      if (need > sph.radius) sph.radius = need;
    }
  }
  return { destruct, volatileBatches };
}
