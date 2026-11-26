export interface FrameMeterSample {
  fps: number
  frameMs: number
  peakMs: number
}

export interface FrameMeter {
  sample(now: number): FrameMeterSample | null
  readonly fps: number
  readonly frameMs: number
  readonly peakMs: number
  reset(): void
}

export function createFrameMeter({ windowMs = 500 }: { windowMs?: number } = {}): FrameMeter {
  let active = false
  let startedAt = 0
  let lastAt = 0
  let frames = 0
  let fps = 0
  let frameMs = 0
  let peakMs = 0

  const round1 = (n: number) => Math.round(n * 10) / 10

  return {
    sample(now: number): FrameMeterSample | null {
      if (!active) { active = true; startedAt = now; lastAt = now; frames = 0; peakMs = 0; return null }
      const gap = now - lastAt
      lastAt = now
      frames++
      if (gap > peakMs) peakMs = gap
      const elapsed = now - startedAt
      if (elapsed < windowMs) return null
      fps = round1((frames * 1000) / elapsed)
      frameMs = round1(elapsed / frames)
      const out = { fps, frameMs, peakMs: round1(peakMs) }
      startedAt = now
      frames = 0
      peakMs = 0
      return out
    },
    get fps() { return fps },
    get frameMs() { return frameMs },
    get peakMs() { return peakMs },
    reset() { active = false; startedAt = 0; lastAt = 0; frames = 0; fps = 0; frameMs = 0; peakMs = 0 },
  }
}
