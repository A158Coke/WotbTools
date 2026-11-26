import { nextTick, ref, watch } from 'vue'
import { resetViewerClocks, viewerClocks } from '../scene/playback/viewerClockSync.js'

export interface ViewerSeekRequest { id: number; sec: number; playing: boolean; speed: number }
export interface Pending3dSeek { id: number; sec: number; playing?: boolean; speed?: number }

type ViewerMode = '2d' | '3d'
const VIEWER_MODE_BY_CAPABILITY: Record<string, ViewerMode> = { playback: '2d', '3d': '3d', events: '2d' }
function viewerModeOf(capability: string): ViewerMode | null {
  return VIEWER_MODE_BY_CAPABILITY[capability] ?? null
}

export function useReplayViewerClockBridge(deps: {
  viewerMode: { readonly value: ViewerMode }
  activeCapability: { readonly value: string }
  switchCapability: (key: string, navigate: boolean) => void
}) {
  const playbackSeek = ref<number | null>(null)
  const playbackSeekRequest = ref<ViewerSeekRequest | null>(null)
  const pending3dSeek = ref<Pending3dSeek | null>(null)
  let seekSeq = 0

  interface Handoff { elapsed: number; playing: boolean; speed: number; startRaw: number }
  function handoffSourceOf(mode: ViewerMode): Handoff | null {
    const prev = viewerClocks[mode]
    if (!prev.ready) return null
    return { elapsed: Math.max(0, prev.time), playing: prev.playing, speed: prev.speed, startRaw: prev.startRaw }
  }
  function pushHandoff(mode: ViewerMode, src: Handoff): void {
    if (mode === '3d') {
      const target = viewerClocks['3d']
      pending3dSeek.value = {
        id: ++seekSeq, sec: src.elapsed + (target.startRaw || src.startRaw),
        playing: src.playing, speed: src.speed,
      }
      return
    }
    playbackSeekRequest.value = { id: ++seekSeq, sec: src.elapsed, playing: src.playing, speed: src.speed }
  }

  function setViewerMode(mode: ViewerMode): void {
    if (mode === deps.viewerMode.value) return
    const src = handoffSourceOf(deps.viewerMode.value)
    deps.switchCapability(mode === '3d' ? '3d' : 'playback', true)
    if (src) pushHandoff(mode, src)
  }
  function applyCapabilityFromRoute(key: string): void {
    const next = viewerModeOf(key)
    const prev = viewerModeOf(deps.activeCapability.value)
    const src = next && prev && prev !== next ? handoffSourceOf(prev) : null
    deps.switchCapability(key, false)
    if (next && src) pushHandoff(next, src)
  }
  function apply2dEventSeek(elapsed: number): void {
    playbackSeek.value = null
    nextTick(() => { playbackSeek.value = elapsed })
  }
  let pending2dRawSeek: number | null = null
  watch(() => viewerClocks['2d'].ready, (ready) => {
    if (!ready || pending2dRawSeek == null) return
    const raw = pending2dRawSeek
    pending2dRawSeek = null
    apply2dEventSeek(Math.max(0, raw - (viewerClocks['2d'].startRaw || 0)))
  })
  function onEventSeek(sec: number): void {
    if (!Number.isFinite(sec)) return
    if (deps.viewerMode.value === '3d') {
      pending3dSeek.value = { id: ++seekSeq, sec }
      return
    }
    const clock = viewerClocks['2d']
    if (!clock.ready) { pending2dRawSeek = sec; return }
    apply2dEventSeek(Math.max(0, sec - (clock.startRaw || 0)))
  }
  function resetViewerClockBridge(): void {
    pending3dSeek.value = null
    playbackSeekRequest.value = null
    pending2dRawSeek = null
    resetViewerClocks()
  }

  return {
    playbackSeek, playbackSeekRequest, pending3dSeek,
    setViewerMode, applyCapabilityFromRoute, onEventSeek, resetViewerClockBridge,
  }
}