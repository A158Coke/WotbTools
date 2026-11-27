import { perspectiveScore } from '../teamHpTotals.js'
import { ROSTER_GROUPS, applyRosterRuntime, buildRosterRows, projectRoster } from '../rosterState.js'
import type { ShellState } from '../reloadBar.js'

export interface HudFeedData {
  meta: { friendly_team?: number | null }
  kills: Array<{ t: number; killer_eid: number; victim_eid: number; cause?: number }>
}

export interface HudFeedVehicleDef {
  eid: number
  account_id?: number | null
  tank_id?: number | null
  team?: number | null
  is_author?: boolean | null
  nickname?: string | null
  tank_name?: string | null
}

export interface KillfeedEntry {
  id: number
  kill: boolean
  killer: string
  victim: string
  text: string
  killerTank: string
  victimTank: string
  killerSide: '' | 'ally' | 'enemy'
  victimSide: '' | 'ally' | 'enemy'
}

export type HudRosterRow = ReturnType<typeof buildRosterRows>['team1'][number] & {
  hp?: number
  maxHp?: number
  dead?: boolean
  followed?: boolean
  health?: unknown
  reload?: unknown
}

export interface HudFeedStore {
  killfeed: KillfeedEntry[]
  scoreFriend: number
  scoreEnemy: number
  friendlyTeam: number | null
  roster: Record<'team1' | 'team2' | 'unknown', HudRosterRow[]>
}

export function createHudFeed({ store, getData, getT, getV, getSessionGen, deathAt, getReloadStateAt, getFollowEid }: {
  store: HudFeedStore
  getData: () => HudFeedData
  getT: () => number
  getV: () => Array<{ def?: HudFeedVehicleDef | null } | null>
  getSessionGen: () => number
  deathAt: Parameters<typeof projectRoster>[2]
  getReloadStateAt: () => ((eid: number, t: number) => ShellState[] | null) | null
  getFollowEid: () => number | null
}) {
  let killPtr = 0;
  let kfId = 0;
function feedEntry(k: { t: number; killer_eid: number; victim_eid: number; cause?: number }): void {
  const gen = getSessionGen();
  const name = (eid: number): string => { const v = getV().find((x) => x?.def?.eid === eid);
    return v ? (v.def!.nickname || 'Unknown') : eid === 0 ? '环境' : String(eid); };
  const causeMap: Record<number, string> = { 0: '', 1: '（火焰）', 2: '（撞击）', 3: '（环境）', 5: '（溺水）' };
  const text = k.killer_eid !== 0
    ? `${name(k.killer_eid)} 击毁 ${name(k.victim_eid)}`
    : `${name(k.victim_eid)}${causeMap[k.cause ?? 0] || '阵亡'}`;
  const vehicleOf = (eid: number): HudFeedVehicleDef | undefined => getV().find((x) => x?.def?.eid === eid)?.def ?? undefined;
  const sideOf = (def: HudFeedVehicleDef | undefined): '' | 'ally' | 'enemy' => {
    const friendlyTeam = getData().meta.friendly_team;
    if (!def || (friendlyTeam !== 1 && friendlyTeam !== 2) || (def.team !== 1 && def.team !== 2)) return '';
    return def.team === friendlyTeam ? 'ally' : 'enemy';
  };
  const killerDef = vehicleOf(k.killer_eid), victimDef = vehicleOf(k.victim_eid);
  const entry = {
    id: ++kfId, kill: k.killer_eid !== 0, killer: name(k.killer_eid), victim: name(k.victim_eid), text,
    killerTank: killerDef?.tank_name || '', victimTank: victimDef?.tank_name || '',
    killerSide: sideOf(killerDef), victimSide: sideOf(victimDef),
  };
  store.killfeed.push(entry);
  setTimeout(() => {
    if (gen !== getSessionGen()) return;
    const i = store.killfeed.findIndex((x) => x.id === entry.id);
    if (i >= 0) store.killfeed.splice(i, 1);
  }, 8000);
}
function advanceKills() {
  while (killPtr < getData().kills.length && getData().kills[killPtr].t <= getT()) {
    feedEntry(getData().kills[killPtr]);
    killPtr++;
  }
}
function rebuildFeed() {
  store.killfeed = [];
  const recent = getData().kills.filter((k) => k.t <= getT()).slice(-6);
  for (const k of recent) feedEntry(k);
  killPtr = 0;
  while (killPtr < getData().kills.length && getData().kills[killPtr].t <= getT()) killPtr++;
}
let scorePtr = 0, score1 = 0, score2 = 0;
function resetScore() { scorePtr = 0; score1 = 0; score2 = 0; }
function updateScore() {
  while (scorePtr < getData().kills.length && getData().kills[scorePtr].t <= getT()) {
    const k = getData().kills[scorePtr++];
    const victim = getV().find((x) => x?.def?.eid === k.victim_eid);
    if (!victim?.def) continue;
    if (victim.def.team === 1) score2++; else if (victim.def.team === 2) score1++;
  }
  const perspective = perspectiveScore(score1, score2, getData().meta.friendly_team ?? null);
  if (store.scoreFriend !== perspective.scoreFriend) store.scoreFriend = perspective.scoreFriend;
  if (store.scoreEnemy !== perspective.scoreEnemy) store.scoreEnemy = perspective.scoreEnemy;
}

const rosterRowsByEid = new Map<number, HudRosterRow>();
function buildRoster() {
  const ft = getData().meta.friendly_team;
  store.friendlyTeam = ft === 1 || ft === 2 ? ft : null;
  const groups = buildRosterRows(getV());
  rosterRowsByEid.clear();
  for (const key of ROSTER_GROUPS as readonly (keyof typeof store.roster)[]) {
    store.roster[key] = groups[key].map((row) => applyRosterRuntime(
      { ...row, hp: 0, maxHp: 0, dead: false, followed: false },
      { hp: 0, maxHp: 0, dead: false, followed: false, reload: null },
    )) as HudRosterRow[];
    for (const row of store.roster[key]) rosterRowsByEid.set(row.eid, row);
  }
}
function updateRoster() {
  const projected = projectRoster(getV(), getT(), deathAt);
  for (const v of getV()) {
    const eid = v?.def?.eid;
    if (eid == null) continue;
    const e = rosterRowsByEid.get(eid);
    const p = projected.get(eid);
    if (!e || !p) continue;
    applyRosterRuntime(e, {
      hp: p.hp,
      maxHp: p.maxHp,
      dead: p.dead,
      followed: getFollowEid() === eid,
      reload: p.dead ? null : getReloadStateAt()?.(eid, getT()) ?? null,
    });
  }
}
  return {
    advanceKills, rebuildFeed, resetScore, updateScore, buildRoster, updateRoster,
    resetKillPtr: () => { killPtr = 0; },
    resetRoster: () => { rosterRowsByEid.clear(); },
  };
}
