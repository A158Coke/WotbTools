export interface MotionTokens {
  fast: number
  base: number
  slow: number
  ease: [number, number, number, number]
}

const STANDARD_EASE: MotionTokens['ease'] = [0.2, 0, 0, 1]

function seconds(value: string): number {
  const text = value.trim()
  const parsed = Number.parseFloat(text)
  if (!Number.isFinite(parsed)) return 0
  return text.endsWith('ms') ? parsed / 1000 : parsed
}

function cubicBezier(value: string): MotionTokens['ease'] {
  const match = /cubic-bezier\(([^)]+)\)/.exec(value)
  const numbers = match?.[1].split(',').map(part => Number.parseFloat(part))
  return numbers?.length === 4 && numbers.every(Number.isFinite) ? numbers as MotionTokens['ease'] : STANDARD_EASE
}

export function readMotionTokens(root: Element | undefined = typeof document === 'undefined' ? undefined : document.documentElement): MotionTokens {
  if (!root) return { fast: 0, base: 0, slow: 0, ease: STANDARD_EASE }
  const style = getComputedStyle(root)
  return {
    fast: seconds(style.getPropertyValue('--duration-fast')),
    base: seconds(style.getPropertyValue('--duration-base')),
    slow: seconds(style.getPropertyValue('--duration-slow')),
    ease: cubicBezier(style.getPropertyValue('--ease-standard')),
  }
}

export function motionTransition(tier: keyof Pick<MotionTokens, 'fast' | 'base' | 'slow'> = 'base') {
  const tokens = readMotionTokens()
  return { duration: tokens[tier], ease: tokens.ease }
}
