import { feedbackPrefs } from './useFeedbackPrefs.js'

/**
 * 按键音效（design-language §10「反馈」）：四种短音，默认关闭；`prefers-reduced-motion: reduce`
 * 时不播放。用 WebAudio 合成，不引入音频资产；iOS Safari 的 WebAudio 默认随静音开关静音。
 */
export type SoundKind = 'click' | 'success' | 'error' | 'notice'
type Tone = { frequency: number, start: number, duration: number }
const SOUND_TONES: Record<SoundKind, Tone[]> = Object.freeze({
  click: [{ frequency: 880, start: 0, duration: 0.03 }],
  success: [{ frequency: 660, start: 0, duration: 0.06 }, { frequency: 990, start: 0.07, duration: 0.08 }],
  error: [{ frequency: 220, start: 0, duration: 0.16 }],
  notice: [{ frequency: 740, start: 0, duration: 0.09 }],
})

let context: AudioContext | null = null

function reducedMotion() {
  return typeof window !== 'undefined' && typeof window.matchMedia === 'function'
    && window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

export function playSound(kind: SoundKind): boolean {
  if (!feedbackPrefs.value.sound || reducedMotion()) return false
  const Ctor = typeof window !== 'undefined' ? window.AudioContext : undefined
  if (typeof Ctor !== 'function') return false
  try {
    context ??= new Ctor()
    const now = context.currentTime
    for (const tone of SOUND_TONES[kind]) {
      const oscillator = context.createOscillator()
      const gain = context.createGain()
      oscillator.frequency.value = tone.frequency
      gain.gain.setValueAtTime(0.08, now + tone.start)
      gain.gain.exponentialRampToValueAtTime(0.0001, now + tone.start + tone.duration)
      oscillator.connect(gain).connect(context.destination)
      oscillator.start(now + tone.start)
      oscillator.stop(now + tone.start + tone.duration)
    }
    return true
  } catch {
    return false
  }
}

export function __resetSoundForTest() {
  context = null
}
