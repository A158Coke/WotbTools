/**
 * 实时装填条求值（纯函数；3D 标签的装填条用）。**逐发状态模型**，对齐游戏客户端：
 *
 * 客户端两件套（本机 Steam 客户端 `Data/UI/Screens3/Battle/Aims/TrayShellBar.yaml`、
 * `TrayShellSector.yaml`、`Data/UI/Screens/Battle/Shell.yaml`）：
 *   - 托盘 = **逐发扇区**（Sector1..3 等距槽位，每枚 32×12 命中框，内含 Fill + Border 两层），
 *     即"弹夹里有几发"是 **N 个离散指示**，不是一根比例条；
 *   - 每发三态：`Full`（已就绪）/ `Active`（装填中，进度 `BottomUp` 自下而上长）/
 *     `Inactive`（未装填，`TopDown`）。
 * 所以本模块输出**逐发状态数组**，而不是一个标量 fill——这样"打掉两发后手动重装"、
 * "弹夹里还剩一发"这类情形都如实呈现（标量模型会把它们画成全满或从 0 重画）。
 *
 * 数据来源：回放 facet `reloads`（arena subtype 15/17 相位条目，**仅本方全队**）+ 开火时刻
 * （`shots` 的 `shooter_eid`/`t_fire`）。相位语义只取**已交叉验证**子集（见 core
 * `crates/replay-core/src/replay/combat/arena.rs`）：
 *   - f2=3 整夹装填（`duration_s` = 本次时长）→ **整个弹夹重装**（期间从 0 逐发填到 N）
 *   - f2=7 弹夹/弹鼓内单发间隔（`duration_s` = 该发时长）→ **补一发**
 *   - 其余相位码/计数未闭环 → 忽略。
 * N（弹夹容量）由数据推导（相邻整夹之间最长连续弹夹内间隔数 + 1）；没有整夹相位的车一律按 1
 * （单发），不拿"间隔连串长度"去猜（单发车只发 f2=7 且一发一串，会猜出荒唐的 N）。
 *
 * 求值一律按**时间归并 + 二分定位**（不累加计时器）→ seek / 拖动进度条天然正确。
 */

/** f2 = 整夹装填 */
export const PHASE_START = 3;
/** f2 = 弹夹/弹鼓内单发间隔 */
export const PHASE_MAG_INTERVAL = 7;

const clamp01 = (x) => Math.max(0, Math.min(1, Number.isFinite(x) ? x : 0));

/** 相位条目是否可用于求值：f2 ∈ {3,7} 且带正的时长 */
export function isUsablePhase(e) {
  if (!e || (e.phase !== PHASE_START && e.phase !== PHASE_MAG_INTERVAL)) return false;
  const d = Number(e.duration_s);
  return Number.isFinite(d) && d > 0;
}

/** 取可用相位（保持原顺序；facet 已按 clock 升序） */
export function usablePhases(reloads) {
  return (reloads || []).filter(isUsablePhase);
}

/** 按 eid 分组：Map<eid, 可用相位[]> */
export function groupByVehicle(reloads) {
  const m = new Map();
  for (const e of usablePhases(reloads)) {
    let a = m.get(e.eid);
    if (!a) { a = []; m.set(e.eid, a); }
    a.push(e);
  }
  return m;
}

/** 推导弹夹容量 N（单发车 = 1） */
export function inferMagazineSize(events) {
  const list = events || [];
  if (!list.some((e) => e.phase === PHASE_START)) return 1;   // 无整夹相位 → 单发，不猜
  let run = 0, maxRun = 0;
  for (const e of list) {
    if (e.phase === PHASE_MAG_INTERVAL) {
      run += 1;
      if (run > maxRun) maxRun = run;
    } else if (e.phase === PHASE_START) {
      run = 0;   // 整夹装填把「本夹内的间隔串」清零
    }
  }
  return maxRun + 1;
}

/** 最后一个 clock ≤ t 的下标（二分；无 → -1） */
export function lastIndexAtOrBefore(events, t) {
  let lo = 0, hi = events.length - 1, ans = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (events[mid].clock <= t) { ans = mid; lo = mid + 1; } else { hi = mid - 1; }
  }
  return ans;
}

/**
 * t 时刻的**逐发状态**：[{ state: 'full'|'loading'|'empty', progress }]（下标 0 = 第一发）
 * - `full`   该发已在膛（客户端 `Full`）
 * - `loading` 该发正在装填，`progress` 0..1（客户端 `Active`；横向条即左→右填充）
 * - `empty`  该发已打出 / 尚未装填（客户端 `Inactive`）
 *
 * @param {Array} events 该车的可用相位（升序）
 * @param {Array<number>} fires 该车的开火时刻（升序）——每开火消耗一发
 */
export function shellStatesAt(events, fires, t, size = 1) {
  const n = Math.max(1, Math.round(size) || 1);
  const full = () => Array.from({ length: n }, () => ({ state: 'full', progress: 1 }));
  if (!events || !events.length) return full();

  // 归并「开火 / 相位开始 / 相位结束」三类时间标记（均 ≤ t）
  const marks = [];
  for (const e of events) {
    if (e.clock > t) break;
    marks.push({ t: e.clock, kind: 'begin', e });
    const end = e.clock + e.duration_s;
    if (end <= t) marks.push({ t: end, kind: 'end', e });
  }
  for (const f of fires || []) {
    if (f > t) break;
    marks.push({ t: f, kind: 'fire', e: null });
  }
  marks.sort((a, b) => (a.t - b.t) || (a.kind === 'end' ? -1 : 1));

  let loaded = n;          // 在膛发数（0..N）
  let active = null;       // 当前未结束的相位
  for (const m of marks) {
    if (m.kind === 'fire') { loaded = Math.max(0, loaded - 1); active = null; continue; }
    if (m.kind === 'begin') { active = m.e; continue; }
    if (active === m.e) active = null;
    if (m.e.phase === PHASE_MAG_INTERVAL) loaded = Math.min(n, loaded + 1);   // 补一发
    else loaded = n;                                                          // 整夹重装完毕
  }

  if (active) {
    const p = clamp01((t - active.clock) / active.duration_s);
    if (active.phase === PHASE_MAG_INTERVAL) {
      const k = Math.min(n - 1, Math.max(0, loaded));   // 正在补最左那发空位
      return Array.from({ length: n }, (_, i) => (
        i < k ? { state: 'full', progress: 1 }
          : i === k ? { state: 'loading', progress: p }
            : { state: 'empty', progress: 0 }));
    }
    // 整夹装填：整个弹夹重装（剩余发一并替换）→ 按进度**顺序**逐发填（整段时间负责填满 N 发）
    const pos = p * n;
    const cur = Math.floor(pos);                 // 当前正在装填的那一发（0..n）
    return Array.from({ length: n }, (_, i) => (
      i < cur ? { state: 'full', progress: 1 }
        : i === cur && cur < n ? { state: 'loading', progress: clamp01(pos - cur) }
          : { state: 'empty', progress: 0 }));
  }
  return Array.from({ length: n }, (_, i) => (i < loaded ? { state: 'full', progress: 1 } : { state: 'empty', progress: 0 }));
}

/** 逐发状态 → 聚合填充比（重绘门控与旧口径兼容用） */
export function fillOf(states) {
  if (!states || !states.length) return 1;
  let sum = 0;
  for (const s of states) sum += s.state === 'full' ? 1 : s.state === 'loading' ? clamp01(s.progress) : 0;
  return sum / states.length;
}

/** 聚合视图（门控/兼容）：{ active, fill, kind, shells } */
export function reloadViewAt(events, fires, t, size = 1) {
  const shells = shellStatesAt(events, fires, t, size);
  const anyLoading = shells.some((s) => s.state === 'loading');
  return { active: anyLoading, fill: fillOf(shells), kind: anyLoading ? 'loading' : null, shells };
}
