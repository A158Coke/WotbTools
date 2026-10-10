export interface GuideRect { left: number; top: number; width: number; height: number }

/** Clip real target geometry to the currently visible viewport, including browser zoom. */
export function guideCutout(rect: GuideRect, viewport: GuideRect, padding: number): GuideRect | null {
  const left = Math.max(viewport.left, rect.left - padding)
  const top = Math.max(viewport.top, rect.top - padding)
  const right = Math.min(viewport.left + viewport.width, rect.left + rect.width + padding)
  const bottom = Math.min(viewport.top + viewport.height, rect.top + rect.height + padding)
  if (rect.width <= 0 || rect.height <= 0 || right <= left || bottom <= top) return null
  return { left, top, width: right - left, height: bottom - top }
}

/** Keep the card away from the real control whenever there is usable room. */
export function guideCardPosition(target: GuideRect | null, viewport: GuideRect, card: { width: number; height: number }, gap: number, compact: boolean) {
  const width = Math.min(card.width, Math.max(0, viewport.width - gap * 2))
  const height = Math.min(card.height, Math.max(0, viewport.height - gap * 2))
  const maxHeight = Math.max(0, viewport.height - gap * 2)
  const clampX = (x: number) => Math.max(viewport.left + gap, Math.min(x, viewport.left + viewport.width - width - gap))
  const clampY = (y: number) => Math.max(viewport.top + gap, Math.min(y, viewport.top + viewport.height - height - gap))
  if (compact || !target) {
    let top = clampY(viewport.top + viewport.height - height - gap)
    // Fullscreen phone controls can sit at the bottom without any page scroll available.
    if (target && target.top < top + height && target.top + target.height > top) {
      const above = Math.max(0, target.top - viewport.top - gap * 2)
      const below = Math.max(0, viewport.top + viewport.height - target.top - target.height - gap * 2)
      // Keep a usable header/actions region; long copy scrolls within the remaining space.
      if (above >= below && above >= gap * 8) return { left: clampX(viewport.left + (viewport.width - width) / 2), top: target.top - gap - Math.min(height, above), width, maxHeight: above }
      if (below >= gap * 8) return { left: clampX(viewport.left + (viewport.width - width) / 2), top: target.top + target.height + gap, width, maxHeight: below }
    }
    return { left: clampX(viewport.left + (viewport.width - width) / 2), top, width, maxHeight }
  }
  if (target.left + target.width + gap + width <= viewport.left + viewport.width - gap) {
    return { left: target.left + target.width + gap, top: clampY(target.top), width, maxHeight }
  }
  if (target.left - gap - width >= viewport.left + gap) return { left: target.left - gap - width, top: clampY(target.top), width, maxHeight }
  if (target.top + target.height + gap + height <= viewport.top + viewport.height - gap) {
    return { left: clampX(target.left), top: target.top + target.height + gap, width, maxHeight }
  }
  return { left: clampX(target.left), top: clampY(target.top - height - gap), width, maxHeight }
}

export function guideMasks(cutout: GuideRect | null, viewport: GuideRect): GuideRect[] {
  if (!cutout) return [viewport]
  return [
    { left: viewport.left, top: viewport.top, width: viewport.width, height: cutout.top - viewport.top },
    { left: viewport.left, top: cutout.top + cutout.height, width: viewport.width, height: viewport.top + viewport.height - cutout.top - cutout.height },
    { left: viewport.left, top: cutout.top, width: cutout.left - viewport.left, height: cutout.height },
    { left: cutout.left + cutout.width, top: cutout.top, width: viewport.left + viewport.width - cutout.left - cutout.width, height: cutout.height },
  ].filter(rect => rect.width > 0 && rect.height > 0)
}
