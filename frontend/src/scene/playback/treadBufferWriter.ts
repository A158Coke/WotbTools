// 履带印 GPU Buffer 写入器（#820 Wave B4A 自 playbackScene.js 出仓）。
//
// 单一职责：把**已存在**的 TrailState（路径事实由 treadMarks.ts 生成、updateTrails() 拥有）
// 投影为动态合并几何的 position/color Buffer——槽位编排、显示权切换、fround 量化门控、
// needsUpdate / setDrawRange 全在这里；不生成路径、不拥有 mesh 生命周期、无任何状态副本。
//
// Buffer 布局契约（ensureTreadMesh 侧固定）：50 槽/侧、左右交错
// —— 第 k 个已提交戳占槽 2k（L）/ 2k+1（R），槽内 position 4 顶点 ×3、color 4 顶点 ×4
// （rgb 恒 1，a = 寿命 alpha）；活戳槽 = total % cap（50 槽含 active，无第 51 槽）。
import type { BufferAttribute, BufferGeometry } from 'three'
import { openStampOf, trailStampCorners, treadAlphaAt } from '../treadMarks.js'
import type { TrailState } from '../treadMarks.js'

/** 两侧履带的路径态（playbackScene 的 v.trail）。 */
export interface TrailPair {
  L: TrailState
  R: TrailState
}

/** writeTreadBuffer / ageTreadBuffer 共用的显式输入：全部事实由调用方提供。 */
export interface TreadBufferInput {
  /** treadMesh.geometry（动态合并几何，槽位布局见文件头契约） */
  geometry: BufferGeometry
  trail: TrailPair
  /** 印记条带宽（m，v.tread.width） */
  width: number
  /** 纹理 texScale（v.tread.texScale） */
  texScale: number
  /** 回放时钟 T（暂停时冻结 ⇒ 淡出冻结） */
  now: number
  /** 地形高度采样（heightField 就绪时 = sampleHeight，否则恒 0） */
  heightAt: (x: number, z: number) => number
  /** 单侧环容量（TRAIL_CAP_PER_SIDE = TREAD_RING = 50，含活戳） */
  cap: number
  /** 总槽位（TRAIL_SLOTS = cap × 2），决定 drawRange */
  slots: number
}

/** 槽位 alpha 统一走 fround：carr 是 Float32Array，写 0.8 读回 0.8000000119——比较必须
 * 按同一量化值（review P3 2026-10-11：double 严格比较让未变化缓冲每 tick 重新上传） */
function alphaAt(input: TreadBufferInput, t: number): number {
  return Math.fround(treadAlphaAt(input.now - t) * (input.texScale || 1));
}

/**
 * 路径态 → 四边形顶点 + 寿命 alpha（客户端槽位模型，2026-10-12）。
 *
 * 槽位 = **左右交错**：第 k 个已提交戳占槽 `2k`（L）/ `2k+1`（R）——首版把 R 整块放在
 * `[cap, 2cap)` 而 drawRange 只从 0 数起，R 区间永远落在绘制窗口外（"只有左侧履带有
 * 印记"）。额外一对槽 `2cap`/`2cap+1` = 两侧各自的**活戳槽**（逐帧拉伸到车辆当前位置的
 * 那一戳，客户端每帧重发同款）。
 *
 * 绘制窗口=全部槽位（cap×2 个四边形，索引开销可忽略），**无效槽一律显式隐藏**（alpha 0）：
 * 环里的空槽（k ≥ total，残留上一轮旧戳）、无活戳时的活戳槽，都清零。
 * `written` = 该侧已写入 GPU 的绝对戳数；环形覆写只重写被覆盖的那个槽。
 *
 * @returns 本帧是否有 Buffer 变化（门控 needsUpdate 用）
 */
export function writeTreadBuffer(input: TreadBufferInput): boolean {
  const { geometry, trail, width, cap } = input;
  const posAttr = geometry.getAttribute('position') as BufferAttribute;
  const colAttr = geometry.getAttribute('color') as BufferAttribute;
  const parr = posAttr.array as Float32Array, carr = colAttr.array as Float32Array;
  const h = input.heightAt;
  const c12 = new Float32Array(12);
  let wrote = false;
  const hideQuads = (co: number) => {
    if (carr[co + 3] !== 0 || carr[co + 7] !== 0 || carr[co + 11] !== 0 || carr[co + 15] !== 0) {
      carr[co + 3] = 0; carr[co + 7] = 0; carr[co + 11] = 0; carr[co + 15] = 0;
      wrote = true;
    }
  };
  for (const st of [trail.L, trail.R]) {
    const quad = st === trail.L ? 0 : 1;      // 交错槽：L 占偶数槽（2k）、R 占奇数槽（2k+1）
    // 环满时的显示权切换点 = **active 激活**（open != null，即净位移已达 0.3 m），
    // 不是上一次提交完成时——客户端 0x3632a54 的语义：< 0.3 m 时 active 不占 write 槽
    // 的显示权，最老 committed 槽继续显示（第 50 次提交后仍应有 50 个可见槽）。
    // open 存在时 write 槽（= total % cap）才切给活戳并顶掉最老 committed 槽；
    // 提交循环跳过该槽（否则会把活戳 alpha 顶回旧戳值）。（四轮 review P2 边界）
    const writeSlot = ((st.total % cap) + cap) % cap;
    const openActive = !!openStampOf(st);
    for (let k = st.written; k < st.total; k++) {
      const slot = k % cap;
      if (openActive && slot === writeSlot && st.total >= cap) continue;
      const seg = st.segs[slot];
      if (!seg) {
        // 防御：未定型槽（理论不可达——total 只计已提交）显式隐藏
        const co = slot * 32 + quad * 16;
        if (carr[co + 3] !== 0) {
          carr[co + 3] = 0; carr[co + 7] = 0; carr[co + 11] = 0; carr[co + 15] = 0;
          wrote = true;
        }
        continue;
      }
      if (!trailStampCorners(seg, width, h, c12)) continue;
      parr.set(c12, slot * 24 + quad * 12);
      const a = alphaAt(input, seg.t);
      const co = slot * 32 + quad * 16;
      for (let q = 0; q < 4; q++) {
        carr[co + q * 4] = 1; carr[co + q * 4 + 1] = 1;
        carr[co + q * 4 + 2] = 1; carr[co + q * 4 + 3] = a;
      }
      wrote = true;
    }
    st.written = st.total;
    // 环内空槽显式隐藏（k ∈ [total, cap)：环形里可能残留上一轮更长运行的旧戳）。
    // openSlot（若 active 存在）跳过——否则先清 0 再被活戳块写回，paused/static tick
    // 也会无意义地标脏重传（四轮 review P3）。
    const openSlotNow = st.total % cap;
    for (let k = Math.min(st.total, cap); k < cap; k++) {
      if (openActive && k === openSlotNow) continue;
      hideQuads((k % cap) * 32 + quad * 16);
    }
    // 活戳 = write 槽（= total % cap，cap 槽含 active——客户端 0x727b80 同构，无第 51 槽）。
    // 逐帧写入拉伸中的活戳（位置 + alpha），位置按 fround 变化检测——静止且时钟未动时
    // 零上传（与环槽同一门控）；无活戳（未起步/未激活/已复位）则隐藏该槽。
    const openSlot = st.total % cap;
    const pos0 = openSlot * 24 + quad * 12;
    const col0 = openSlot * 32 + quad * 16;
    const open = openStampOf(st);
    if (open && trailStampCorners(open, width, h, c12)) {
      let changed = false;
      for (let i = 0; i < 12; i++) {
        if (parr[pos0 + i] !== Math.fround(c12[i])) { changed = true; break; }
      }
      if (changed) { parr.set(c12, pos0); wrote = true; }
      const a = alphaAt(input, open.t);
      for (let q = 0; q < 4; q++) {
        const ci = col0 + q * 4;
        if (carr[ci] !== 1 || carr[ci + 1] !== 1 || carr[ci + 2] !== 1 || carr[ci + 3] !== a) {
          carr[ci] = 1; carr[ci + 1] = 1; carr[ci + 2] = 1; carr[ci + 3] = a;
          wrote = true;
        }
      }
    } else if (openActive || st.total < cap) {
      // ownership 三态：active 已激活但几何无效，或环未满且无 active 时，这个 write 槽
      // 不属于历史 committed，必须隐藏；环已满 + open==null 时 write 槽仍由最老
      // committed 占有，不能在这里清零（review 七轮 P2）。
      hideQuads(col0);
    }
  }
  geometry.setDrawRange(0, input.slots * 6);
  return wrote;
}

/** 寿命老化扫描：把每槽的 alpha 按其**自身**出生时刻刷新进顶点色。
 *
 * ⚠️ **逐槽独立老化，不做任何时间有序假设**（2026-10-12 review P2）：回压重占只改
 * 被重占槽的 `t`（不动绝对序号）、其它槽又可能被写成 `null` ⇒ "按 k 的出生时刻单调
 * 递增"的二分前提不成立（复现：三槽 [1,2,3]，t=10.1 重占第一槽 → [10.1,2,3]，二分把
 * 新戳当过期前缀清 0——刚生成就不可见）。环只有 51 槽/侧，逐槽全扫与二分同量级。
 * null 槽（回压清空）显式隐藏。暂停时时钟冻结 ⇒ 淡出冻结。
 *
 * @returns 本帧 color Buffer 是否有变化（门控 needsUpdate 用）
 */
export function ageTreadBuffer(input: TreadBufferInput): boolean {
  const { geometry, trail, cap } = input;
  const colAttr = geometry.getAttribute('color') as BufferAttribute;
  const carr = colAttr.array as Float32Array;
  let dirty = false;
  for (const st of [trail.L, trail.R]) {
    const quad = st === trail.L ? 0 : 1;
    const k0 = Math.max(0, st.total - cap);
    const writeSlot = st.total % cap;
    const openActive = !!openStampOf(st);
    for (let k = k0; k < st.total; k++) {
      const slot = k % cap;
      // 活戳槽：**仅当 active 已激活**显示权才切给活戳（四轮 review P2 边界：
      // open == null 时该槽仍显示最老 committed，老化照常按旧戳计算）
      if (openActive && slot === writeSlot && st.total >= cap) continue;
      const co = slot * 32 + quad * 16;
      const seg = st.segs[slot];
      // 与写入侧同口径的 f32 量化（review P3 2026-10-11）：carr 是 Float32Array，拿
      // double 严格比较恒不相等 ⇒ 时钟没动也每 tick 标脏重传。
      const a = seg ? Math.fround(treadAlphaAt(input.now - seg.t) * (input.texScale || 1)) : 0;
      for (let q = 0; q < 4; q++) {
        if (carr[co + q * 4 + 3] !== a) {
          carr[co + q * 4 + 3] = a;
          dirty = true;
        }
      }
    }
  }
  return dirty;
}
