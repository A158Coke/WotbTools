/**
 * 实时装填条求值（纯函数；3D 标签的装填条用）。**逐发状态模型**，对齐游戏客户端。
 *
 * 客户端证据（Steam 客户端 `Data/`，均为 DVPL 容器）：
 *   - 位置：`UI/Screens/Battle/VehicleUIObjectMarker/VehicleUIObjectMarker.yaml` 的
 *     `GunNHealthContainer`（LinearLayout BottomUp）里 `GunStatusBattle`（70×3）紧邻血量条。
 *   - 结构：`UI/Screens/Battle/GunStatusAtlas.yaml` 的 `GunStatus`（66×4）= 一根暗底
 *     （fill `rgba(0,0,0,.565)`）+ `ShellBack`（LinearLayout，间距 0）里 **N 枚 `ShellItem`**
 *     （`SizePolicy` PercentOfParent = **等分父宽**），每枚自带一层 `#Reload` 进度填充。
 *   - 逐发状态类：`UI/Screens/Battle/GunStatusAtlas.style.yaml`
 *       `.shell.loaded`  底图 alpha 1.0            ← 已就绪
 *       `.shell.used`    底图 alpha 0.250980       ← 已打出
 *       `.shell.loading` 底图 alpha 0 + `#Reload` 可见（进度色 0.815686） ← 装填中
 *       `.shell.locked`  底图 alpha 0.690196 + `#Reload` 隐藏             ← 尚未轮到（我们暂不区分）
 *   - 容量与时长（客户端坦克数据 `configs[0]`，本机 `release/asset_pack/tank/{id}.json`）：
 *       `burst_size` = 弹夹容量 N（0 = 单发）；`burst_interval` = 夹内短装填；
 *       `burst_reloads` = **弹鼓**逐发时长序列（**为空 = 整夹一次性装填**，即弹夹）。
 *
 * 相位语义（arena subtype 15/17；f1=eid, f2=phase, f3=时长, f4=计数）：
 *   - f2=3 **整夹装填**：弹夹/单发的整夹重装，`f3` = 整夹时长；**一次性**——整段时间内该夹
 *     所有空位一起装填，装完才全部可用（弹夹机制上不能"先给一发"）。
 *   - f2=6 **弹鼓续装**：弹鼓补下一发，`f3` = 该发时长。
 *   - f2=7 **夹内单发间隔**：`f3` = 该发时长（弹夹/弹鼓通用，= `burst_interval`）。
 *   - f4 = **该次开火后剩余发数**（逐发递减；与相位码无关——实测 f2=1/3/6/7 都带剩余，
 *     只有 f2=5 的 f4=1 是"就绪标志"）。已对 63 辆车的样本与客户端 `burst_size` 交叉验证。
 *   - 其余相位码（1/4 等）未闭环 → 不赋时长语义（不影响逐发状态），但其 f4 仍参与容量推断。
 *
 * N 推断：优先用 `f4`（观测到的最大剩余发数 + 1 = N，与客户端 `burst_size` 逐车吻合）；
 * 无 `f4` 时回退到"整夹之间的最长连续夹内间隔串 + 1"；再不行按 1（单发，不猜）。
 *
 * 求值一律按**时间归并 + 二分定位**（不累加计时器）→ seek / 拖动进度条天然正确。
 */

/** f2 = 整夹装填（一次性；弹夹与单发的整夹重装） */
export const PHASE_START = 3;
/** f2 = 弹鼓续装下一发（时长 = 该发） */
export const PHASE_DRUM_SHELL = 6;
/** f2 = 夹内单发间隔（时长 = 该发） */
export const PHASE_MAG_INTERVAL = 7;
/** f2 = 就绪/取消（无时长；此码的 f4=1 是"就绪标志"，不是剩余发数） */
export const PHASE_READY = 5;

/** N 的合理上限：超过即视为脏数据，退回启发式（实测最大值 6） */
const MAX_PLAUSIBLE_MAG = 10;

const clamp01 = (x) => Math.max(0, Math.min(1, Number.isFinite(x) ? x : 0));

/** 该相位是否"逐发装填"（一次只补一发）而非整夹一次性装填 */
export function isPerShellPhase(e) {
  return !!e && (e.phase === PHASE_MAG_INTERVAL || e.phase === PHASE_DRUM_SHELL);
}

/** 相位条目是否可用于求值：f2 ∈ {3,6,7} 且带正的时长 */
export function isUsablePhase(e) {
  if (!e || (e.phase !== PHASE_START && !isPerShellPhase(e))) return false;
  const d = Number(e.duration_s);
  return Number.isFinite(d) && d > 0;
}

/** 取可用相位（保持原顺序；facet 已按 clock 升序） */
export function usablePhases(reloads) {
  return (reloads || []).filter(isUsablePhase);
}

/** 按 eid 分组：Map<eid, 该车全部相位条目（含未闭环码）>
 *  保留全量是有意的：`f4`（剩余发数）也会出现在未闭环相位码上（实测 f2=1），
 *  N 推断需要它；显示用的可用相位由 shellStatesAt 内部再筛。 */
export function groupByVehicle(reloads) {
  const m = new Map();
  for (const e of reloads || []) {
    if (!e || e.eid == null) continue;
    let a = m.get(e.eid);
    if (!a) { a = []; m.set(e.eid, a); }
    a.push(e);
  }
  return m;
}

/** 推导弹夹容量 N（单发车 = 1） */
export function inferMagazineSize(events) {
  const list = events || [];
  // 首选 f4：**该次开火后剩余发数**——f4 与相位码无关（实测 f2=1/3/6/7 都带"剩余"），
  // 故扫描所有条目；只有 f2=5（就绪/取消）的 f4=1 是"就绪标志"不是剩余，必须排除。
  // 相位条目只在开火/装填时产生，故剩余数取不到满夹那一次 → 观测最大值即 N−1。
  let maxRemain = -1;
  for (const e of list) {
    if (!e || e.phase === PHASE_READY) continue;
    const c = e.count;
    if (c == null || !Number.isFinite(c) || c < 0) continue;
    if (c > maxRemain) maxRemain = c;
  }
  if (maxRemain >= 0 && maxRemain + 1 <= MAX_PLAUSIBLE_MAG) return maxRemain + 1;
  // 回退：整夹之间的最长连续夹内间隔串 + 1（无整夹相位 → 不猜，按单发）
  if (!list.some((e) => e.phase === PHASE_START)) return 1;
  let run = 0, maxRun = 0;
  for (const e of list) {
    if (isPerShellPhase(e)) {
      run += 1;
      if (run > maxRun) maxRun = run;
    } else if (e.phase === PHASE_START) {
      run = 0;   // 整夹装填补位把「本夹内的间隔串」清零
    }
  }
  return Math.min(MAX_PLAUSIBLE_MAG, maxRun + 1);
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
 * - `full`    该发已在膛（客户端 `Full`）
 * - `loading` 该发正在装填，`progress` 0..1（客户端 `Active`；横向条即左→右填充）
 * - `empty`   该发已打出 / 尚未装填（客户端 `Inactive`；客户端画 25% 透明底图，我们留暗槽）
 *
 * 两种装填形态（客户端的弹夹 vs 弹鼓）：
 * - **整夹装填（f2=3）**：整段时间内该夹**所有空位一起**装填，同一进度；期间整夹不可用。
 * - **逐发装填（f2=6/7）**：只补**最左空位**那一发，其余保持（弹鼓按发续装）。
 *
 * @param {Array} events 该车的可用相位（升序）
 * @param {Array<number>} fires 该车的开火时刻（升序）——每开火消耗一发
 */
export function shellStatesAt(events, fires, t, size = 1) {
  const n = Math.max(1, Math.round(size) || 1);
  const full = () => Array.from({ length: n }, () => ({ state: 'full', progress: 1 }));
  if (!events || !events.length) return full();

  // 归并「开火 / 相位开始 / 相位结束」三类时间标记（均 ≤ t）；只用**可用相位**建标记
  // （未闭环相位码不赋时长语义，但仍参与 N 推断）
  const marks = [];
  for (const e of events) {
    if (e.clock > t) break;
    if (!isUsablePhase(e)) continue;
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
    if (isPerShellPhase(m.e)) loaded = Math.min(n, loaded + 1);   // 逐发：补一发
    else loaded = n;                                              // 整夹：一次性装满
  }

  if (active) {
    const p = clamp01((t - active.clock) / active.duration_s);
    if (isPerShellPhase(active)) {
      // 逐发（弹鼓/夹内间隔）：只补最左空位那一发（客户端只该枚 ShellItem 为 loading）
      const k = Math.min(n - 1, Math.max(0, loaded));
      return Array.from({ length: n }, (_, i) => (
        i < k ? { state: 'full', progress: 1 }
          : i === k ? { state: 'loading', progress: p }
            : { state: 'empty', progress: 0 }));
    }
    // 整夹装填：该夹**所有 N 发一起**按同一进度装填（弹夹整夹一次性到位、期间整夹不可用——
    // 逐发先后到位会让第一发"提前可用"，与客户端/机制都不符；换弹种/手动重装同理整夹锁定）
    return Array.from({ length: n }, () => ({ state: 'loading', progress: p }));
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
