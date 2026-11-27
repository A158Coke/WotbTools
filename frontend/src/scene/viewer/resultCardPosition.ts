export interface ResultCardRect { left: number, top: number, right: number, bottom: number }

export function chooseResultCardPosition(input: {
    clickX: number
    clickY: number
    width: number
    height: number
    viewportWidth: number
    viewportHeight: number
    panels: readonly ResultCardRect[]
    gap?: number
    anchorGap?: number
    anchorGapY?: number
    pad?: number
}): { left: number, top: number } {
    const gap = input.gap ?? 14
    const anchorGap = input.anchorGap ?? gap
    const anchorGapY = input.anchorGapY ?? anchorGap
    const pad = input.pad ?? 8
    const { clickX: cx, clickY: cy, width: w, height: h } = input
    const clampX = (value: number): number => Math.min(Math.max(pad, value), Math.max(pad, input.viewportWidth - w - pad))
    const clampY = (value: number): number => Math.min(Math.max(pad, value), Math.max(pad, input.viewportHeight - h - pad))
    const hitsPanel = (x: number, y: number): boolean => input.panels.some(panel =>
        x + w > panel.left && x < panel.right && y + h > panel.top && y < panel.bottom)

    const tested = new Set<string>()
    const accept = (rawX: number, rawY: number, requireUnclamped = false): { left: number, top: number } | null => {
        const x = clampX(rawX)
        const y = clampY(rawY)
        if (requireUnclamped && (x !== rawX || y !== rawY)) return null
        const key = `${x},${y}`
        if (tested.has(key)) return null
        tested.add(key)
        return hitsPanel(x, y) ? null : { left: Math.round(x), top: Math.round(y) }
    }

    for (const [x, y] of [
        [cx + anchorGap, cy + anchorGapY],
        [cx + anchorGap, cy - h - anchorGapY],
        [cx - w - anchorGap, cy + anchorGapY],
        [cx - w - anchorGap, cy - h - anchorGapY],
        [cx - w / 2, cy - h - anchorGapY],
        [cx - w / 2, cy + anchorGapY],
    ] as Array<[number, number]>) {
        const hit = accept(x, y, true)
        if (hit) return hit
    }

    const xs = new Set<number>([pad, input.viewportWidth - w - pad])
    const ys = new Set<number>([pad, input.viewportHeight - h - pad])
    for (const panel of input.panels) {
        xs.add(panel.right + gap)
        xs.add(panel.right)
        xs.add(panel.left - w - gap)
        xs.add(panel.left - w)
        ys.add(panel.bottom + gap)
        ys.add(panel.bottom)
        ys.add(panel.top - h - gap)
        ys.add(panel.top - h)
    }
    const cross: Array<[number, number, number]> = []
    for (const x of xs) {
        for (const y of ys) {
            cross.push([Math.abs(x - cx) + Math.abs(y - cy), y, x])
        }
    }
    cross.sort((a, b) => a[0] - b[0] || a[1] - b[1] || a[2] - b[2])
    for (const [, y, x] of cross) {
        const hit = accept(x, y)
        if (hit) return hit
    }

    const maxStep = Math.ceil(Math.max(
        input.viewportWidth / anchorGap,
        input.viewportHeight / anchorGapY,
    )) + 1
    const offsets: Array<[number, number, number]> = []
    for (let sx = -maxStep; sx <= maxStep; sx++) {
        for (let sy = -maxStep; sy <= maxStep; sy++) {
            offsets.push([Math.abs(sx) + Math.abs(sy), sy * anchorGapY, sx * anchorGap])
        }
    }
    offsets.sort((a, b) => a[0] - b[0] || a[1] - b[1] || a[2] - b[2])
    for (const [, dy, dx] of offsets) {
        const hit = accept(cx + dx, cy + dy)
        if (hit) return hit
    }
    return { left: Math.round(clampX(cx + anchorGap)), top: Math.round(clampY(cy + anchorGapY)) }
}
