import type { AgentReloadEvent, AgentReloadEffectiveEvent } from '../api/agent-replay-facets'


export const PHASE_AMMO_COUNT = 1;
export const PHASE_START = 3;
export const PHASE_DURATION_CHANGE = 4;
export const PHASE_READY = 5;
export const PHASE_DRUM_SHELL = 6;
export const PHASE_MAG_INTERVAL = 7;

export interface ShellState {
  state: 'full' | 'loading' | 'locked' | 'empty'
  progress: number
}

export type ReloadPhaseEvent = AgentReloadEvent
export type ReloadEffectiveEntry = AgentReloadEffectiveEvent

type ScheduledChange =
  | { clock: number; kind: 'phase'; e: ReloadPhaseEvent }
  | { clock: number; kind: 'eff'; e: ReloadEffectiveEntry }

const clamp01 = (x: number): number => Math.max(0, Math.min(1, Number.isFinite(x) ? x : 0));

export function isTimedAmmoPhase(e: ReloadPhaseEvent | null | undefined): boolean {
  return !!e && (e.phase === PHASE_START || e.phase === PHASE_DRUM_SHELL || e.phase === PHASE_MAG_INTERVAL);
}

export function hasPerShellReloads(events: readonly (ReloadPhaseEvent | null | undefined)[] | null | undefined): boolean {
  return (events || []).some((e) => e && e.phase === PHASE_DRUM_SHELL);
}

export function isUsablePhase(e: ReloadPhaseEvent | null | undefined): e is ReloadPhaseEvent {
  if (!e) return false;
  const p = e.phase;
  if (p !== PHASE_START && p !== PHASE_DRUM_SHELL && p !== PHASE_MAG_INTERVAL && p !== PHASE_DURATION_CHANGE) return false;
  const d = Number(e.duration_s);
  return Number.isFinite(d) && d > 0;
}

export function hasReloadTelemetry(events: readonly (ReloadPhaseEvent | null | undefined)[] | null | undefined): boolean {
  return (events || []).some((e) => !!e && (e.phase === PHASE_AMMO_COUNT || isUsablePhase(e)));
}

export function usablePhases(reloads: readonly (ReloadPhaseEvent | null | undefined)[] | null | undefined): ReloadPhaseEvent[] {
  return (reloads || []).filter(isUsablePhase);
}

function scheduledReady(
  usable: readonly ReloadPhaseEvent[],
  i: number,
  effList: readonly ReloadEffectiveEntry[],
  effAt: (t: number) => number | null,
): number {
  const s = usable[i];
  let dur = s.duration_s ?? 0;
  if (s.phase === PHASE_START && effAt) dur = effAt(s.clock) ?? dur;
  let ready = s.clock + dur;

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
  changes.sort((a, b) => {
    const byClock = a.clock - b.clock;
    if (byClock) return byClock;
    if (a.kind === b.kind) return 0;
    return a.kind === 'phase' ? -1 : 1;
  });

  for (const change of changes) {
    if (change.clock >= ready) break;
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
      break;
    }
  }
  return ready;
}

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
  if (!hasReloadTelemetry(events)) return null;

  type ReloadMark =
    | { t: number; kind: 'begin'; e: ReloadPhaseEvent }
    | { t: number; kind: 'end'; e: ReloadPhaseEvent }
    | { t: number; kind: 'fire'; e: null }
    | { t: number; kind: 'eff'; e: ReloadEffectiveEntry }
    | { t: number; kind: 'count'; e: ReloadPhaseEvent }
  const marks: ReloadMark[] = [];
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
    if (!isTimedAmmoPhase(e)) continue;
    const end = scheduledReady(usable, i, effList, effAt);
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
  for (const e of events) {
    if (e.clock > t) break;
    if (e.phase === PHASE_READY) continue;
    const c = Number(e.count);
    if (e.count != null && Number.isFinite(c) && c >= 0) marks.push({ t: e.clock, kind: 'count', e });
  }
  marks.sort((a, b) => (a.t - b.t) || (a.kind === 'end' ? -1 : (b.kind === 'end' ? 1 : 0)));

  const perShell = hasPerShellReloads(events);
  const emptyState = (): ShellState => (perShell ? { state: 'locked', progress: 0 } : { state: 'empty', progress: 0 });
  let loaded = n;
  let active = null;
  let ready = 0;
  let dur = 0;
  for (const m of marks) {
    if (m.kind === 'count') {
      const c = Number(m.e.count);
      if (Number.isFinite(c) && c >= 0 && c <= n) loaded = c;
      continue;
    }
    if (m.kind === 'fire') { loaded = Math.max(0, loaded - 1); active = null; ready = 0; dur = 0; continue; }
    if (m.kind === 'eff') {
      if (active && active.phase === PHASE_START && dur > 0 && m.e.duration_s > 0) {
        const rest = Math.max(0, ready - m.t);
        ready = m.t + rest * (m.e.duration_s / dur);
        dur = m.e.duration_s;
      }
      continue;
    }
    if (m.kind === 'begin') {
      if (m.e.phase === PHASE_DURATION_CHANGE) {
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
      dur = m.e.phase === PHASE_START ? (effAt(m.e.clock) ?? m.e.duration_s ?? 0) : (m.e.duration_s ?? 0);
      ready = m.e.clock + dur;
      continue;
    }
    if (active !== m.e) continue;
    active = null; ready = 0; dur = 0;
    if (m.e.phase === PHASE_DRUM_SHELL) {
      loaded = Math.min(n, loaded + 1);
    } else if (m.e.phase === PHASE_START) {
      loaded = n;
    }
  }

  if (active && dur > 0) {
    const p = clamp01(1 - Math.max(0, ready - t) / dur);
    if (active.phase === PHASE_START) {
      return [{ state: 'loading', progress: p }];
    }
    const k = Math.max(0, Math.min(n - 1,
      active.phase === PHASE_MAG_INTERVAL ? loaded - 1 : loaded));
    return Array.from({ length: n }, (_, i) => (
      i < k ? { state: 'full', progress: 1 }
        : i === k ? { state: 'loading', progress: p }
          : emptyState()));
  }
  return Array.from({ length: n }, (_, i) => (i < loaded ? { state: 'full', progress: 1 } : emptyState()));
}

export function fillOf(states: readonly ShellState[] | null | undefined): number {
  if (!states || !states.length) return 1;
  let sum = 0;
  for (const s of states) sum += s.state === 'full' ? 1 : s.state === 'loading' ? clamp01(s.progress) : 0;
  return sum / states.length;
}
