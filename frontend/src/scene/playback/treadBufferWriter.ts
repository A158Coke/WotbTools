import type { BufferAttribute, BufferGeometry } from 'three'
import { openStampOf, trailStampCorners, treadAlphaAt } from '../treadMarks.js'
import type { TrailState } from '../treadMarks.js'

export interface TrailPair {
  L: TrailState
  R: TrailState
}

export interface TreadBufferInput {
  geometry: BufferGeometry
  trail: TrailPair
  width: number
  texScale: number
  now: number
  heightAt: (x: number, z: number) => number
  cap: number
  slots: number
}

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
    const quad = st === trail.L ? 0 : 1;
    const writeSlot = ((st.total % cap) + cap) % cap;
    const openActive = !!openStampOf(st);
    for (let k = st.written; k < st.total; k++) {
      const slot = k % cap;
      if (openActive && slot === writeSlot && st.total >= cap) continue;
      const seg = st.segs[slot];
      if (!seg) {
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
    const openSlotNow = st.total % cap;
    for (let k = Math.min(st.total, cap); k < cap; k++) {
      if (openActive && k === openSlotNow) continue;
      hideQuads((k % cap) * 32 + quad * 16);
    }
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
      if (openActive && slot === writeSlot && st.total >= cap) continue;
      const co = slot * 32 + quad * 16;
      const seg = st.segs[slot];
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
