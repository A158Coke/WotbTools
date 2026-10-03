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
