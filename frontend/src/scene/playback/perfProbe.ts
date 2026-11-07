// 性能探针（`?perf`）owner（#820 结构拆分，2026-11-06 自 initPlayback 闭包出仓）：
// 分阶段逐帧耗时记录（perfFrame）、主线程停顿看门狗（PERF_HEARTBEAT 心跳）与
// window.__pbPerf 调试句柄（report/snapshot/startCapture/stopCapture/reset）的唯一归属。
// 只读测量，不改变任何渲染行为。PERF/perf/gpu 仍由宿主持引用（渲染循环与会话编排
// 直接消费），本工厂返回同一组句柄；代码与搬移前逐字一致，闭包读数改经 deps 注入。
import type { WebGLRenderer } from 'three'
import { createPerf } from './perf.ts'
import { createGpuFrameTracker } from './gpuTimer.ts'
import { AGENT_WASM_COMMIT, AGENT_WASM_RELEASE } from '../../api/agent-replay-facets.js'
import { isAndroidRuntime } from '../../platform/runtime.js'

type GpuFrameTracker = ReturnType<typeof createGpuFrameTracker>

/** ?perf 诊断句柄（window.__pbPerf；生产不创建）。 */
const debugWindow = window as Window & { __pbPerf?: unknown }

/** 穿深着色逐 pass 统计面（owner = cameraRuntime.armorStats；本模块只透传数值）。 */
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

/** 宿主注入的依赖（getter 快照；语义见各字段处原文注释）。 */
export interface PerfProbeDeps {
  container: HTMLElement
  getT(): number
  getRenderer(): WebGLRenderer | null
  getQualityKey(): string
  /** 穿深着色偏好（owner = 宿主 setArmorHighlight）。 */
  getArmorHighlightPref(): boolean
  getCameraMode(): string
  paused(): boolean
  /** 世界/地形计数（owner = mapWorld）。 */
  terrainCounters(): Record<string, unknown>
  resetTerrainCounters(): void
  /** 战斗表现计数（owner = battleRuntime）。 */
  battle: {
    tracerCount(): number
    trajLineCount(): number
    fxStats(): { impacts?: number; bursts?: number } | null
  }
  /** 可见车辆计数（owner = vehicleRuntime）。 */
  getVehicles(): Array<{ group: { visible: boolean } }>
  /** annotation 统计（owner = annotationScene.stats）。 */
  annotationStats(): unknown
  /** 穿深着色逐 pass 统计（owner = cameraRuntime.armorStats）。 */
  armorStats(): ArmorStatsView
  /** 接地阴影装配数（#907 主干随迁；null = 未启用）。 */
  contactShadowsCount(): number | null
}

/** ?perf 探针对宿主的暴露面：PERF/perf/gpu 由宿主解构持有，其余经探针调度。 */
export interface PerfProbeHandle {
  PERF: boolean
  perf: ReturnType<typeof createPerf> | null
  gpu: GpuFrameTracker | null
  perfFrame(updateMs: number, renderMs: number, armorMs: number, armorStats: ArmorStatsView | null, stages: Record<string, unknown>): void
  perfStartWatchdog(): void
  stopWatchdog(): void
  perfHandle: {
    report(): string
    snapshot(): Record<string, unknown>
    startCapture(options: { scenarioId: string; durationMs?: number }): void
    stopCapture(): unknown
    reset(): void
  } | null
}

export function createPerfProbe(deps: PerfProbeDeps): PerfProbeHandle {
  const PERF = typeof window !== 'undefined'
    && new URLSearchParams(window.location.search).has('perf');
  const perf = PERF ? createPerf() : null;
  // perf 在 PERF 关闭时为 null：原 JS 同口径（GPU 探针仅在 ?perf 下创建）。
  const gpu = PERF ? createGpuFrameTracker(perf!) : null;
  if (perf) perf.setIdentity({ buildCommit: typeof __BUILD_COMMIT__ !== 'undefined' ? __BUILD_COMMIT__ : null,
    buildTime: typeof __BUILD_TIME__ !== 'undefined' ? __BUILD_TIME__ : null,
    wasmCommit: AGENT_WASM_COMMIT, wasmRelease: AGENT_WASM_RELEASE, replayDigest: null, runtime: isAndroidRuntime() ? 'android' : 'browser',
    userAgent: navigator.userAgent, viewport: [window.innerWidth, window.innerHeight],
    dpr: window.devicePixelRatio, quality: deps.getQualityKey(), assetIdentity: null, identityComplete: false });
  function perfFrame(updateMs: number, renderMs: number, armorMs: number, armorStats: ArmorStatsView | null, stages: Record<string, unknown>) {
    const a = armorStats || {};
    const renderer = deps.getRenderer();
    perf!.record({ ...stages, updateMs, renderMs, armorMs, t: deps.getT(),
      calls: renderer ? renderer.info.render.calls : 0, ...(deps.terrainCounters()),
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
  // 主线程停顿看门狗（`?perf`）：帧循环之外的**长任务**（例如解析/投影跑在主线程）不会出现在
  // 帧间隔里——它们表现为"下一帧的 dt 巨大、但 update/render 都很小"。看门狗用 50ms 心跳量真实
  // 间隔，直接抓出这类停顿（含当时的回放时刻 T），与帧统计互相印证。
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
  /** destroy / 会话销毁段：看门狗停表（心跳 setInterval 不清会永久空转）。 */
  function stopWatchdog() { if (perfBeatTimer) { clearInterval(perfBeatTimer); perfBeatTimer = 0; } }
  function updatePerfIdentity() {
    const renderer = deps.getRenderer();
    perf!.setIdentity({ quality: deps.getQualityKey(), cameraMode: deps.getCameraMode(), armorhl: deps.getArmorHighlightPref(),
      viewport: [deps.container.clientWidth, deps.container.clientHeight], dpr: renderer ? renderer.getPixelRatio() : window.devicePixelRatio });
  }
  const perfHandle = PERF ? {
    report: () => { gpu!.poll(); updatePerfIdentity(); const s = perf!.report() + `\ngpu_total_ms: sum of successfully measured render-pass GPU timings (not a full GPU frame; null unless all required queries succeed)` + `\nannotation: ${JSON.stringify(deps.annotationStats())}` + `\ngpu: ${JSON.stringify(gpu!.snapshot())}` + `\nmain-thread stalls >${PERF_HEARTBEAT_MS * 2}ms: ${perfStalls.length}\n` + perfStalls.map(r => `  ${r.gap.toFixed(1)} ms @T=${r.t.toFixed(1)}`).join('\n'); console.log(s); return s; },
    snapshot: () => (gpu!.poll(), updatePerfIdentity(), { ...perf!.snapshot(), annotation: { ...(deps.annotationStats() as Record<string, unknown>) }, resources: { geometries: deps.getRenderer()?.info?.memory?.geometries ?? null, textures: deps.getRenderer()?.info?.memory?.textures ?? null }, armorRt: deps.armorStats().rt ? { ...deps.armorStats().rt } : null, contactShadows: deps.contactShadowsCount(), gpu: gpu!.snapshot() }),
    startCapture: (options: { scenarioId: string; durationMs?: number }) => { if (deps.paused()) throw new Error('scene is inactive'); updatePerfIdentity(); perf!.startCapture(options); },
    stopCapture: () => { gpu!.poll(); return perf!.stopCapture(); },
    reset: () => { gpu!.reset(); perf!.reset(); deps.resetTerrainCounters(); perfStalls = []; perfBeat = performance.now(); },
  } : null;
  if (PERF) { perfStartWatchdog(); debugWindow.__pbPerf = perfHandle; }
  return {
    PERF,
    perf,
    gpu,
    perfFrame,
    perfStartWatchdog,
    stopWatchdog,
    perfHandle,
  };
}
