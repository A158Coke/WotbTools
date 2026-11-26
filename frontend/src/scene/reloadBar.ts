import type { AgentPlaybackShot } from '../api/agent-replay-facets.js'
import { shellStatesAt } from './reloadShellState.js'
import type {
  ReloadEffectiveEntry,
  ReloadPhaseEvent,
  ShellState,
} from './reloadShellState.js'

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

const MAX_PLAUSIBLE_MAG = 10;

export interface MountedTankConfig extends MountedConfigEvidence {
  shell_global_ids?: number[]
  hull_hp?: number | null
  turret_health?: number | null
}

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

export type ReloadShotTelemetry = AgentPlaybackShot & { shooter?: number | null }

export interface ReloadTelemetry {
  reloads?: readonly (ReloadPhaseEvent | null | undefined)[] | null
  reload_effective?: readonly (ReloadEffectiveEntry | null | undefined)[] | null
  vehicles?: readonly ReloadVehicleEvidence[] | null
  mountedConfigs?: Map<number, TankJsonLike> | null
  friendlyTeam?: number | null
  meta?: { friendly_team?: number | null } | null
  shots?: readonly ReloadShotTelemetry[] | null
}

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
    if (!ids.length) return true;
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

export function magazineSizeForVehicle(
  vehicle: MountedConfigEvidence | null | undefined,
  tankJson: TankJsonLike | null | undefined,
): number {
  const cfg = resolveMountedConfig(vehicle, tankJson);
  const fromCfg = magazineSizeOfVehicle({ burst_size: cfg && cfg.burst_size });
  return fromCfg > 1 ? fromCfg : magazineSizeOfVehicle(vehicle);
}

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
