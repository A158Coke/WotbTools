import * as THREE from 'three'
import type { PerspectiveCamera } from 'three'
import { spanStartAt } from '../trackInterp.js'
import { occlusionCells } from './pure.js'
import { createReloadStateResolver } from '../reloadBar.js'
import type { ShellState } from '../reloadBar.js'
import { createConsumableStateResolver } from '../../utils/consumableRuntime.js'
import { GHOST_MS } from '../../utils/battlePlayback.js'
import { createHudFeed } from './hudFeed.js'
import type { HudFeedStore } from './hudFeed.js'
import { assetProvider } from '../assetProvider.js'
import type { TransientFeedback3d } from './transientFeedback3d.js'
import type { RuntimeVehicle } from './vehicleRuntime.js'
import type { MarkerLabelSource } from './markerRuntime.js'

export interface LabelsOverlay {
  setLabels(rows: unknown): void
  setAnchor(eid: number, anchor: unknown, stage?: { x: number; y: number }): void
  beginAnchors?(stage: { x: number; y: number }): void
  endAnchors?(): void
  clear(): void
  setMarkerLabels?(rows: unknown): void
  setMarkerAnchor?(key: string, anchor: unknown): void
}

export interface LabelsData {
  meta: { friendly_team?: number | null }
  kills?: Array<{ t: number; killer_eid: number; victim_eid: number; cause?: number }>
  vehicles?: Array<Record<string, unknown>>
  [key: string]: unknown
}

export type LabelsStore = HudFeedStore & { labelsOn: boolean; lastKnownOn: boolean }

export interface LabelsRuntimeDeps {
  store: LabelsStore
  getViewportSize(): { x: number; y: number }
  getCamera(): PerspectiveCamera
  getRaycaster(): THREE.Raycaster
  getData(): LabelsData | null
  getT(): number
  getVehicles(): RuntimeVehicle[]
  getSessionGen(): number
  getFollowEid(): number | null
  deathAt(v: RuntimeVehicle, t: number): boolean
  hpAt(v: RuntimeVehicle, t: number): number
  visibleAt(v: RuntimeVehicle, t: number): boolean
  visByEid(): Map<number, number[]>
  scopedHiddenEid(): number
  sampleHeight(x: number, z: number): number
  heightField(): Float32Array | null
  heightMeta(): { size?: unknown; span?: unknown } | null
  mapScenery(): THREE.Object3D | null
  occlGrid(): Map<string, unknown[]> | null

  transients: Pick<TransientFeedback3d, 'ghostOf' | 'hasFlash'>
  fxScale(): number
  getLabelOverlay(): LabelsOverlay | null
  getMarkerLabelSources?: () => readonly MarkerLabelSource[] | null
  canonicalVehicles(): Array<{ accountId: number; tankClass: string }>
  invalidate(): void
  perfAdd?(key: string, ms: number, count?: number): void
}

export interface LabelsRuntimeHandle {
  advanceKills(): void
  rebuildFeed(): void
  resetScore(): void
  updateScore(): void
  buildRoster(): void
  updateRoster(): void
  updateLabels(): void
  publishLabels(force?: boolean): void
  setLabelPrefs(): void
  invalidateLabels(): void
  setClassIcons(on: boolean): void
  setShowMarkerStatus(on: boolean): void
  classIconsVisible(): boolean
  showMarkerStatus(): boolean
  labelLiftWorld(distance: number): number
  prepareResolvers(): void
  resetSessionState(): void
  resetCursors(): void
  resetRoster(): void
}

export function createLabelsRuntime(deps: LabelsRuntimeDeps): LabelsRuntimeHandle {
  const LABEL_OCCL_SAMPLES = 16;
  const LABEL_OCCL_BUDGET_MS = 4;
  let occlCursor = 0, occlTick = 0, occlStride = 1, occlCostMs = 0;
  const _occlDir = new THREE.Vector3();

  const OCCL_MAX_CANDIDATES = 400;

  function terrainBlocksAim(cx: number, cy: number, cz: number, ax: number, ay: number, az: number) {
    if (!deps.heightField() || !deps.heightMeta()) return false;
    for (let i = 1; i < LABEL_OCCL_SAMPLES; i++) {
      const k = i / LABEL_OCCL_SAMPLES;
      const x = cx + (ax - cx) * k, z = cz + (az - cz) * k;
      const y = cy + (ay - cy) * k;
      if (deps.sampleHeight(x, z) > y + 0.5) return true;
    }
    return false;
  }

  function sceneryBlocksAim(anchor: THREE.Vector3) {
    const camera = deps.getCamera();
    const mapScenery = deps.mapScenery(), occlGrid = deps.occlGrid();
    const raycaster = deps.getRaycaster();
    if (!mapScenery || !raycaster || !occlGrid) return false;
    _occlDir.copy(anchor).sub(camera.position);
    const dist = _occlDir.length();
    if (dist < 2) return false;
    _occlDir.divideScalar(dist);
    const cands: unknown[] = [];
    const seenObj = new Set<unknown>();
    for (const key of occlusionCells(camera.position.x, camera.position.z, anchor.x, anchor.z)) {
      const list = occlGrid.get(key);
      if (!list) continue;
      for (const m of list) {
        if (seenObj.has(m)) continue;
        seenObj.add(m);
        cands.push(m);
      }
    }
    if (!cands.length || cands.length > OCCL_MAX_CANDIDATES) return false;
    const prevFar = raycaster.far;
    raycaster.far = dist - 1.0;
    raycaster.set(camera.position, _occlDir);
    const hit = raycaster.intersectObjects(cands as THREE.Object3D[], false).length > 0;
    raycaster.far = prevFar;
    return hit;
  }

  function updateLabelOcclusion() {
    const n = deps.getVehicles().length;
    if (!n) return;
    occlStride = Math.min(16, occlCostMs > LABEL_OCCL_BUDGET_MS
      ? occlStride + 1 : Math.max(1, occlStride - 1));
    if (++occlTick < occlStride) return;
    occlTick = 0;
    const v = deps.getVehicles()[occlCursor++ % n];
    if (!v || !v.labelAnchor || (!v.group.visible && !ghostOf(v)) || !deps.store.labelsOn) return;
    const a = v.labelAnchor;
    const camera = deps.getCamera();
    let blocked = terrainBlocksAim(camera.position.x, camera.position.y, camera.position.z,
                                   a.x, a.y, a.z);
    if (!blocked) {
      const t0 = performance.now();
      blocked = sceneryBlocksAim(a);
      occlCostMs = performance.now() - t0;
    } else {
      occlCostMs = 0;
    }
    v.labelOccluded = blocked;
  }

  let reloadStateAt: (eid: number, t: number, size?: number) => ShellState[] | null = () => null;
  let consumableStateAt: (eid: number, t: number, spanStart: number | null | undefined) => unknown[] = () => [];
  let tankDataByTankId = new Map<number, unknown>();
  let labelsWrittenMs = -Infinity;
  let labelsTime: number | null = null;
  let labelsReloadActive = false;
  const LABEL_INTERVAL_RELOAD_MS = 33;
  const LABEL_INTERVAL_IDLE_MS = 100;
  const MARKER_TARGET_CARD_LIFT_PX = 60;
  const labelClip = new THREE.Vector4();
  let lastMarkerSignature = '';
  const labelAnchorScratch: { x: number; y: number; visible: boolean; occluded: boolean | undefined; projected: boolean } = { x: 0, y: 0, visible: false, occluded: false, projected: false };
  let classIcons = false, showMarkerStatus = true;
  const classIconsVisible = () => classIcons && deps.store.labelsOn;
  const ghostOf = (v: RuntimeVehicle) =>
    deps.store.lastKnownOn ? v.lastKnownPose ?? null : null;
  const ghostPosScratch = new THREE.Vector3();
  function publishLabels(force = false) {
    const labelOverlay = deps.getLabelOverlay();
    const DATA = deps.getData();
    const T = deps.getT();
    if (!DATA || !labelOverlay || !deps.store.labelsOn) return;
    const now = performance.now();
    const interval = labelsReloadActive ? LABEL_INTERVAL_RELOAD_MS : LABEL_INTERVAL_IDLE_MS;
    if (!force && (T === labelsTime || now - labelsWrittenMs < interval)) return;
    labelsWrittenMs = now;
    labelsTime = T;
    const canonicalVehicles = deps.canonicalVehicles();
    const classByAccount = new Map(canonicalVehicles.map((vehicle) => [vehicle.accountId, vehicle.tankClass]));
    const rows = deps.getVehicles().map((v) => {
      const destroyed = deps.deathAt(v, T);
      const current = deps.hpAt(v, T);
      const maxHp = Number(v.def.max_hp);
      const pct = Number.isFinite(maxHp) && maxHp > 0
        ? Math.max(0, Math.min(100, current / maxHp * 100)) : null;
      const friendlyTeam = DATA.meta.friendly_team;
      const friendly = [1, 2].includes(Number(friendlyTeam)) && [1, 2].includes(Number(v.def.team))
        ? v.def.team === friendlyTeam : null;
      const ghost = deps.transients.ghostOf(v.def.eid);
      const lastKnown = ghostOf(v) != null;
      return {
        eid: v.def.eid, accountId: v.def.account_id, playerName: v.def.nickname || '', tankName: v.def.tank_name || '',
        tankClass: classByAccount.get(v.def.account_id) || '',
        friendly, destroyed, lastKnown,
        hp: { current, pct, state: destroyed ? 'DESTROYED' : 'CURRENT' },
        reload: destroyed ? null : reloadStateAt(v.def.eid, T),
        consumables: destroyed || !deps.visibleAt(v, T) ? []
          : consumableStateAt(v.def.eid, T, spanStartAt(deps.visByEid().get(v.def.eid) ?? v.def.coverage, T)),
        hpGhost: ghost ? { prevPct: ghost.toFrac * 100, nextPct: ghost.fromFrac * 100, bornMs: ghost.bornMs, durationMs: GHOST_MS * deps.fxScale() } : null,
        hpFlash: deps.transients.hasFlash(v.def.eid),
      };
    });
    labelsReloadActive = rows.some((r) => Array.isArray(r.reload)
      && r.reload.some((sh) => sh.state === 'loading'));
    labelOverlay.setLabels(rows);
  }
  function setLabelPrefs() {
    labelsTime = null;
    publishLabels(true);
    deps.invalidate();
  }
  function labelLiftWorld(distance: number) {
    return classIconsVisible() ? 0.3 : Math.min(6, Math.max(3.25, distance * 0.045));
  }
  function updateLabels() {
    const labelOverlay = deps.getLabelOverlay();
    if (!labelOverlay) return;
    const perf = deps.perfAdd;
    const updateStarted = perf ? performance.now() : 0;
    const camera = deps.getCamera();
    camera.updateMatrixWorld();
    for (const v of deps.getVehicles()) {
      const ghost = ghostOf(v);
      if (ghost) ghostPosScratch.set(-ghost.pos[0], ghost.pos[1], ghost.pos[2]);
      else ghostPosScratch.copy(v.group.position);
      const d = camera.position.distanceTo(ghostPosScratch);
      v.labelAnchor.copy(ghostPosScratch);
      v.labelAnchor.y += labelLiftWorld(d);
    }
    const occlusionStarted = perf ? performance.now() : 0;
    updateLabelOcclusion();
    if (perf) deps.perfAdd!('labelsOcclusionMs', performance.now() - occlusionStarted, 1);
    const { x: viewW, y: viewH } = deps.getViewportSize();
    const stage = { x: viewW, y: viewH };
    const batched = typeof labelOverlay.beginAnchors === 'function'
      && typeof labelOverlay.endAnchors === 'function';
    if (batched) labelOverlay.beginAnchors!(stage);
    const projectionStarted = perf ? performance.now() : 0;
    let ghostProjected = 0, ghostDrawn = 0, projectedVehicles = 0;
    for (const v of deps.getVehicles()) {
      labelClip.set(v.labelAnchor.x, v.labelAnchor.y, v.labelAnchor.z, 1)
        .applyMatrix4(camera.matrixWorldInverse).applyMatrix4(camera.projectionMatrix);
      const w = labelClip.w;
      const x = labelClip.x / w, y = labelClip.y / w, z = labelClip.z / w;
      const isGhost = ghostOf(v) != null;
      const projected = (v.group.visible || isGhost) && v.def.eid !== deps.scopedHiddenEid() && w > 0
        && Number.isFinite(x) && Number.isFinite(y) && z >= -1 && z <= 1
        && x >= -1 && x <= 1 && y >= -1 && y <= 1;
      if (projected) projectedVehicles++;
      if (projected && isGhost) {
        ghostProjected++;
        if (deps.store.labelsOn) ghostDrawn++;
      }
      labelAnchorScratch.x = projected ? (x + 1) * viewW / 2 : 0;
      labelAnchorScratch.y = projected ? (1 - y) * viewH / 2 : 0;
      labelAnchorScratch.projected = projected;
      labelAnchorScratch.visible = projected && deps.store.labelsOn;
      labelAnchorScratch.occluded = v.labelOccluded;
      labelOverlay.setAnchor(v.def.eid, labelAnchorScratch);
    }
    if (perf) {
      deps.perfAdd!('labelsProjectionMs', performance.now() - projectionStarted, projectedVehicles);
      deps.perfAdd!('ghostProjected', 0, ghostProjected);
      deps.perfAdd!('ghostLabelDrawn', 0, ghostDrawn);
    }
    if (batched) {
      const domStarted = perf ? performance.now() : 0;
      labelOverlay.endAnchors!();
      if (perf) deps.perfAdd!('labelsDomMs', performance.now() - domStarted, 1);
    }
    const markerSources = deps.getMarkerLabelSources?.() ?? null;
    if (markerSources && markerSources.length) {
      const rows: Array<{ key: string; kind: string; intent?: string; player: string; tank: string; target?: string }> = [];
      const markerScratch: { x: number; y: number; visible: boolean; opacity: number } = { x: 0, y: 0, visible: false, opacity: 1 };
      for (const src of markerSources) {
        rows.push({ key: src.key, kind: src.kind, intent: src.intent, player: src.player, tank: src.tank, target: src.target });
        labelClip.set(src.x, src.y, src.z, 1)
          .applyMatrix4(camera.matrixWorldInverse).applyMatrix4(camera.projectionMatrix);
        const w = labelClip.w;
        const x = labelClip.x / w, y = labelClip.y / w, z = labelClip.z / w;
        markerScratch.visible = w > 0 && Number.isFinite(x) && Number.isFinite(y) && z >= -1 && z <= 1
          && x >= -1 && x <= 1 && y >= -1 && y <= 1;
        markerScratch.x = markerScratch.visible ? (x + 1) * viewW / 2 : 0;
        markerScratch.y = markerScratch.visible
          ? (1 - y) * viewH / 2 - (src.kind === 'target' ? MARKER_TARGET_CARD_LIFT_PX : 0)
          : 0;
        markerScratch.opacity = src.fade;
        labelOverlay.setMarkerAnchor?.(src.key, markerScratch);
      }
      const signature = rows.map((r) => `${r.key}:${r.player}/${r.tank}/${r.intent ?? ''}/${r.target ?? ''}`).join('|');
      if (signature !== lastMarkerSignature) { lastMarkerSignature = signature; labelOverlay.setMarkerLabels?.(rows); }
    } else if (lastMarkerSignature) {
      lastMarkerSignature = '';
      labelOverlay.setMarkerLabels?.([]);
    }
    publishLabels();
    if (perf) deps.perfAdd!('labelsUpdateMs', performance.now() - updateStarted, 1);
  }

  const hudFeed = createHudFeed({
    store: deps.store, getData: () => deps.getData() as Parameters<typeof createHudFeed>[0]['getData'] extends () => infer D ? D : never, getT: () => deps.getT(), getV: () => deps.getVehicles(),
    getSessionGen: () => deps.getSessionGen(), deathAt: deps.deathAt as Parameters<typeof createHudFeed>[0]['deathAt'],
    getReloadStateAt: () => reloadStateAt,
    getFollowEid: () => deps.getFollowEid(),
  });

  function prepareResolvers() {
    const DATA = deps.getData();
    if (!DATA) return;
    tankDataByTankId = new Map();
    reloadStateAt = createReloadStateResolver({ ...DATA, friendlyTeam: DATA.meta.friendly_team, mountedConfigs: tankDataByTankId } as Parameters<typeof createReloadStateResolver>[0]);
    consumableStateAt = createConsumableStateResolver(DATA as Parameters<typeof createConsumableStateResolver>[0]);
    {
      const mySession = deps.getSessionGen();
      const vehicles = DATA.vehicles ?? [];
      const tankIds = new Set(vehicles
        .filter((v) => v.team === DATA.meta.friendly_team && (v.tank_id as number) > 0)
        .map((v) => v.tank_id as number));
      for (const tid of tankIds) {
        assetProvider.json(`/tank/${tid}.json`).then((t) => {
          if (mySession !== deps.getSessionGen() || !t || tankDataByTankId.get(tid)) return;
          tankDataByTankId.set(tid, t);
          labelsTime = null;
          deps.invalidate();
        }).catch(() => {});
      }
    }
  }

  function resetSessionState() {
    deps.getLabelOverlay()?.clear();
    labelsTime = null; labelsWrittenMs = -Infinity;
    reloadStateAt = () => null;
    consumableStateAt = () => [];
    tankDataByTankId = new Map();
  }

  return {
    advanceKills: () => hudFeed.advanceKills(),
    rebuildFeed: () => hudFeed.rebuildFeed(),
    resetScore: () => hudFeed.resetScore(),
    updateScore: () => hudFeed.updateScore(),
    buildRoster: () => hudFeed.buildRoster(),
    updateRoster: () => hudFeed.updateRoster(),
    updateLabels,
    publishLabels,
    setLabelPrefs,
    invalidateLabels: () => { labelsTime = null; },
    setClassIcons(on: boolean) { classIcons = on; },
    setShowMarkerStatus(on: boolean) { showMarkerStatus = on; },
    classIconsVisible,
    showMarkerStatus: () => showMarkerStatus,
    labelLiftWorld,
    prepareResolvers,
    resetSessionState,
    resetCursors: () => hudFeed.resetKillPtr(),
    resetRoster: () => hudFeed.resetRoster(),
  };
}
