import { reactive } from 'vue'

export type ViewerMode = '2d' | '3d'

export interface ViewerClock {
  time: number
  playing: boolean
  ready: boolean
  startRaw: number
  speed: number
}

export const viewerClocks = reactive<Record<ViewerMode, ViewerClock>>({
  '2d': { time: 0, playing: false, ready: false, startRaw: 0, speed: 1 },
  '3d': { time: 0, playing: false, ready: false, startRaw: 0, speed: 1 },
})

export function publishViewerClock(mode: ViewerMode, time: number, playing: boolean, ready: boolean, startRaw: number, speed: number) {
  if (!Number.isFinite(time) || !Number.isFinite(startRaw) || !Number.isFinite(speed)) return
  const slot = viewerClocks[mode]
  if (slot.ready === ready && slot.playing === playing && slot.startRaw === startRaw
    && slot.speed === speed && Math.abs(slot.time - time) < 0.05) return
  slot.time = time
  slot.playing = playing
  slot.ready = ready
  slot.startRaw = startRaw
  slot.speed = speed
}

if (import.meta.env.DEV && typeof window !== 'undefined' && new URLSearchParams(window.location.search).has('debug')) {
  ;(window as Window & { __viewerClocks?: typeof viewerClocks }).__viewerClocks = viewerClocks
}

export function resetViewerClocks() {
  for (const slot of Object.values(viewerClocks)) {
    slot.time = 0
    slot.playing = false
    slot.ready = false
    slot.startRaw = 0
    slot.speed = 1
  }
}
