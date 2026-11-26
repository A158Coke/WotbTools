import type { HealthTransition } from '../types/playback-v2.js'


export function receivedFromHealthAt(transitions: readonly HealthTransition[] | null | undefined, t: number): number {
  let received = 0
  let last: number | null = null
  for (const h of transitions || []) {
    if (!h || !Number.isFinite(h.timeSec) || h.timeSec > t + 1e-6) break
    if (typeof h.currentHp !== 'number' || !Number.isFinite(h.currentHp)) continue
    if (last !== null && h.currentHp < last) received += last - h.currentHp
    last = h.source === 'TANKOPEDIA_BASE_PROVISIONAL' ? null : h.currentHp
  }
  return received
}
