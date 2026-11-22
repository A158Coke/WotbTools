/**
 * 实时装填条求值（纯函数；2D / 3D 共用）。**逐发状态模型**，对齐游戏客户端。
 *
 * ── 客户端证据（Steam 客户端 `Data/`，均为 DVPL 容器） ──
 * 位置/结构：`UI/Screens/Battle/VehicleUIObjectMarker/VehicleUIObjectMarker.yaml` 的
 *   `GunNHealthContainer`（BottomUp）里 `GunStatusBattle`（70×3）紧邻血量条；
 *   `UI/Screens/Battle/GunStatusAtlas.yaml` 的 `GunStatus`（66×4）= 一根暗底
 *   （fill `rgba(0,0,0,.565)`）+ `ShellBack`（LinearLayout，间距 0）里 **N 枚 `ShellItem`**
 *   （PercentOfParent = 等分父宽），每枚自带 `#Reload` 进度填充。
 * 逐发状态（`UI/Screens/Battle/GunStatusAtlas.style.yaml`）：
 *   `.shell.loaded`  底图 alpha 1.0                       ← 已就绪
 *   `.shell.used`    底图 alpha 0.250980                  ← 已打出
 *   `.shell.loading` 底图 alpha 0 + `#Reload` 可见（0.815686） ← 装填中
 *   `.shell.locked`  底图 alpha 0.690196 + `#Reload` 隐藏     ← 空位但"还留着"（排队待装）
 * 客户端在 OTM 里显式启用锁定：`VehicleUIObjectMarker.yaml` 里
 *   `- path: "ShellBack/ShellItem"` 带 `classes: "shell lock-enabled"`；`.regular-style #ShellBack`
 *   的 `linearLayout-spacing` = 2.0（≈ 我们 14 设计 px 的分格间隙）。
 * 两档空位 alpha 的语义（1.0 满 / .69 "还在" / .25 "打掉了"）+ 弹夹/弹鼓机制差异：
 *   **弹鼓（有 f2=6 逐发装填）的空槽 = locked（.69，排队待装）**；
 *   **弹夹（只有整夹相位）的空槽 = used（.25，要等整夹重装）**。
 * 逐发美术：`UI/Screens/Battle/Shell.yaml` 的 `Shell`（20×32 竖版）= `PumpDrum.psd` 三帧
 *   （Inactive/Active/Full），装填进度用 `ProgressClip{orientation: BottomUp}`（自下而上）。
 * 容量与时长（客户端语义来源 `configs[]`，本机 `release/asset_pack/tank/{id}.json`；
 * 回放侧由解析面按**实际搭载配置**钉定后放在 facet 车辆字段上）：
 *   `burst_size` = 弹夹容量 N（0 = 单发）；**`burst_interval` = 夹内"射击间隔"**；
 *   **`burst_reloads[]` = 弹鼓逐槽位的装填时长**（为空 = 该炮整夹一次性装填，即弹夹）。
 *
 * 相位语义（f2）与逐发状态机（shellStatesAt / scheduledReady / fillOf 等）自 2026-11-21
 * 起出仓 playback 相邻模块 ./reloadShellState.ts（#LOC 结构拆分，代码逐字一致）；
 * 本文件保留弹容/搭载配置解析与会话级 resolver，公共 API 经下方 re-export 逐符号不变。
 */
import type { AgentPlaybackShot } from '../api/agent-replay-facets.js'
import { shellStatesAt } from './reloadShellState.js'
import type {
  ReloadEffectiveEntry,
  ReloadPhaseEvent,
  ShellState,
} from './reloadShellState.js'

// ---- 公共 API（出仓后 re-export，导入方零改动）----
export {
  PHASE_AMMO_COUNT,
  PHASE_START,
  PHASE_DURATION_CHANGE,
  PHASE_READY,
  PHASE_DRUM_SHELL,
  PHASE_MAG_INTERVAL,
  fillOf,
  hasPerShellReloads,
  hasReloadTelemetry,
  isTimedAmmoPhase,
  isUsablePhase,
  lastIndexAtOrBefore,
  shellStatesAt,
  usablePhases,
} from './reloadShellState.js'
export type { ReloadEffectiveEntry, ReloadPhaseEvent, ShellState } from './reloadShellState.js'

/** N 的合理上限：超过即视为脏数据，退回启发式（实测最大值 6） */
const MAX_PLAUSIBLE_MAG = 10;

/** 资产包 tank/{id}.json 的配置项中装填联表用到的字段。 */
export interface MountedTankConfig extends MountedConfigEvidence {
  shell_global_ids?: number[]
  hull_hp?: number | null
  turret_health?: number | null
}

/** 回放 facet 车辆上用于装填联表的证据字段。 */
export interface MountedConfigEvidence {
  burst_size?: number | null
  turret_local?: number | null
  gun_local?: number | null
  shell_ids?: number[]
  max_hp?: number | null
}

export interface ReloadVehicleEvidence extends MountedConfigEvidence {
  eid: number
  team?: number | null
  tank_id?: number | null
}

export interface TankJsonLike {
  configs?: readonly (MountedTankConfig | null | undefined)[] | null
}

/** reload 消费的 shot 字段：facet shot（wire owner）+ 旧产物兼容的 `shooter` 字段。 */
export type ReloadShotTelemetry = AgentPlaybackShot & { shooter?: number | null }

export interface ReloadTelemetry {
  reloads?: readonly (ReloadPhaseEvent | null | undefined)[] | null
  reload_effective?: readonly (ReloadEffectiveEntry | null | undefined)[] | null
  /** facet 车辆（producer 保证条目完整；reloads/reload_effective 的逐条判空是既有防御，车辆没有） */
  vehicles?: readonly ReloadVehicleEvidence[] | null
  mountedConfigs?: Map<number, TankJsonLike> | null
  friendlyTeam?: number | null
  meta?: { friendly_team?: number | null } | null
  shots?: readonly ReloadShotTelemetry[] | null
}

/**
 * 弹容 N（装填条分格数）的权威取值：回放 facet 车辆上的 `burst_size`——解析面按
 * 实际搭载配置（comp blob → 弹种 → 血量证据链 → `configs[config_idx]`）直接给出该车
 * 实际搭载主炮的弹夹容量（原值，**0 = 单发**）。
 *
 * **禁止跨配置取最大 / 禁止用相位流剩余弹数+1 推断**（2026-10-06 裁决）：
 * 多炮坦克各炮弹容不同（实测资产包 735 台中 52 台跨配置不一致——T69 4/3、
 * AC Wedge 0/6、Medium I 0/15 等），两者都会把未搭载炮的弹容钉到条上。
 * 无该字段 / ≤1 → 1（单发，不猜）；脏值夹到上限 [`MAX_PLAUSIBLE_MAG`]。
 */
export function magazineSizeOfVehicle(vehicle: { burst_size?: number | null } | null | undefined): number {
  const b = Number(vehicle && vehicle.burst_size);
  return Number.isFinite(b) && b > 1 ? Math.min(MAX_PLAUSIBLE_MAG, Math.round(b)) : 1;
}

/**
 * 实际搭载配置解析（**客户端路径**；与上游 `resolve_config_index` 三级证据链同语义，
 * 服务器路径的权威字段是 facet `config_idx`/`burst_size`——本函数只在无解析面注入的
 * WASM 客户端产物上工作，用回放自带的逐车证据 + 资产面坦克数据联表）：
 *
 * - 证据 0：comp locals（facet `turret_local`/`gun_local`，ARENA_INFO 确定性对号
 *   `configs[].turret_local`/`gun_local`）；
 * - 证据 1：发射弹种 ⊆ 配置弹表（`shell_global_ids`；facet `shell_ids`）；
 * - 证据 2：`max_hp` vs 车体 hp + 炮塔 health（改进耐久 ×1.125，±2 容差）。
 *
 * 依次回退（both → 弹种 → 血量），多匹配取**最后一档**（顶级偏好）；全无 → `null`。
 * configs ≤ 1 时无歧义，直接返回该唯一配置。
 *
 * @returns 命中的配置项
 */
export function resolveMountedConfig(
  vehicle: MountedConfigEvidence | null | undefined,
  tankJson: TankJsonLike | null | undefined,
): MountedTankConfig | null {
  const cfgs = (tankJson && tankJson.configs) || [];
  if (!cfgs.length) return null;
  const exact = resolveExactMountedConfig(vehicle, tankJson);
  if (exact) return exact;
  if (!vehicle) return null;
  const fired = new Set((vehicle.shell_ids || []).filter((x) => Number.isFinite(x) && x > 0));
  const gunOk = cfgs.map((c) => {
    if (!fired.size) return true;
    const ids = (c && c.shell_global_ids) || [];
    if (!ids.length) return true;             // 弹表缺失（数据不全）→ 不以此排除
    return [...fired].every((id) => ids.includes(id));
  });
  const hp = Number(vehicle.max_hp);
  const hpOk = cfgs.map((c) => {
    if (!Number.isFinite(hp) || hp <= 0) return true;
    const base = Number(c && c.hull_hp) + Number(c && c.turret_health);
    if (!Number.isFinite(base) || base <= 0) return true;
    const boosted = Math.round(base * 1.125);
    return Math.abs(hp - base) <= 2 || Math.abs(hp - boosted) <= 2;
  });
  const both = cfgs.map((_, i) => i).filter((i) => gunOk[i] && hpOk[i]);
  let cands = both.length ? both : cfgs.map((_, i) => i).filter((i) => gunOk[i]);
  if (!cands.length) cands = cfgs.map((_, i) => i).filter((i) => hpOk[i]);
  if (!cands.length) return null;
  return cfgs[cands[cands.length - 1]] ?? null;
}

/**
 * 证据 0 的无回退形态：唯一配置或 comp locals 精确命中，否则 null。
 * 装甲着色的颜色本身就是结论，配置错了结论就错，不能走 `resolveMountedConfig` 的推断链。
 */
export function resolveExactMountedConfig(
  vehicle: MountedConfigEvidence | null | undefined,
  tankJson: TankJsonLike | null | undefined,
): MountedTankConfig | null {
  const cfgs = (tankJson && tankJson.configs) || [];
  if (cfgs.length === 1) return cfgs[0] ?? null;
  const tl = vehicle?.turret_local, gl = vehicle?.gun_local;
  if (tl == null || gl == null) return null;
  const exact = cfgs.filter((c) => c && c.turret_local === tl && c.gun_local === gl);
  return exact.length ? (exact[exact.length - 1] ?? null) : null;
}

/**
 * 弹容 N 的客户端联表取值：优先 `resolveMountedConfig` 命中配置的 `burst_size`；
 * 未命中时回退 facet `burst_size`（服务器路径产物 / 唯一配置）；都没有 → 1（不猜）。
 */
export function magazineSizeForVehicle(
  vehicle: MountedConfigEvidence | null | undefined,
  tankJson: TankJsonLike | null | undefined,
): number {
  const cfg = resolveMountedConfig(vehicle, tankJson);
  const fromCfg = magazineSizeOfVehicle({ burst_size: cfg && cfg.burst_size });
  return fromCfg > 1 ? fromCfg : magazineSizeOfVehicle(vehicle);
}

/** 按 eid 分组：Map<eid, 该车全部相位条目（含未闭环码）>
 *  保留全量是有意的：`f4`（剩余发数）也出现在未闭环相位码上（实测 f2=1），
 *  在膛发数的权威重锚需要它；显示用的可用相位由 shellStatesAt 内部再筛。 */
export function groupByVehicle<E extends { eid?: number | null }>(reloads: readonly (E | null | undefined)[] | null | undefined): Map<number, E[]> {
  const m = new Map<number, E[]>();
  for (const e of reloads || []) {
    if (!e || e.eid == null) continue;
    let a = m.get(e.eid);
    if (!a) { a = []; m.set(e.eid, a); }
    a.push(e);
  }
  return m;
}

/**
 * Session-level reload index shared by both playback presentations. Inputs and query times
 * use the Playback facet's raw clock; 2D adds its canonical battle origin at the caller.
 * The index owns no advancing clock: repeated, paused and out-of-order queries are identical.
 * Relation is a separate gate from physical team colour. Unknown/enemy vehicles stay unknown
 * even if malformed input carries reload events for them; shots alone never imply reload.
 * Magazine size defaults to the mounted-gun config resolved from the vehicle facet's own
 * evidence (comp locals → shell_ids → max_hp) against `mountedConfigs` (Map tank_id →
 * tank/{id}.json, filled asynchronously by the caller — the shared Map is read live);
 * falls back to the facet's `burst_size`, then 1 (single shot).
 */
export function createReloadStateResolver(telemetry: ReloadTelemetry | null | undefined): (vehicleId: number, time: number, size?: number) => ShellState[] | null {
  const eventsByEid = groupByVehicle(telemetry?.reloads);
  const durationsByEid = groupByVehicle(telemetry?.reload_effective);
  const vehiclesByEid = new Map<number, ReloadVehicleEvidence>(
    (telemetry?.vehicles || []).map((v) => [v.eid, v]),
  );
  const mountedConfigs = telemetry?.mountedConfigs || null;
  const friendlyTeam = telemetry?.friendlyTeam ?? telemetry?.meta?.friendly_team;
  const firesByEid = new Map<number, number[]>();
  for (const shot of telemetry?.shots || []) {
    const eid = shot.shooter_eid ?? shot.shooter;
    if (eid == null || !Number.isFinite(shot.t_fire)) continue;
    if (!firesByEid.has(eid)) firesByEid.set(eid, []);
    firesByEid.get(eid)!.push(shot.t_fire);
  }
  // Sort copies: the producer's immutable telemetry remains untouched.
  for (const list of [...eventsByEid.values(), ...durationsByEid.values()]) {
    list.sort((a, b) => a.clock - b.clock);
  }
  for (const list of firesByEid.values()) list.sort((a, b) => a - b);
  return function reloadStateAt(vehicleId: number, time: number, size?: number): ShellState[] | null {
    const vehicle = vehiclesByEid.get(vehicleId);
    if ((friendlyTeam !== 1 && friendlyTeam !== 2) || vehicle?.team !== friendlyTeam || !Number.isFinite(time)) return null;
    const events = eventsByEid.get(vehicleId) || [];
    const defaultSize = magazineSizeForVehicle(vehicle, mountedConfigs ? mountedConfigs.get(vehicle.tank_id ?? NaN) : null);
    return shellStatesAt(events, firesByEid.get(vehicleId) || [], time,
      size ?? defaultSize, durationsByEid.get(vehicleId) || []);
  };
}
