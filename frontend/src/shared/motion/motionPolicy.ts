// motion-v 的唯一配置入口：时长与缓动从 design-language 的 CSS token 读取，CSS 仍是 motion policy 的唯一来源。
// prefers-reduced-motion 时 token 本身归零（scale.css），这里只消费，不建立独立偏好。
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

/** 读取当前生效的 motion token（秒）。无 DOM（SSR / 测试）时返回 0 时长，即不产生动画。 */
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

/** 某一档时长对应的 motion-v transition；调用时读取 token，随 reduced-motion 变化。 */
export function motionTransition(tier: keyof Pick<MotionTokens, 'fast' | 'base' | 'slow'> = 'base') {
  const tokens = readMotionTokens()
  return { duration: tokens[tier], ease: tokens.ease }
}
