
import { defLifeAt } from '../utils/battlePlaybackV2.ts';
import { isFiniteNumber } from '../types/primitive-guards.js';

type RosterGroupKey = 'team1' | 'team2' | 'unknown';
type RosterDef = Partial<Parameters<typeof defLifeAt>[0]> & {
  eid?: number | null;
  hp?: ReadonlyArray<readonly [number, number]> | null;
  max_hp?: unknown;
  account_id?: number | null;
  tank_id?: number | null;
  team?: number | null;
  is_author?: boolean | null;
  nickname?: string | null;
  tank_name?: string | null;
};
type RosterVehicle = { def?: RosterDef | null } | null | undefined;
export type RosterRow = {
  eid: number;
  accountId: number | null;
  tankId: number | null;
  team: number | null;
  nick: string;
  tank: string;
};
export type RosterRuntime = {
  hp?: number;
  maxHp?: number;
  dead?: boolean;
  followed?: boolean;
  health?: unknown;
  reload?: unknown;
};
type HealthInput = {
  currentHp?: number | null;
  maxHp?: number | null;
  pct?: number | null;
  relativeFull?: boolean;
  knowledge?: string | null;
  state?: string | null;
};

export const ROSTER_GROUPS = Object.freeze(['team1', 'team2', 'unknown']);

export function rosterLanesFor<T>(groups: Partial<Record<RosterGroupKey, T[]>>, friendlyTeam: number | null | undefined) {
  const leftKey = friendlyTeam === 2 ? 'team2' : 'team1';
  const rightKey = friendlyTeam === 2 ? 'team1' : 'team2';
  return {
    left: { [leftKey]: groups[leftKey] || [], unknown: groups.unknown || [] },
    right: { [rightKey]: groups[rightKey] || [] },
  };
}

/**
 * HP 百分比：maxHp 不可信（≤0 / 非有限）时返回 null。
 * **null ≠ 0**——"没有可证明的血量上限"不能上屏成"血量是 0"。
 * @returns {number|null} 0..100，未取整（取整交给呈现层，避免累积误差）
 */
function hpPercent(hp: unknown, maxHp: unknown) {
  const max = Number(maxHp);
  if (!Number.isFinite(max) || max <= 0) return null;
  const cur = Number(hp);
  if (!Number.isFinite(cur)) return null;
  return Math.max(0, Math.min(100, (100 * cur) / max));
}

export function hpPercentText(hp: unknown, maxHp: unknown) {
  const pct = hpPercent(hp, maxHp);
  return pct == null ? null : Math.round(pct);
}

/**
 * 名册行的 HP 呈现模型（**唯一**一份 HP 展示判定；2D / 3D 都走这里，渲染层不自己猜）。
 *
 * 契约（见 docs / repair prompt §6–§9）：
 *
 *   exact      authoritative currentHp + maxHp 都有 → 条里只写 `current / max`，不重复百分比
 *   relative   只有相对比例证据（backend 的 `relativeFull` 等），具体数值不可知 → 只写 `pct%`
 *   unknown    没有可证明的血量事实 → `—`，轨道中性，**不画满绿**（unknown ≠ 0%）
 *   destroyed  已阵亡 → 有 max 时写 `0 / max`，否则 `0%`，条为空
 *
 * `destroyed` 是**独立输入**（名册的阵亡集合），因为它可能比 health 事实更早可用。
 *
 * @param {{currentHp?:number|null, maxHp?:number|null, pct?:number|null,
 *          relativeFull?:boolean, knowledge?:string|null, state?:string|null}|null} health
 * @param {boolean} destroyed
 * @returns {{mode:'exact'|'relative'|'unknown'|'destroyed', currentHp:number|null,
 *            maxHp:number|null, pct:number|null, text:string, fill:number}}
 */
export function hpPresentationFor(health: HealthInput | null | undefined, destroyed = false) {
  const maxHp = isFiniteNumber(health?.maxHp) && health.maxHp > 0 ? health.maxHp : null;
  const rawCurrent = health?.currentHp;
  const currentHp = isFiniteNumber(rawCurrent) ? Math.max(0, rawCurrent) : null;

  if (destroyed === true || health?.state === 'DESTROYED') {
    if (maxHp != null) return { mode: 'destroyed', currentHp: 0, maxHp, pct: 0, text: `0 / ${maxHp}`, fill: 0 };
    return { mode: 'destroyed', currentHp: 0, maxHp: null, pct: 0, text: '0%', fill: 0 };
  }

  if (currentHp != null && maxHp != null) {
    const pct = hpPercentText(currentHp, maxHp);
    return {
      mode: 'exact', currentHp, maxHp, pct,
      text: `${Math.round(currentHp)} / ${maxHp}`,
      fill: Math.max(0, Math.min(1, currentHp / maxHp)),
    };
  }

  const pct = hpPercentText(currentHp, maxHp)
    ?? (isFiniteNumber(health?.pct) ? Math.max(0, Math.min(100, health.pct))
      : health?.relativeFull === true ? 100 : null);
  if (pct != null) {
    return { mode: 'relative', currentHp: null, maxHp: null, pct: Math.round(pct), text: `${Math.round(pct)}%`, fill: Math.max(0, Math.min(1, pct / 100)) };
  }

  return { mode: 'unknown', currentHp: null, maxHp: null, pct: null, text: '—', fill: 0 };
}

function sameShellStates(a: unknown, b: unknown) {
  if (a === b) return true;
  if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i]?.state !== b[i]?.state) return false;
  }
  return true;
}

export function applyRosterRuntime<T extends RosterRuntime>(
  row: T,
  { hp, maxHp, dead, followed, health = null, reload = null }: RosterRuntime = {},
) {
  if (!row) return row
  if (hp !== undefined && row.hp !== hp) row.hp = hp
  if (maxHp !== undefined && row.maxHp !== maxHp) row.maxHp = maxHp
  if (dead !== undefined && row.dead !== dead) row.dead = dead
  if (followed !== undefined && row.followed !== followed) row.followed = followed
  if (health !== undefined && row.health !== health) row.health = health
  if (reload !== undefined && !sameShellStates(row.reload, reload)) row.reload = reload
  return row
}

/**
 * 逐车投影 t 时刻的运行时状态。
 * @param {Array<{def:{eid:number, hp:Array<[number,number]>, max_hp:number, death_t:number|null, death_times?:number[], resurrection_times?:number[]}}>} vehicles
 * @param {number} t 回放时刻（秒）
 * @param {Function|null} isDestroyed scene-owned canonical/fallback life resolver
 * @returns {Map<number, {hp:number, maxHp:number, dead:boolean}>} 按 eid
 */
export function projectRoster(
  vehicles: RosterVehicle[] | null | undefined,
  t: number,
  isDestroyed: ((vehicle: RosterVehicle, t: number) => boolean) | null = null,
) {
  const out = new Map();
  for (const v of vehicles || []) {
    const def: RosterDef = (v && v.def) || {};
    if (def.eid == null) continue;
    out.set(def.eid, {
      hp: hpAtSeries(def.hp, def.max_hp, t),
      maxHp: Number(def.max_hp) || 0,
      dead: isDestroyed ? isDestroyed(v, t) : defLifeAt(def as Parameters<typeof defLifeAt>[0], t)?.lifeState === 'DESTROYED',
    });
  }
  return out;
}

export function hpAtSeries(series: ReadonlyArray<readonly [number, number]> | null | undefined, maxHp: unknown, t: number) {
  let cur = Number(maxHp) || 0;
  for (const entry of series || []) {
    if (entry[0] <= t) cur = entry[1];
    else break;
  }
  return cur;
}

/**
 * 静态名册行 + 物理队伍分组。
 * @returns {{team1:Array, team2:Array, unknown:Array}} 每条 = 身份字段（eid/team/nick/tank）
 */
export function buildRosterRows(vehicles: RosterVehicle[] | null | undefined) {
  const groups: Record<RosterGroupKey, RosterRow[]> = { team1: [], team2: [], unknown: [] };
  for (const v of vehicles || []) {
    const d: RosterDef = (v && v.def) || {};
    if (d.eid == null) continue;
    const row: RosterRow = {
      eid: d.eid,
      accountId: isFiniteNumber(d.account_id) && d.account_id > 0 ? d.account_id : null,
      tankId: isFiniteNumber(d.tank_id) && d.tank_id > 0 ? d.tank_id : null,
      team: d.team === 1 || d.team === 2 ? d.team : null,
      nick: d.is_author ? `★ ${d.nickname || 'Unknown'}` : (d.nickname || 'Unknown'),
      tank: d.tank_name || (d.tank_id ? `tank_${d.tank_id}` : ''),
    };
    if (row.team === 2) groups.team2.push(row);
    else if (row.team === 1) groups.team1.push(row);
    else groups.unknown.push(row);
  }
  return groups;
}
