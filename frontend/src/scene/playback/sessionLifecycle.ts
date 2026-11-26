import type { useReplayWorkspace } from '../../composables/useReplayWorkspace'
import { loadPlaybackData, resolveMapKey } from '../replaySource.js'
import { createPerf } from './perf.ts'

type PerfHandle = ReturnType<typeof createPerf>
import type { AgentAoiPresence } from '../../api/agent-replay-facets.js'

export interface SessionPlaybackData {
  meta: { map_id?: number | null; map_name?: string | null; t_start?: number; friendly_team?: number | null; duration?: number | null; samples?: number }
  visibility?: readonly AgentAoiPresence[] | null
  vehicles: unknown[]
  shots: unknown[]
  periods: unknown[]
  destructible_events?: unknown[]
}

export interface SessionStore {
  hasData: boolean
  mapReady: boolean
  err: string
  loading: boolean
  assetStage: boolean
  assetProgress: number | null
  playbackSession: unknown
  mapName: string
  startTime: number
  duration: number
}

export interface LoadSource {
  kind?: 'local'
  signal?: AbortSignal
  file?: Blob & { name?: string; lastModified?: number }
  session?: ReturnType<typeof useReplayWorkspace>['playbackSession'] | null
}

export interface SessionPerfObserver {
  (event: { stage: string; durationMs?: number | null; status?: string | null; digest?: string | null }): void
}

export interface LoadMapOnlyOptions {
  mapId: number
  mapName?: string
}

export interface SessionLifecycleDeps {
  store: SessionStore
  destroyed(): boolean
  perf(): PerfHandle | null
  teardownSession(): void
  publishSessionData(data: SessionPlaybackData, playbackSession: unknown): void
  publishMapOnlyData(mapId: number, mapName: string): void
  ensureRenderer(): void
  battleRange(): [number, number]
  publishSceneClock(): void
  clearCanonicalClock(): void
  prepareSessionCamera(): void
  setMapKey(key: string | null): void
  getGlbOn(): boolean
  buildWorld(): void
  setCam(mode: string): void
  clampCameraTarget(): void
  constrainFreeCameraAltitude(): void
  loadMapImage(): Promise<void>
  buildBases(): void
  buildSpawns(): void
  buildVehicles(): void
  setupContactShadows(): void
  applyGlbToggle(on: boolean): Promise<void>
  buildRoster(): void
  buildMarkers?(): void
  prepareResolvers(): void
  prewarmShaders(): void
  setPlaying(playing: boolean): void
  tick(): void
  writeHud(force: boolean): void
  invalidate(): void
  requestWaterReflectionRefresh?(): void
  loadRecorderCamera(source: LoadSource, epoch: number): void
  transients: { rebuildSources(): void; rewindBursts(t: number): void }
  setClockRange(start: number, end: number): void
  setTime(t: number): void
  debug: boolean
  exposeVehicles(): void
  data(): SessionPlaybackData
  topViewOnLoad(): boolean
  cam(): string
  forceGlb(): boolean
  resetSessionCursors(): void
}

export function createSessionLifecycle(deps: SessionLifecycleDeps) {
  const store = deps.store
  let sessionGen = 0;
  let loadGeneration = 0;
  let sessionEpoch = 0;
  let SESSION_MODE: 'replay' | 'map' = 'replay';
  let perfLoadingStart = 0, perfLoadingEpoch = 0, perfFirstSubmitted = false, perfReadySession: number | null = null;

  async function loadData(source: LoadSource) {
    const perf = deps.perf();
    if (perf) { perf.interrupt('file-change'); perf.beginSession(); perf.setIdentity({ sessionMode: 'replay', mapId: null, replayDigest: null }); perfReadySession = null; perfLoadingStart = performance.now(); perfLoadingEpoch = perf.epoch; perfFirstSubmitted = false; }
    const gen = ++sessionGen;
    const epoch = ++sessionEpoch;
    const loadGen = ++loadGeneration;
    const ownsLoading = () => !deps.destroyed() && loadGen === loadGeneration;
    store.hasData = false;
    deps.clearCanonicalClock();
    store.err = '';
    store.loading = true;
    store.assetStage = false;
    store.assetProgress = null;
    const diagnosticEpoch = perf?.epoch;
    try {
      const observer: SessionPerfObserver | undefined = perf ? (event) => {
        if (ownsLoading() && gen === sessionGen && diagnosticEpoch === perf.epoch && event.stage === 'replay.identity' && event.digest) perf.setIdentity({ replayDigest: event.digest });
        if (ownsLoading() && gen === sessionGen) perf.event({ stage: event.stage, durationMs: event.durationMs ?? null,
          status: event.status ?? null, digest: event.digest ?? null }, diagnosticEpoch);
      } : undefined;
      const data = source?.session
        ? await (observer ? source.session.loadScene(source.file as File, observer) : source.session.loadScene(source.file as File))
        : await loadPlaybackData(observer ? { ...source, observer } : source);
      const playbackSession = source?.session ? source.session.getState(source.file as File) : null;
      if (gen !== sessionGen) return;
      if (perf && playbackSession?.replayDigest && ownsLoading() && diagnosticEpoch === perf.epoch) {
        perf.setIdentity({ replayDigest: playbackSession.replayDigest });
      }
      deps.teardownSession();
      deps.publishSessionData(data, playbackSession);
      deps.loadRecorderCamera(source, epoch);
      const ready = await startPlayback(epoch);
      if (!ready || !ownsLoading()) return;
      store.hasData = true;
      if (perf) { perfReadySession = epoch; deps.invalidate(); }
    } catch (e) {
      if (ownsLoading()) {
        if (perf) perf.event({ stage: 'replay.load', status: 'error' }, diagnosticEpoch);
        store.err = String((e as { message?: unknown })?.message || e || 'unknown');
      }
    } finally {
      if (ownsLoading()) store.loading = false;
    }
  }

  /**
   * 地图预览会话（MapPreview3DPane）：不依赖回放文件，只按地图 id 装载地图面资产
   * （ground/terrain/lighting/IBL/scenery/destructibles 完好预状态），无车辆、无传输。
   *
   * 会话纪律与 `loadData` 完全同构（gen/epoch/loadGen 三计数 + ownsLoading 归属判定），
   * 差异只有两处：数据是 stub（`minimalData` 同款形状，空车队已被内核测试证明安全），
   * 且 `startPlayback` 在地图资产就绪后按 `SESSION_MODE === 'map'` 提前收口——就绪标记落
   * `store.mapReady`，`store.hasData` 保持 false（传输/阵容/HUD 门控天然禁用）。
   *
   * @param opts 资产面数字地图 id（resolveMapKey 'id='）
   * @returns {Promise<void>} 就绪/失败都写 store（err / mapReady / assetStage），不抛
   */
  async function loadMapOnly({ mapId, mapName = '' }: LoadMapOnlyOptions) {
    const perf = deps.perf();
    if (perf) { perf.interrupt('map-change'); perf.beginSession(); perf.setIdentity({ sessionMode: 'map', mapId, replayDigest: null }); perfReadySession = null; perfLoadingStart = performance.now(); perfLoadingEpoch = perf.epoch; perfFirstSubmitted = false; }
    const gen = ++sessionGen;
    const epoch = ++sessionEpoch;
    const loadGen = ++loadGeneration;
    const ownsLoading = () => !deps.destroyed() && loadGen === loadGeneration;
    store.hasData = false;
    store.mapReady = false;
    deps.clearCanonicalClock();
    store.err = '';
    store.loading = true;
    store.assetStage = false;
    store.assetProgress = null;
    try {
      if (gen !== sessionGen) return;
      deps.teardownSession();
      SESSION_MODE = 'map';
      deps.publishMapOnlyData(mapId, mapName);
      const ready = await startPlayback(epoch);
      if (!ready || !ownsLoading()) return;
      store.mapReady = true;
      if (perf) { perfReadySession = epoch; deps.invalidate(); }
    } catch (e) {
      if (ownsLoading()) store.err = String((e as { message?: unknown })?.message || e || 'unknown');
    } finally {
      if (ownsLoading()) store.loading = false;
    }
  }

  /**
   * 进入场景：等待运行所需全部资产（地图/地形/地表/场景 GLB 按画质档）后落成会话。
   *
   * 本函数内部有多个 await；`epoch` 是本会话的身份令牌，**每个 await 之后与最终就绪态之前
   * 都必须复核**。否则被取代的会话会在资产加载返回后继续走完
   * buildVehicles / buildRoster / setPlaying / tick / writeHud，把旧会话复活到新会话身上。
   *
   * @param epoch loadData 提交数据后领取的会话身份（见 loadData 注释）
   * @returns {boolean} true = 本会话仍是当前会话，可以落成就绪态；false = 已过期，调用方必须放弃
   */
  async function startPlayback(epoch: number): Promise<boolean> {
    const current = () => epoch === sessionEpoch && !deps.destroyed();
    if (!current()) return false;
    deps.ensureRenderer();
    const dataAtStart = deps.data();
    store.mapName = dataAtStart.meta.map_name || ('map_' + dataAtStart.meta.map_id);
    {
      const perf = deps.perf();
      const data = deps.data();
      const mid0 = data.meta.map_id || 0;
      const mq0 = mid0 ? ('id=' + mid0) : ('name=' + encodeURIComponent(data.meta.map_name || ''));
      const perfMapResolveAt = perf ? performance.now() : 0;
      const resolvedKey = await resolveMapKey(mq0).catch(() => null);
      if (perf && current()) perf.event({ stage: 'map-resolution', durationMs: performance.now() - perfMapResolveAt }, perfLoadingEpoch);
      if (!current()) return false;
      deps.setMapKey(resolvedKey);
    }
    deps.prepareSessionCamera();
    deps.buildWorld();
    if (deps.topViewOnLoad() || deps.cam() === 'top') deps.setCam('top');
    else if (deps.cam() === 'free') { deps.clampCameraTarget(); deps.constrainFreeCameraAltitude(); }
    store.assetStage = true;
    store.assetProgress = null;
    const perf = deps.perf();
    const perfMapAt = perf ? performance.now() : 0;
    try {
      await deps.loadMapImage();
    } catch (e) {
      console.warn('地图资产加载失败（回退网格）:', e);
    } finally {
      if (current()) store.assetStage = false;
    }
    if (perf && current()) perf.event({ stage: 'map-assets-aggregate', durationMs: performance.now() - perfMapAt }, perfLoadingEpoch);
    if (!current()) return false;
    if (SESSION_MODE === 'map') {
      if (perf) { perf.event({ stage: 'vehicle-construction', status: 'skipped' }, perfLoadingEpoch); perf.event({ stage: 'glb-wait', status: 'skipped' }, perfLoadingEpoch); perf.event({ stage: 'shader-prewarm', status: 'skipped' }, perfLoadingEpoch); }
      deps.buildBases();
      deps.buildSpawns();
      deps.requestWaterReflectionRefresh?.();
      deps.invalidate();
      return true;
    }
    const perfVehiclesAt = perf ? performance.now() : 0;
    deps.buildVehicles();
    deps.setupContactShadows();
    if (perf && current()) perf.event({ stage: 'vehicle-construction', durationMs: performance.now() - perfVehiclesAt }, perfLoadingEpoch);
    const perfGlbAt = perf ? performance.now() : 0;
    if (deps.getGlbOn()) {
      const attach = deps.applyGlbToggle(true);
      if (deps.forceGlb()) {
        store.assetStage = true;
        try { await attach; } finally { if (current()) store.assetStage = false; }
        if (!current()) return false;
      }
    }
    if (perf && current()) perf.event({ stage: 'glb-wait', durationMs: deps.getGlbOn() && deps.forceGlb() ? performance.now() - perfGlbAt : null, status: !deps.getGlbOn() ? 'skipped' : deps.forceGlb() ? 'complete' : 'background-pending' }, perfLoadingEpoch);
    deps.buildRoster();
    deps.buildMarkers?.();
    deps.prepareResolvers();
    deps.transients.rebuildSources();
    deps.buildBases();
    deps.publishSceneClock();
    const [start, end] = deps.battleRange();
    deps.setClockRange(start, end);
    const t = start;
    deps.setTime(t);
    deps.transients.rewindBursts(t);
    deps.resetSessionCursors();
    if (deps.debug) deps.exposeVehicles();
    const perfWarmAt = perf ? performance.now() : 0;
    deps.prewarmShaders();
    if (perf && current()) perf.event({ stage: 'shader-prewarm', durationMs: performance.now() - perfWarmAt }, perfLoadingEpoch);
    store.startTime = start;
    store.duration = end;
    if (!current()) return false;
    deps.setPlaying(true);
    deps.tick();
    deps.writeHud(true);
    deps.requestWaterReflectionRefresh?.();
    deps.invalidate();
    return true;
  }

  return {
    loadData,
    loadMapOnly,
    startPlayback,
    bumpSessionGen() { sessionGen++; },
    invalidateLoadingTokens() { loadGeneration++; sessionEpoch++; },
    invalidateForDestroy() { loadGeneration++; sessionEpoch++; },
    sessionGen: () => sessionGen,
    sessionEpoch: () => sessionEpoch,
    sessionMode: () => SESSION_MODE,
    setSessionMode(mode: 'replay' | 'map') { SESSION_MODE = mode; },
    readySession: () => perfReadySession,
    loadingEpoch: () => perfLoadingEpoch,
    tryMarkFirstReadyFrame(now: number) {
      const perf = deps.perf();
      if (!perf || perfFirstSubmitted || !(store.hasData || store.mapReady)) return;
      if (perfReadySession !== sessionEpoch || perfLoadingEpoch !== perf.epoch) return;
      perfFirstSubmitted = true;
      perf.event({ stage: 'firstReadyFrameSubmittedMs', durationMs: now - perfLoadingStart }, perfLoadingEpoch);
    },
    isReadySession: () => perfReadySession === sessionEpoch,
    clearReadySession() { perfReadySession = null; },
  };
}

