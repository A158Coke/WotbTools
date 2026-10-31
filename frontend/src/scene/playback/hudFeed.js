// 击杀 feed / 计分 / 名册桥接（2026-10-24 自 initPlayback 闭包出仓，current-plan.md
// Step A5 叶子段；代码与搬移前逐字一致，闭包读数改经 getter 快照：getData/getT/getV/
// getSessionGen/getFollowEid，deathAt / reloadStateAt 为闭包函数注入（创建期引用安全）。
// 语义注释（响应式代理登记、阵营视角映射、resolver 单源）随代码原样保留。
import { perspectiveScore } from '../teamHpTotals.js'
import { ROSTER_GROUPS, applyRosterRuntime, buildRosterRows, projectRoster } from '../rosterState.js'

export function createHudFeed({ store, getData, getT, getV, getSessionGen, deathAt, getReloadStateAt, getFollowEid }) {
  //（killPtr / kfId 原声明在闭包状态区，随本段出仓迁入工厂；初值 0 与原闭包一致）
  let killPtr = 0;
  let kfId = 0;
// ---------- 击杀 feed / 计分 ----------
function feedEntry(k) {
  const gen = getSessionGen();
  const name = (eid) => { const v = getV().find((x) => x.def.eid === eid);
    return v ? (v.def.nickname || 'Unknown') : eid === 0 ? '环境' : String(eid); };
  const causeMap = { 0: '', 1: '（火焰）', 2: '（撞击）', 3: '（环境）', 5: '（溺水）' };
  const text = k.killer_eid !== 0
    ? `${name(k.killer_eid)} 击毁 ${name(k.victim_eid)}`
    : `${name(k.victim_eid)}${causeMap[k.cause] || '阵亡'}`;
  const vehicleOf = (eid) => getV().find((x) => x.def.eid === eid)?.def;
  const sideOf = (def) => {
    const friendlyTeam = getData().meta.friendly_team;
    if (!def || ![1, 2].includes(friendlyTeam) || ![1, 2].includes(def.team)) return '';
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
    if (gen !== getSessionGen()) return;   // 会话已切换：条目已随 teardown 清空，不动新会话
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
// 比分：击杀升序 → 单调游标增量推进（此前每 tick 全量扫描 + 每击杀一次 getV().find，随击倒数增长）
let scorePtr = 0, score1 = 0, score2 = 0;
function resetScore() { scorePtr = 0; score1 = 0; score2 = 0; }
function updateScore() {
  while (scorePtr < getData().kills.length && getData().kills[scorePtr].t <= getT()) {
    const k = getData().kills[scorePtr++];
    const victim = getV().find((x) => x.def.eid === k.victim_eid);
    if (!victim) continue;
    if (victim.def.team === 1) score2++; else if (victim.def.team === 2) score1++;
  }
  // 上屏前映射到阵营视角：击杀计数是物理队伍（score1 = team 1），而顶栏布局是
  // 「己方 HP | 己方比分 : 敌方比分 | 敌方 HP」——不映射在 `friendly_team = 2` 时左右相反。
  const perspective = perspectiveScore(score1, score2, getData().meta.friendly_team);
  if (store.scoreFriend !== perspective.scoreFriend) store.scoreFriend = perspective.scoreFriend;
  if (store.scoreEnemy !== perspective.scoreEnemy) store.scoreEnemy = perspective.scoreEnemy;
}

// ---------- 名册 ----------
// 静态身份（eid / 物理 team / 昵称 / 车型）与运行时状态（hp / 阵亡 / 跟随）**分开放**：
// 前者只在会话开始时建一次，后者每次投影都按当前 getT() 重算（见 scene/rosterState.js）。
// 名册的物理阵营色由呈现层按 `team` 取语义 token（--color-team-1/2），内核不再下发颜色——
// 否则「Team 1 是什么颜色」会有两份事实源。
const rosterRowsByEid = new Map();
function buildRoster() {
  store.friendlyTeam = [1, 2].includes(getData().meta.friendly_team) ? getData().meta.friendly_team : null;
  const groups = buildRosterRows(getV());
  rosterRowsByEid.clear();
  for (const key of ROSTER_GROUPS) {
    store.roster[key] = groups[key].map((row) => applyRosterRuntime(
      { ...row },
      { hp: 0, maxHp: 0, dead: false, followed: false, reload: null },
    ));
    // 索引登记的必须是**响应式代理**（读回 store 得到的行），不能是上面的原始对象：
    // store 只存原始对象、读取时才包代理，直接改原始对象 Vue 收不到通知——名册就会
    // 停在旧 HP，直到别的状态（如选中行）碰巧触发重绘。
    for (const row of store.roster[key]) rosterRowsByEid.set(row.eid, row);
  }
}
/**
 * 把当前 getT() 的运行时状态投影进名册行（只在值真的变了时写，避免无谓的 VDOM patch）。
 * 只由 writeHud 调用，**不逐帧**：与顶栏总血量同一个 getT()、同一 ≤10Hz 节拍；seek / 会话开始 /
 * 停播 / 换相机（跟随目标）强制补写。resolver 每次返回新的 reload 数组，若逐帧投影，
 * 名册会每帧重绘。
 *
 * `reload` 复用**场景自己的** reload resolver（`reloadStateAt`，与车辆名牌同一事实源），
 * 不在名册里另起一套解释——弹容 N 由 resolver 从回放 facet 车辆的 `burst_size`
 * （实际搭载配置，解析面钉定）取默认；2D 名册走的是
 * `createReloadStateResolver(reloadTelemetry)`，两边是同一个 resolver 家族、同一套弹夹语义。
 */
function updateRoster() {
  const projected = projectRoster(getV(), getT(), deathAt);
  for (const v of getV()) {
    const e = rosterRowsByEid.get(v.def.eid);
    const p = projected.get(v.def.eid);
    if (!e || !p) continue;
    applyRosterRuntime(e, {
      hp: p.hp,
      maxHp: p.maxHp,
      dead: p.dead,
      followed: getFollowEid() === v.def.eid,
      // 阵亡不展示 reload（与名牌同一判据：destroyed 时不显示次级瞬时状态）
      reload: p.dead ? null : getReloadStateAt()(v.def.eid, getT()),
    });
  }
}
  return {
    advanceKills, rebuildFeed, resetScore, updateScore, buildRoster, updateRoster,
    // seek / 会话重置：击杀游标归零（原闭包 `killPtr = 0` 两处调用点的落点）
    resetKillPtr: () => { killPtr = 0; },
    // teardown：eid → 名册行 索引清空（原闭包 teardownSession 的 rosterRowsByEid.clear() 落点）
    resetRoster: () => { rosterRowsByEid.clear(); },
  };
}
