/**
 * 名册的**状态在时刻**投影（纯函数；2D / 3D 名册语义、seek 确定性都靠它）。
 *
 * 为什么单独成文件：名册行此前把「静态身份」与「运行时状态」揉在同一个可变对象里，
 * 由场景内核增量改写——于是「seek 回同一时刻是否得到同一状态」这件事没有任何可测面。
 * 这里把它拆成两件事：
 *
 *   projectRoster(vehicles, time)  → 逐车当前 HP / 是否阵亡（只依赖 time）
 *   buildRosterRows(vehicles)      → 静态身份 + 物理队伍分组（只依赖 def）
 *
 * 调用方（playbackScene）只把结果写进 store，不持有第二份状态机。同一输入 + 同一 time
 * 必须得到逐字段相同的结果——任何"累加 / 递减"式实现都不允许出现在这里。
 */

/** 物理队伍分组键：Team 1 / Team 2 / 未识别（绝不把未知并进任一队） */
export const ROSTER_GROUPS = Object.freeze(['team1', 'team2', 'unknown']);

/** Recorder perspective controls presentation only; unknown teams remain separate. */
export function rosterLanesFor(groups, friendlyTeam) {
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
function hpPercent(hp, maxHp) {
  const max = Number(maxHp);
  if (!Number.isFinite(max) || max <= 0) return null;
  const cur = Number(hp);
  if (!Number.isFinite(cur)) return null;
  return Math.max(0, Math.min(100, (100 * cur) / max));
}

/** 呈现层取整（HP 数值与百分比都按整数上屏；名册与名牌同一口径） */
export function hpPercentText(hp, maxHp) {
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
export function hpPresentationFor(health, destroyed = false) {
  const maxHp = Number.isFinite(health?.maxHp) && health.maxHp > 0 ? health.maxHp : null;
  const rawCurrent = health?.currentHp;
  const currentHp = Number.isFinite(rawCurrent) ? Math.max(0, rawCurrent) : null;

  if (destroyed === true || health?.state === 'DESTROYED') {
    // 阵亡：有量程就写 0 / max（信息更完整），否则退回 0%——两者都明确表示「已归零」。
    if (maxHp != null) return { mode: 'destroyed', currentHp: 0, maxHp, pct: 0, text: `0 / ${maxHp}`, fill: 0 };
    return { mode: 'destroyed', currentHp: 0, maxHp: null, pct: 0, text: '0%', fill: 0 };
  }

  // exact：有权威 current + 量程
  if (currentHp != null && maxHp != null) {
    const pct = hpPercentText(currentHp, maxHp);
    return {
      mode: 'exact', currentHp, maxHp, pct,
      text: `${Math.round(currentHp)} / ${maxHp}`,
      fill: Math.max(0, Math.min(1, currentHp / maxHp)),
    };
  }

  // relative：只有相对证据（没有可证明的 exact 数值）→ 绝不伪造 current/max
  const pct = hpPercentText(currentHp, maxHp)
    ?? (Number.isFinite(health?.pct) ? Math.max(0, Math.min(100, health.pct))
      : health?.relativeFull === true ? 100 : null);
  if (pct != null) {
    return { mode: 'relative', currentHp: null, maxHp: null, pct: Math.round(pct), text: `${Math.round(pct)}%`, fill: Math.max(0, Math.min(1, pct / 100)) };
  }

  // unknown：什么都不可证明 → 中性轨道 + `—`
  return { mode: 'unknown', currentHp: null, maxHp: null, pct: null, text: '—', fill: 0 };
}

/**
 * 把**运行时状态**合并进静态名册行（2D / 3D 共用同一份行模型）。
 *
 * 静态身份由 `buildRosterRows` 建一次；这里只负责把当前时刻的状态投影进同一条行对象，
 * 让两个渲染器交出**结构相同**的行：
 *
 *   { eid, team, nick, tank,               // 身份
 *     hp, maxHp, dead, followed,           // 血量 / 生命
 *     health,                              // 可选：完整 health 投影（2D 的 healthDisplayAt）
 *     reload }                             // 可选：共享 resolver 的弹夹状态数组
 *
 * `reload` 缺省 = **没有权威 telemetry**：呈现层据此不显示 reload，绝不假设满弹。
 *
 * 只写字段、不读第二个状态机：同一输入必须得到逐字段相同的结果（seek 确定性）。
 */
export function applyRosterRuntime(row, { hp, maxHp, dead, followed, health = null, reload = null } = {}) {
  if (!row) return row
  if (hp !== undefined && row.hp !== hp) row.hp = hp
  if (maxHp !== undefined && row.maxHp !== maxHp) row.maxHp = maxHp
  if (dead !== undefined && row.dead !== dead) row.dead = dead
  if (followed !== undefined && row.followed !== followed) row.followed = followed
  if (health !== undefined && row.health !== health) row.health = health
  // reload 用引用比较：resolver 每次返回新数组，逐字段比较得不偿失，且引用变即需重绘。
  if (reload !== undefined && row.reload !== reload) row.reload = reload
  return row
}

/**
 * 逐车投影 t 时刻的运行时状态。
 * @param {Array<{def:{eid:number, hp:Array<[number,number]>, max_hp:number, death_t:number|null}}>} vehicles
 * @param {number} t 回放时刻（秒）
 * @returns {Map<number, {hp:number, maxHp:number, dead:boolean}>} 按 eid
 */
export function projectRoster(vehicles, t) {
  const out = new Map();
  for (const v of vehicles || []) {
    const def = (v && v.def) || {};
    if (def.eid == null) continue;
    out.set(def.eid, {
      hp: hpAtSeries(def.hp, def.max_hp, t),
      maxHp: Number(def.max_hp) || 0,
      dead: def.death_t == null ? false : t >= def.death_t,
    });
  }
  return out;
}

/**
 * HP 时间序列求值（`[clock, hp]` 升序，clock ≤ t 的最后一条；早于首条 → 满血）。
 * 与 playbackScene 的 `hpAt` 同口径——那条实现读的是已经解析好的运行时对象，
 * 这里读 def，两者必须给出一致结果（见 projectRoster.test.js 的同值断言）。
 */
export function hpAtSeries(series, maxHp, t) {
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
export function buildRosterRows(vehicles) {
  const groups = { team1: [], team2: [], unknown: [] };
  for (const v of vehicles || []) {
    const d = (v && v.def) || {};
    if (d.eid == null) continue;
    const row = {
      eid: d.eid,
      accountId: Number.isFinite(d.account_id) && d.account_id > 0 ? d.account_id : null,
      tankId: Number.isFinite(d.tank_id) && d.tank_id > 0 ? d.tank_id : null,
      team: d.team === 1 || d.team === 2 ? d.team : null,
      // 作者标记直接烘进昵称（★ 前缀）：名册不再单独暴露 isAuthor，避免同一事实两个字段
      nick: d.is_author ? `★ ${d.nickname || 'Unknown'}` : (d.nickname || 'Unknown'),
      tank: d.tank_name || (d.tank_id ? `tank_${d.tank_id}` : ''),
    };
    // 显式三元分组：未知阵营（team=0，联表失败 / 观察者）进中性组，fail-visible
    // 且绝不污染任何一队（旧 `team!==2→team1` 把 Unknown 划给了队伍 1）
    if (row.team === 2) groups.team2.push(row);
    else if (row.team === 1) groups.team1.push(row);
    else groups.unknown.push(row);
  }
  return groups;
}
