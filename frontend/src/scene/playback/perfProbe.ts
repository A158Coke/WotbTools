import type { WebGLRenderer } from 'three'
import { createPerf } from './perf.ts'
import { createGpuFrameTracker } from './gpuTimer.ts'
import { AGENT_WASM_COMMIT, AGENT_WASM_RELEASE } from '../../api/agent-replay-facets.js'
import { isAndroidRuntime } from '../../platform/runtime.js'
import { assetProvider } from '../assetProvider.js'

type GpuFrameTracker = ReturnType<typeof createGpuFrameTracker>

const debugWindow = (typeof window !== 'undefined' ? window : {}) as Window & { __pbPerf?: unknown }

export interface ArmorStatsView {
  pickMs?: number
  stateMs?: number
  thicknessMs?: number
  occluderMs?: number
  colorMs?: number
  calls?: number
  stateCalls?: number
  thicknessCalls?: number
  occluderCalls?: number
  colorCalls?: number
  rt?: Record<string, number> | null
}

export interface PerfProbeDeps {
  getViewportSize(): { x: number; y: number }
  getT(): number
  getRenderer(): WebGLRenderer | null
  getQualityKey(): string
  getSpeed(): number
  getDynres(): boolean
  getArmorHighlightPref(): boolean
  getCameraMode(): string
  paused(): boolean
  terrainCounters(): Record<string, unknown>
  resetTerrainCounters(): void
  battle: {
    tracerCount(): number
    trajLineCount(): number
    fxStats(): { impacts?: number; bursts?: number } | null
  }
  getVehicles(): Array<{ group: { visible: boolean } }>
  annotationStats(): unknown
  armorStats(): ArmorStatsView
  contactShadowsCount(): number | null
}

export interface PerfProbeHandle {
  PERF: boolean
  perf: ReturnType<typeof createPerf> | null
  gpu: GpuFrameTracker | null
  perfFrame(updateMs: number, renderMs: number, armorMs: number, armorStats: ArmorStatsView | null, stages: Record<string, unknown>): void
  attachRenderer(renderer?: WebGLRenderer | null): void
  perfStartWatchdog(): void
  stopWatchdog(): void
  dispose(): void
  perfHandle: {
    report(): string
    snapshot(): Record<string, unknown>
    startCapture(options: { scenarioId: string; durationMs?: number }): void
    stopCapture(): unknown
    reset(): void
  } | null
}

function uploadBytes(data: unknown, srcOffset: unknown, length: unknown) {
  const view = data as { byteLength?: number; BYTES_PER_ELEMENT?: number } | null | undefined
  const total = view?.byteLength
  if (typeof total !== 'number') return 0
  const bytesPerElement = view?.BYTES_PER_ELEMENT ?? 1
  const offset = typeof srcOffset === 'number' && srcOffset > 0 ? srcOffset * bytesPerElement : 0
  if (typeof length === 'number' && Number.isFinite(length) && length >= 0) {
    return Math.min(Math.max(0, total - offset), length * bytesPerElement)
  }
  return Math.max(0, total - offset)
}

type UploadStats = { bufferDataCalls: number; bufferDataBytes: number; bufferSubDataCalls: number; bufferSubDataBytes: number }

type UploadMethod = 'bufferData' | 'bufferSubData'

function callPrototypeUpload(
  context: WebGLRenderingContext | WebGL2RenderingContext,
  key: UploadMethod,
  fallback: (...args: unknown[]) => unknown,
  args: unknown[],
): unknown {
  let owner: object | null = Object.getPrototypeOf(context)
  while (owner) {
    const current = Reflect.get(owner, key)
    if (typeof current === 'function') return Reflect.apply(current, context, args)
    owner = Object.getPrototypeOf(owner)
  }
  return fallback(...args)
}

export function installUploadTracking(
  context: WebGLRenderingContext | WebGL2RenderingContext,
  stats: UploadStats,
  attempted = new WeakSet<object>(),
): boolean {
  if (attempted.has(context)) return false
  attempted.add(context)
  const originalData = context.bufferData
  const originalSubData = context.bufferSubData
  if (typeof originalData !== 'function' || typeof originalSubData !== 'function') return false
  const nativeBufferData = originalData.bind(context) as (...args: unknown[]) => unknown
  const nativeBufferSubData = originalSubData.bind(context) as (...args: unknown[]) => unknown
  const dataFromPrototype = !Object.prototype.hasOwnProperty.call(context, 'bufferData')
  const subDataFromPrototype = !Object.prototype.hasOwnProperty.call(context, 'bufferSubData')
  let installedData = false
  let installedSubData = false
  try {
    installedData = Reflect.set(context, 'bufferData', (...args: unknown[]) => {
      stats.bufferDataCalls += 1
      stats.bufferDataBytes += uploadBytes(args[1], args[3], args[4])
      return dataFromPrototype
        ? callPrototypeUpload(context, 'bufferData', nativeBufferData, args)
        : nativeBufferData(...args)
    })
    if (!installedData) throw new Error('WebGL bufferData is not writable')
    installedSubData = Reflect.set(context, 'bufferSubData', (...args: unknown[]) => {
      stats.bufferSubDataCalls += 1
      stats.bufferSubDataBytes += uploadBytes(args[2], args[3], args[4])
      return subDataFromPrototype
        ? callPrototypeUpload(context, 'bufferSubData', nativeBufferSubData, args)
        : nativeBufferSubData(...args)
    })
    if (!installedSubData) throw new Error('WebGL bufferSubData is not writable')
    return true
  } catch {
    if (installedData) {
      try { if (!Reflect.set(context, 'bufferData', originalData)) delete (context as { bufferData?: unknown }).bufferData } catch { /* optional */ }
    }
    if (installedSubData) {
      try { if (!Reflect.set(context, 'bufferSubData', originalSubData)) delete (context as { bufferSubData?: unknown }).bufferSubData } catch { /* optional */ }
    }
    return false
  }
}

export function createPerfProbe(deps: PerfProbeDeps): PerfProbeHandle {
  const PERF = typeof window !== 'undefined'
    && new URLSearchParams(window.location.search).has('perf');
  const perf = PERF ? createPerf() : null;
  let uploadContext: WebGLRenderingContext | WebGL2RenderingContext | null = null
  let uploadStats = { bufferDataCalls: 0, bufferDataBytes: 0, bufferSubDataCalls: 0, bufferSubDataBytes: 0 }
  let uploadLast = { ...uploadStats }
  const uploadAttempted = new WeakSet<object>()
  function installUploadTracker(renderer: WebGLRenderer | null) {
    if (!PERF) return
    const context = renderer?.getContext?.() as WebGLRenderingContext | WebGL2RenderingContext | undefined
    if (!context || context === uploadContext) return
    if (installUploadTracking(context, uploadStats, uploadAttempted)) {
      uploadContext = context
      uploadLast = { ...uploadStats }
    }
  }
  function takeUploadDelta() {
    const delta = {
      bufferDataCalls: uploadStats.bufferDataCalls - uploadLast.bufferDataCalls,
      bufferDataBytes: uploadStats.bufferDataBytes - uploadLast.bufferDataBytes,
      bufferSubDataCalls: uploadStats.bufferSubDataCalls - uploadLast.bufferSubDataCalls,
      bufferSubDataBytes: uploadStats.bufferSubDataBytes - uploadLast.bufferSubDataBytes,
    }
    uploadLast = { ...uploadStats }
    return delta
  }
  const gpu = PERF ? createGpuFrameTracker(perf!) : null;
  function attachRenderer(renderer: WebGLRenderer | null = deps.getRenderer()) { installUploadTracker(renderer) }
  if (perf) attachRenderer();
  if (perf) perf.setIdentity({ buildCommit: typeof __BUILD_COMMIT__ !== 'undefined' ? __BUILD_COMMIT__ : null,
    buildTime: typeof __BUILD_TIME__ !== 'undefined' ? __BUILD_TIME__ : null,
    wasmCommit: AGENT_WASM_COMMIT, wasmRelease: AGENT_WASM_RELEASE, replayDigest: null, runtime: isAndroidRuntime() ? 'android' : 'browser',
    userAgent: navigator.userAgent, viewport: viewportOf(deps),
    dpr: window.devicePixelRatio, quality: deps.getQualityKey(), datasetId: null, assetIdentity: null, identityComplete: false });
  if (perf && assetProvider.configured()) {
    void assetProvider.json('/version.json').then(version => {
      if (typeof version.dataset_id === 'string' && typeof version.content_digest === 'string'
          && /^sha256:[0-9a-f]{64}$/i.test(version.content_digest)) {
        perf.setIdentity({ datasetId: version.dataset_id, assetIdentity: version.content_digest });
      }
    }).catch(() => { /* Local packs can lack a version stamp. Keep the identity unknown. */ });
  }
  function perfFrame(updateMs: number, renderMs: number, armorMs: number, armorStats: ArmorStatsView | null, stages: Record<string, unknown>) {
    const a = armorStats || {};
    const renderer = deps.getRenderer();
    installUploadTracker(renderer);
    const upload = takeUploadDelta();
    perf!.record({ ...stages, updateMs, renderMs, armorMs, t: deps.getT(),
      calls: renderer?.info?.render?.calls ?? 0, triangles: renderer?.info?.render?.triangles ?? null,
      geometries: renderer?.info?.memory?.geometries ?? null, ...upload, ...(deps.terrainCounters()),
      armorPick: a.pickMs ?? 0, armorState: a.stateMs ?? 0,
      armorThick: a.thicknessMs ?? 0, armorOcc: a.occluderMs ?? 0,
      armorColor: a.colorMs ?? 0, armorCalls: a.calls ?? 0,
      armorStateCalls: a.stateCalls ?? 0, armorThicknessCalls: a.thicknessCalls ?? 0, armorOccluderCalls: a.occluderCalls ?? 0, armorColorCalls: a.colorCalls ?? 0,
      armorRtWidth: a.rt?.width ?? null, armorRtHeight: a.rt?.height ?? null, armorRtCreates: a.rt?.creates ?? null,
      armorRtResizes: a.rt?.resizes ?? null, armorRtDisposes: a.rt?.disposes ?? null, armorRtColorEstimateBytes: a.rt?.colorEstimateBytes ?? null,
      dpr: renderer ? renderer.getPixelRatio() : 0,
      tracers: deps.battle.tracerCount(), traj: deps.battle.trajLineCount(),
      impacts: deps.battle.fxStats()?.impacts ?? 0,
      burst: deps.battle.fxStats()?.bursts ?? 0,
      veh: deps.getVehicles().filter((v) => v.group.visible).length });
  }
  const PERF_HEARTBEAT_MS = 50;
  let perfStalls: Array<{ gap: number; t: number }> = [], perfBeat = 0, perfBeatTimer: ReturnType<typeof setInterval> | 0 = 0;
  function perfStartWatchdog() {
    if (!PERF || perfBeatTimer) return;
    perfBeat = performance.now();
    perfBeatTimer = setInterval(() => {
      const now = performance.now();
      const gap = now - perfBeat;
      perfBeat = now;
      if (gap > PERF_HEARTBEAT_MS * 2) {
        perfStalls.push({ gap, t: deps.getT() });
        perf!.event({ stage: 'main-thread-stall', durationMs: gap, replayTime: deps.getT() });
        perfStalls.sort((a, b) => b.gap - a.gap);
        if (perfStalls.length > 8) perfStalls.length = 8;
      }
    }, PERF_HEARTBEAT_MS);
  }
  function stopWatchdog() { if (perfBeatTimer) { clearInterval(perfBeatTimer); perfBeatTimer = 0; } }
  function viewportOf(deps: PerfProbeDeps): [number, number] {
    const size = deps.getViewportSize();
    return [size.x, size.y];
  }
  function updatePerfIdentity() {
    const renderer = deps.getRenderer();
    perf!.setIdentity({ quality: deps.getQualityKey(), cameraMode: deps.getCameraMode(), armorhl: deps.getArmorHighlightPref(),
      playbackSpeed: deps.getSpeed(), dynres: deps.getDynres(),
      viewport: viewportOf(deps), dpr: renderer ? renderer.getPixelRatio() : window.devicePixelRatio });
  }
  const perfHandle = PERF ? {
    report: () => { gpu!.poll(); updatePerfIdentity(); const s = perf!.report() + `\ngpu_total_ms: sum of successfully measured render-pass GPU timings (not a full GPU frame; null unless all required queries succeed)` + `\nannotation: ${JSON.stringify(deps.annotationStats())}` + `\ngpu: ${JSON.stringify(gpu!.snapshot())}` + `\nmain-thread stalls >${PERF_HEARTBEAT_MS * 2}ms: ${perfStalls.length}\n` + perfStalls.map(r => `  ${r.gap.toFixed(1)} ms @T=${r.t.toFixed(1)}`).join('\n'); console.log(s); return s; },
    snapshot: () => (gpu!.poll(), updatePerfIdentity(), { ...perf!.snapshot(), annotation: { ...(deps.annotationStats() as Record<string, unknown>) }, resources: { geometries: deps.getRenderer()?.info?.memory?.geometries ?? null, textures: deps.getRenderer()?.info?.memory?.textures ?? null }, armorRt: deps.armorStats().rt ? { ...deps.armorStats().rt } : null, contactShadows: deps.contactShadowsCount(), gpu: gpu!.snapshot() }),
    startCapture: (options: { scenarioId: string; durationMs?: number }) => { if (deps.paused()) throw new Error('scene is inactive'); updatePerfIdentity(); perf!.startCapture(options); },
    stopCapture: () => { gpu!.poll(); return perf!.stopCapture(); },
    reset: () => { gpu!.reset(); perf!.reset(); deps.resetTerrainCounters(); uploadLast = { ...uploadStats }; perfStalls = []; perfBeat = performance.now(); },
  } : null;
  if (PERF) { perfStartWatchdog(); debugWindow.__pbPerf = perfHandle; }
  return {
    PERF,
    perf,
    gpu,
    perfFrame,
    attachRenderer,
    perfStartWatchdog,
    stopWatchdog,
    perfHandle,
    dispose() {
      if (!perf) return
      stopWatchdog()
      perf.reset()
      if (debugWindow.__pbPerf === perfHandle) delete debugWindow.__pbPerf
    },
  };
}
