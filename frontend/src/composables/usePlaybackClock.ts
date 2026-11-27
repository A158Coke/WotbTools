import { ref, watch } from 'vue'
import type { Ref } from 'vue'
import { advancePlaybackTime, clampPlaybackTime } from '../utils/playbackClock.js'
import { isPlaybackSpeed } from './usePlaybackTransport.js'

export function usePlaybackClock(deps: {
  duration: () => number
  loop: () => boolean
  nowMs: Ref<number>
  realNowMs: () => number
  consumeEvents: (fromSec: number, toSec: number) => void
  resetTransients: (sec: number) => void
  hasPendingTransients: (now: number) => boolean
  pruneTransients: (now: number) => void
  rewindTransientCursor: () => void
  feedVisible: () => boolean
  onPlayStart: () => void
  seekTo: () => number | null
}) {
  const CLOCK_PUBLISH_SEC = 1 / 30
  let playbackClock = 0
  const currentTime = ref(0)
  const playing = ref(false)
  const speed = ref(1)

  function publishClock(t: number) {
    playbackClock = t
    currentTime.value = t
  }

  const hpNoTransition = ref(false)

  function suppressHpTransition() {
    hpNoTransition.value = true
    if (typeof setTimeout === 'function') {
      setTimeout(() => { hpNoTransition.value = false }, 0)
    } else {
      hpNoTransition.value = false
    }
  }

  let rafId: number | null = null
  let lastFrameTs: number | null = null

  let pauseRafId: number | null = null

  function frame(ts: number) {
    if (!playing.value) {
      rafId = null
      return
    }
    const delta = lastFrameTs == null ? 0 : (ts - lastFrameTs)
    lastFrameTs = ts
    const prev = playbackClock
    const next = advancePlaybackTime(prev, deps.duration(), delta, speed.value)
    playbackClock = next
    deps.nowMs.value = deps.realNowMs()
    deps.consumeEvents(prev, next)
    if (next >= deps.duration()) {
      if (deps.loop()) {
        publishClock(0)
        deps.rewindTransientCursor()
        rafId = requestAnimationFrame(frame)
        return
      }
      publishClock(next)
      playing.value = false
      rafId = null
      ensurePauseClock(deps.realNowMs())
      return
    }
    if (next - currentTime.value >= CLOCK_PUBLISH_SEC || next < currentTime.value) {
      currentTime.value = next
    }
    rafId = requestAnimationFrame(frame)
  }

  function play() {
    if (playing.value || deps.duration() <= 0) return
    deps.onPlayStart()
    playing.value = true
    lastFrameTs = null
    playbackClock = currentTime.value
    pauseRafId = null
    rafId = requestAnimationFrame(frame)
  }

  function pause() {
    playing.value = false
    if (rafId != null) {
      cancelAnimationFrame(rafId)
      rafId = null
    }
    if (currentTime.value !== playbackClock) currentTime.value = playbackClock
    ensurePauseClock(deps.realNowMs())
  }

  function seek(sec: number) {
    publishClock(clampPlaybackTime(sec, deps.duration()))
    deps.nowMs.value = deps.realNowMs()
    deps.resetTransients(currentTime.value)
    suppressHpTransition()
  }

  function step(delta: number) {
    publishClock(clampPlaybackTime(currentTime.value + delta, deps.duration()))
    deps.resetTransients(currentTime.value)
    suppressHpTransition()
  }

  function setSpeed(next: number) {
    if (isPlaybackSpeed(next)) speed.value = next
  }

  watch(() => deps.seekTo(), (sec) => {
    if (Number.isFinite(sec)) {
      pause()
      publishClock(clampPlaybackTime(sec!, deps.duration()))
      deps.resetTransients(currentTime.value)
      suppressHpTransition()
    }
  }, { immediate: true })

  function hasPendingPauseClock(now: number) {
    return deps.hasPendingTransients(now)
  }

  function ensurePauseClock(now: number) {
    if (pauseRafId != null || playing.value) return
    if (hasPendingPauseClock(now)) {
      pauseRafId = requestAnimationFrame(() => {
        pauseRafId = null
        deps.nowMs.value = typeof performance !== 'undefined' ? performance.now() : Date.now()
      })
    }
  }

  watch([() => deps.nowMs.value, currentTime], () => {
    deps.pruneTransients(deps.nowMs.value)
    ensurePauseClock(deps.nowMs.value)
  })

  watch(() => deps.feedVisible(), (visible) => {
    if (!visible) return
    const now = deps.realNowMs()
    deps.nowMs.value = now
    ensurePauseClock(now)
  })

  function disposeClock() {
    if (rafId != null) cancelAnimationFrame(rafId)
    if (pauseRafId != null) cancelAnimationFrame(pauseRafId)
    rafId = null
    pauseRafId = null
  }

  return {
    currentTime,
    playing,
    speed,
    hpNoTransition,
    publishClock,
    play,
    pause,
    seek,
    step,
    setSpeed,
    seekToEvent: (sec: number) => {
      pause()
      seek(sec)
    },
    ensurePauseClock,
    disposeClock,
  }
}

export type PlaybackClock = ReturnType<typeof usePlaybackClock>
