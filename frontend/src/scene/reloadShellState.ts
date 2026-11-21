import type { AgentReloadEvent, AgentReloadEffectiveEvent } from '../api/agent-replay-facets'

/**
 * 装填条逐发状态机（f2 相位时间归并 + 逐发状态推导）——自 reloadBar.ts 出仓
 * （2026-11-21 #LOC 结构拆分：代码与搬移前逐字一致，公共入口仍由 reloadBar re-export）。
 *
 * 相位语义（f2，来自 method 16 遥测）：
 *   f2=1  剩余弹数更新（无时长；f4 = 弹夹/弹鼓剩余发数，权威计数）。
 *         即使开火事件漏报也能给出正确的在膛发数。
 *   f2=3  整夹装填：弹夹/单发的整夹重装，时长 = 整夹时长；期间整架不可用。
 *         3D OTM 显示为**一整条不分割**的进度，完成后恢复 N 格满弹状态。
 *   f2=6  弹鼓逐发装填：**每个事件真正装填一发**，时长 = 该槽位的装填时长
 *         （= `burst_reloads` 对应槽位；实测 tank 4481 的 6.56/9.38 ≈ 7/10）。
 *   f2=7  夹内**推弹/射击间隔**（= `burst_interval`）：期间"正推上膛"的那格显示 B、
 *         完成后该格变 A，**不补弹**（弹夹/弹鼓一致——弹夹打掉一发后为 A|A|C 而非 A|A|A）；
 *         弹鼓另由 f2=6 逐发补回空槽。
 *   f2=4  装填中途时长变更：`f3` = **新生效的完整装填配置时长**（非倒计时；实测每车仅少数几档，
 *         如 8.7/7.43/13.29）。进度按**比例缩放剩余时间**（用"就绪时刻"表示进度基准：
 *         硬约束检验「开火不得早于就绪」，重置基准 9/120 违例 vs 缩放剩余 1/120）。
 *   f2=5  就绪/取消（无时长）；其 f4=1 是"就绪标志"，**不是**剩余发数。
 *   f4    **服务器剩余发数快照**（事件时刻的权威值）：实测 f2=1/6/7 上的 f4 与
 *         「开火−1、f2=6 完成+1（未被开火作废）、f2=3 完成=N」逐条一致——一律作为快照
 *         覆盖开火推导（开火事件采集有延迟会漂移）；仅 f2=5 的 f4=1 是"就绪标志"，排除。
 *
 * 绘制规则（对客户端实测序列拟合）：满弹/空闲 → 分割 N 格（A=可用，C=打掉的）；
 *   f2=7 推弹期间 → 分割且 B 在"正推上膛"那格；f2=6 补槽期间 → B 在空槽那格；
 *   f2=3 整夹装填 → **一整条不分割**；开火作废进行中的装填。
 *
 * 求值一律按**时间归并 + 二分定位**（不累加计时器）→ seek / 拖动进度条天然正确。
 */

/** f2 = **剩余弹数更新**（无时长；`f4` = 弹夹/弹鼓剩余发数，权威计数） */
export const PHASE_AMMO_COUNT = 1;
/** f2 = 整夹装填（一次性；弹夹与单发的整夹重装） */
export const PHASE_START = 3;
/** f2 = 装填中途时长变更（刷新当前装填的进度基准） */
export const PHASE_DURATION_CHANGE = 4;
/** f2 = 就绪/取消（无时长；其 f4=1 是就绪标志） */
export const PHASE_READY = 5;
/** f2 = 弹鼓逐发装填（真装填一发；时长 = 该槽位装填时长） */
export const PHASE_DRUM_SHELL = 6;
/** f2 = 夹内射击间隔（**不装填**；时长 = burst_interval） */
export const PHASE_MAG_INTERVAL = 7;
// 相位码 8：语义未定（禁猜）——9 场样本 527 条里仅 11 条，全部来自 tank 21793
//（Sheridan Missile，单发炮），无 f3/f4，且 11/11 紧随该车 f2=3 前 0.5~3.2 s。
// 不参与渲染：下面 isUsablePhase 不含 8，其 count 为空也不会进入 N 推断。
// 现存相位码分布：{1:16, 3:251, 4:74, 5:77, 6:47, 7:62, 8:11}（2 从未出现）。

/**
 * 单发装填状态：`full`（在膛）/ `loading`（装填中，`progress` 0..1，横向条左→右填充）/
 * `locked`（空槽但排队待装，弹鼓）/ `empty`（空槽等整夹重装，弹夹）。客户端 Full/Active/Inactive 同义。
 */
export interface ShellState {
  state: 'full' | 'loading' | 'locked' | 'empty'
  progress: number
}

/**
 * 相位/时长条目 = Playback facet 的 wire 形状（agent-replay-facets.ts 是唯一 owner，
 * 本模块只建 view 别名，不复制 wire DTO）。
 */
export type ReloadPhaseEvent = AgentReloadEvent
export type ReloadEffectiveEntry = AgentReloadEffectiveEvent

/** scheduledReady 的时间线变更条目（kind 判别：phase = f2=4/新定时相位，eff = method 35）。 */
type ScheduledChange =
  | { clock: number; kind: 'phase'; e: ReloadPhaseEvent }
  | { clock: number; kind: 'eff'; e: ReloadEffectiveEntry }

const clamp01 = (x: number): number => Math.max(0, Math.min(1, Number.isFinite(x) ? x : 0));

/** 是否为有明确结束时刻的弹药阶段。f2=3/6 会在结束时改变弹量；f2=7 只结束推弹视觉，**不补弹**。 */
export function isTimedAmmoPhase(e: ReloadPhaseEvent | null | undefined): boolean {
  return !!e && (e.phase === PHASE_START || e.phase === PHASE_DRUM_SHELL || e.phase === PHASE_MAG_INTERVAL);
}

/** 该车是否"按发装填"（弹鼓：相位流里有 f2=6）——决定空槽画 locked(.69) 还是 used(.25) */
export function hasPerShellReloads(events: readonly (ReloadPhaseEvent | null | undefined)[] | null | undefined): boolean {
  return (events || []).some((e) => e && e.phase === PHASE_DRUM_SHELL);
}

/** 相位条目是否参与时间归并（带正时长；f2=7 也参与——它会打断/接续装填节奏） */
export function isUsablePhase(e: ReloadPhaseEvent | null | undefined): e is ReloadPhaseEvent {
  if (!e) return false;
  const p = e.phase;
  if (p !== PHASE_START && p !== PHASE_DRUM_SHELL && p !== PHASE_MAG_INTERVAL && p !== PHASE_DURATION_CHANGE) return false;
  const d = Number(e.duration_s);
  return Number.isFinite(d) && d > 0;
}

/**
 * 该车是否**有可信装填遥测**——画不画装填条的唯一判据。
 *
 * 客户端只对本方全队广播装填遥测（arena subtype 15/16/17）与方法 35；没有遥测的车
 * （敌方、或整场未产生任何相位）必须读作 **unknown**，绝不画成"满弹"。
 * 这条区分是 2026-10-02 线上故障的根因：`reloads = 0` 时旧实现返回 `full()`，
 * 于是每台车都画出一根**永远不动的白条**（"unknown == full" 的 fail-open）。
 *
 * 判据 = 至少存在一条**闭环装填语义**的条目：
 *   - 有正时长的 f2=3/4/6/7（真正在装填），或
 *   - f2=1 的服务器剩余发数快照（权威计数）。
 * 只有 f2=5（就绪/取消）不算：它不带时长也不改弹量，单凭它无法断言在膛发数。
 */
export function hasReloadTelemetry(events: readonly (ReloadPhaseEvent | null | undefined)[] | null | undefined): boolean {
  // 判据顺序：f2=1 快照优先判（isUsablePhase 是 type predicate，false 分支会把 e 收窄成 never）
  return (events || []).some((e) => !!e && (e.phase === PHASE_AMMO_COUNT || isUsablePhase(e)));
}

/** 取可用相位（保持原顺序；facet 已按 clock 升序） */
export function usablePhases(reloads: readonly (ReloadPhaseEvent | null | undefined)[] | null | undefined): ReloadPhaseEvent[] {
  return (reloads || []).filter(isUsablePhase);
}

/**
 * 某条定时弹药相位（f2=3/6/7）的**结束时刻**：从 `clock + duration_s` 起，将后续
 * f2=4 与 method 35 按时间顺序折入同一 ready 时间线，直到结束或被下一条定时弹药相位取代。
 * method 35 仍只作用于 f2=3；缩放公式必须与 shellStatesAt 的运行时状态机完全一致。
 */
function scheduledReady(
  usable: readonly ReloadPhaseEvent[],
  i: number,
  effList: readonly ReloadEffectiveEntry[],
  effAt: (t: number) => number | null,
): number {
  const s = usable[i];
  // scheduledReady 只消费 isTimedAmmoPhase（可用相位，duration_s 恒为正有限数）；?? 0 与 JS 的 null 算术一致
  let dur = s.duration_s ?? 0;
  if (s.phase === PHASE_START && effAt) dur = effAt(s.clock) ?? dur;
  let ready = s.clock + dur;

  // 预计算 end mark 时不能只看 f2=4：method 35 会在运行时动态修改 ready。
  // 将两类变化合并排序，确保静态 end mark 与下面 marks 归并得到同一个结束时刻。
  const changes: ScheduledChange[] = [];
  for (let j = i + 1; j < usable.length; j++) {
    const e = usable[j];
    if (e.phase === PHASE_DURATION_CHANGE || isTimedAmmoPhase(e)) {
      changes.push({ clock: e.clock, kind: 'phase', e });
    }
  }
  if (s.phase === PHASE_START) {
    for (const d of effList || []) {
      if (d.clock > s.clock && d.duration_s > 0) changes.push({ clock: d.clock, kind: 'eff', e: d });
    }
  }
  // 与 shellStatesAt marks 的稳定顺序一致：同一时刻 phase/begin 先于 eff。
  changes.sort((a, b) => {
    const byClock = a.clock - b.clock;
    if (byClock) return byClock;
    if (a.kind === b.kind) return 0;
    return a.kind === 'phase' ? -1 : 1;
  });

  for (const change of changes) {
    if (change.clock >= ready) break;                 // 当前装填已在变化到来前完成
    if (change.kind === 'eff') {
      const next = change.e.duration_s;
      ready = change.clock + Math.max(0, ready - change.clock) * (next / dur);
      dur = next;
      continue;
    }
    const e = change.e;
    const dNew = e.duration_s;
    if (e.phase === PHASE_DURATION_CHANGE && dNew != null && dNew > 0) {
      ready = e.clock + Math.max(0, ready - e.clock) * (dNew / dur);
      dur = dNew;
    } else if (isTimedAmmoPhase(e)) {
      break;                                          // 新定时相位取代本次
    }
  }
  return ready;
}

/** 最后一个 clock ≤ t 的下标（二分；无 → -1） */
export function lastIndexAtOrBefore(events: readonly { clock: number }[], t: number): number {
  let lo = 0, hi = events.length - 1, ans = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (events[mid].clock <= t) { ans = mid; lo = mid + 1; } else { hi = mid - 1; }
  }
  return ans;
}

/**
 * t 时刻的**逐发状态**：[{ state: 'full'|'loading'|'empty', progress }]（下标 0 = 第一发）
 *
 * **无装填遥测 → 返回 `null`**（`unknown ≠ full`）：调用方必须隐藏整条装填 UI，
 * 不得退化成满条。`hasReloadTelemetry()` 是同一判据的显式版本，供渲染侧预检。
 *
 * `durations`（可选）= 该方法 35 的"当前生效完整装填时长"序列（{clock, eid, duration_s}）。
 * 有它时：装填**起点**采用该时刻已知的权威时长；中途再来一条（消耗品/乘员/配件生效）时按
 * **缩放剩余**（M2：ready ← t + (ready−t)·新/旧）刷新——硬约束检验「开火不得早于就绪」在
 * 3 种模型里最优（2/120 违例，起点+完整时长 5/120、变更时刻+时长 30/120）。
 * - `full`    该发已在膛（客户端 `Full`）
 * - `loading` 该发正在装填，`progress` 0..1（客户端 `Active`；横向条即左→右填充）
 * - `locked`  该发空着但"排队待装"（客户端 `.shell.locked`，底图 .690196；弹鼓的空槽）
 * - `empty`   该发已打出且要等整夹重装（客户端 `.shell.used`，底图 .250980；弹夹的空槽）
 *
 * 三种装填形态：
 * - **整夹装填（f2=3）**：该夹**所有发一起**按同一进度装填，同一时刻到位（期间整夹不可用）。
 * - **弹鼓逐发（f2=6）**：只补**最左空位**那一发，进度 = 该事件时长；其余保持。
 * - **射击间隔（f2=7）**：**不补发**——空位保持空（弹夹要等整夹装填，弹鼓等随后的 f2=6）。
 *
 * @param events 该车的相位条目（升序；可用相位由内部筛）
 * @param fires 该车的开火时刻（升序）——每开火消耗一发
 * @returns 无遥测 → `null`（不画）
 */
export function shellStatesAt(
  events: readonly ReloadPhaseEvent[],
  fires: readonly number[],
  t: number,
  size = 1,
  durations: readonly (ReloadEffectiveEntry | null | undefined)[] | null = null,
): ShellState[] | null {
  const n = Math.max(1, Math.round(size) || 1);
  // 没有可信装填遥测 = unknown：绝不返回可绘制的满弹状态（"absence of evidence ≠ full ammo"）
  if (!hasReloadTelemetry(events)) return null;

  // 归并「开火 / 相位开始 / 相位结束」三类时间标记（均 ≤ t）；只用可用相位建标记。
  // 定时弹药相位（f2=3/6/7）的结束时刻要折进其后的 f2=4 时长变更；只有 f2=3/6
  // 会在结束时改变弹量，f2=7 结束只代表推弹/射击间隔完成。
  type ReloadMark =
    | { t: number; kind: 'begin'; e: ReloadPhaseEvent }
    | { t: number; kind: 'end'; e: ReloadPhaseEvent }
    | { t: number; kind: 'fire'; e: null }
    | { t: number; kind: 'eff'; e: ReloadEffectiveEntry }
    | { t: number; kind: 'count'; e: ReloadPhaseEvent }
  const marks: ReloadMark[] = [];
  // 方法 35：权威"当前生效完整装填时长"（**长装填刻度**）——只用于 f2=3 的进度/结算基准
  const effList: readonly ReloadEffectiveEntry[] = (durations || []).filter(
    (d): d is ReloadEffectiveEntry => !!d,
  );
  const effAt = (tt: number): number | null => {
    let v: number | null = null;
    for (const d of effList) {
      if (d.clock <= tt) v = d.duration_s;
      else break;
    }
    return v;
  };
  const usable = events.filter(isUsablePhase);
  for (let i = 0; i < usable.length; i++) {
    const e = usable[i];
    if (e.clock > t) break;
    marks.push({ t: e.clock, kind: 'begin', e });
    if (!isTimedAmmoPhase(e)) continue;                  // f2=4 不产生独立结束标记
    const end = scheduledReady(usable, i, effList, effAt); // end 与运行时 ready 共用 f2=4 + method35 时间线
    if (end <= t) marks.push({ t: end, kind: 'end', e });
  }
  for (const f of fires || []) {
    if (f > t) break;
    marks.push({ t: f, kind: 'fire', e: null });
  }
  for (const d of effList) {
    if (d.clock > t) break;
    if (!(d.duration_s > 0)) continue;
    marks.push({ t: d.clock, kind: 'eff', e: d });
  }
  // 服务器剩余发数快照：**所有相位**的 f4（实测 f2=1/6/7 一致 = 事件时刻的服务器值；
  // 仅 f2=5 的 f4=1 是"就绪标志"，排除）。开火事件只用于两次快照之间的推导——回放里
  // 开火时刻的采集与服务器广播有延迟，推导会漂移，快照负责纠偏。
  for (const e of events) {
    if (e.clock > t) break;
    if (e.phase === PHASE_READY) continue;
    const c = Number(e.count);
    if (e.count != null && Number.isFinite(c) && c >= 0) marks.push({ t: e.clock, kind: 'count', e });
  }
  marks.sort((a, b) => (a.t - b.t) || (a.kind === 'end' ? -1 : (b.kind === 'end' ? 1 : 0)));

  const perShell = hasPerShellReloads(events);   // 弹鼓：空槽 = locked（排队待装），非弹鼓 = used
  const emptyState = (): ShellState => (perShell ? { state: 'locked', progress: 0 } : { state: 'empty', progress: 0 });
  let loaded = n;          // 在膛发数（0..N）
  let active = null;       // 当前未结束的定时弹药相位（f2=3/6/7；f2=7 仅视觉上膛，不补弹）
  // 进度用「预测就绪时刻 ready + 当前生效完整时长 dur」表示：progress = 1 − max(0, ready−t)/dur。
  // 用 ready（而非开始时刻）是为了让 f2=4 能**按比例缩放剩余时间**（见下）。
  let ready = 0;
  let dur = 0;
  for (const m of marks) {
    if (m.kind === 'count') {
      // 服务器下发的剩余发数（权威快照）：覆盖开火推导值——开火采集/广播延迟会漂移；
      // 不改变当前装填相位的进度基准
      const c = Number(m.e.count);
      if (Number.isFinite(c) && c >= 0 && c <= n) loaded = c;
      continue;
    }
    if (m.kind === 'fire') { loaded = Math.max(0, loaded - 1); active = null; ready = 0; dur = 0; continue; }
    if (m.kind === 'eff') {
      // 方法 35 的权威时长变更（消耗品/乘员/配件生效，**长装填刻度**）：与 f2=4 同式——
      // **缩放剩余**；只作用于整夹装填（f2=3）——小装填/逐发有自己的刻度，不随它跳变。
      // （硬约束检验：M2 2/120 违例，优于"起点+完整时长"5/120、"变更时刻+时长"30/120）
      if (active && active.phase === PHASE_START && dur > 0 && m.e.duration_s > 0) {
        const rest = Math.max(0, ready - m.t);
        ready = m.t + rest * (m.e.duration_s / dur);
        dur = m.e.duration_s;
      }
      continue;
    }
    if (m.kind === 'begin') {
      if (m.e.phase === PHASE_DURATION_CHANGE) {
        // f2=4 = 当前生效的**完整**装填配置时长变更（不是倒计时；实测值在少数几档间跳变）。
        // 故**不能**把基准重置成 clock+d——那样在真实数据里会出现 9/120 次"预测就绪晚于实际
        // 开火"（物理不可能）；改为**按比例缩放剩余时间**：ready ← t + (ready−t)·d′/d，
        // 同一数据集违例降到 1/120。不改变已装填发数。
        if (active && dur > 0) {
          const dNew = m.e.duration_s;
          if (dNew != null && dNew > 0) {
            const rest = Math.max(0, ready - m.e.clock);
            ready = m.e.clock + rest * (dNew / dur);
            dur = dNew;
          }
        }
        continue;
      }
      active = m.e;
      // 方法 35 是**完整装填配置时长**（长装填刻度）——只对 f2=3（整夹装填）生效；
      // f2=6（弹鼓逐发）/f2=7（夹内小装填）必须用相位自带的 duration_s，否则小装填
      // 会按长装填的刻度走（曾致部分弹夹车小装填看起来像长装填）。
      // begin 只来自可用相位（duration_s 恒为正有限数），`?? 0` 与 JS 的 null 算术一致。
      dur = m.e.phase === PHASE_START ? (effAt(m.e.clock) ?? m.e.duration_s ?? 0) : (m.e.duration_s ?? 0);
      ready = m.e.clock + dur;
      continue;
    }
    // end：只结束没被开火打断的那条定时相位；f2=3/6 继续结算弹量，f2=7 只清视觉上膛态
    if (active !== m.e) continue;
    active = null; ready = 0; dur = 0;
    if (m.e.phase === PHASE_DRUM_SHELL) {
      loaded = Math.min(n, loaded + 1);        // 弹鼓 f2=6：补回一个空槽（逐发装填）
    } else if (m.e.phase === PHASE_START) {
      loaded = n;                              // 整夹装填（f2=3）：整夹补满
    }
    // f2=7（推下一发上膛的间隔）结束**不补弹**：那一格只是从 B（推弹中）变回 A（可用）
  }

  // 客户端显示模型（对客户端实测序列逐位拟合；弹夹/弹鼓一致，N=3 例）：
  //   满弹          → 分割 A|A|A
  //   打一发        → f2=7 推弹上膛期间：分割，B 在"正推上膛"那格 → A|B|C；完成 → A|A|C（不补弹）
  //   再打一发      → B|C|C；完成 → A|C|C
  //   打空          → f2=3 整夹装填：**一整条不分割**（一根慢慢延长的条），装完 → A|A|A
  //   弹鼓差异      → 另有 f2=6 逐发补回空槽：B 在第一个空槽 → A|A|B → 满；可被开火作废
  if (active && dur > 0) {
    const p = clamp01(1 - Math.max(0, ready - t) / dur);
    if (active.phase === PHASE_START) {
      return [{ state: 'loading', progress: p }];        // 整夹装填：一整条不分割
    }
    // 逐发类：B 的格位——f2=7 = 正推上膛那格（开火后 loaded 已减 1 → B 在 loaded−1）；
    //        f2=6 = 正在补回的空槽（B 在 loaded）。
    const k = Math.max(0, Math.min(n - 1,
      active.phase === PHASE_MAG_INTERVAL ? loaded - 1 : loaded));
    return Array.from({ length: n }, (_, i) => (
      i < k ? { state: 'full', progress: 1 }
        : i === k ? { state: 'loading', progress: p }
          : emptyState()));
  }
  return Array.from({ length: n }, (_, i) => (i < loaded ? { state: 'full', progress: 1 } : emptyState()));
}

/** 逐发状态 → 聚合填充比（重绘门控与旧口径兼容用）；无遥测（`null`）→ 1（不影响重绘门控） */
export function fillOf(states: readonly ShellState[] | null | undefined): number {
  if (!states || !states.length) return 1;
  let sum = 0;
  for (const s of states) sum += s.state === 'full' ? 1 : s.state === 'loading' ? clamp01(s.progress) : 0;
  return sum / states.length;
}
