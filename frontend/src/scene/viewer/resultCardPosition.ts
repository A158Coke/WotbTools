/**
 * 结果卡定位（纯函数，唯一 owner）：卡片跟随锚点（点击坐标或世界命中点的屏幕投影），
 * 并在确认无遮挡的位置里取 **离锚点最近**的。厚度模式点选卡（#click-info）与判定结果卡
 * （#traj-info）共用同一套几何排布——两处卡片位置语义一致，不再各写一套。
 * 2026-11-16 起 #traj-info 的锚点是相机逐帧重投影的世界命中点（见 resultCardAnchor.ts）。
 *
 * 搜索面 = 面板边缘与容器边界构造的 **X/Y 候选交叉积**（评审要求：单轴贴边与固定步长
 * 网格都无法覆盖“需要同时调整横纵坐标”的空位）。候选类别：
 *  - 点击点附近：四象限偏移 + 正上 / 正下；
 *  - 容器边界：pad、viewport - card - pad；
 *  - 每个面板四条边：留缝（±gap）与**无缝**（贴合）两档 —— 无缝档是必要的：
 *    两个面板之间恰好留出卡片宽度时，唯一可行位就是右沿贴左面板、左沿贴右面板。
 * 排序按到点击点的曼哈顿距离升序（几何距离，不是统计打分），同距离按 (y, x) 固定序。
 * 交叉积全部被占时退到由近及远网格（gap 步长）兜底，仍无解才用首个钳制位
 * （读数优先于美观，正常布局不会走到）。
 */
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
    pad?: number
}): { left: number, top: number } {
    const gap = input.gap ?? 14
    const pad = input.pad ?? 8
    const { clickX: cx, clickY: cy, width: w, height: h } = input
    const clampX = (value: number): number => Math.min(Math.max(pad, value), Math.max(pad, input.viewportWidth - w - pad))
    const clampY = (value: number): number => Math.min(Math.max(pad, value), Math.max(pad, input.viewportHeight - h - pad))
    const hitsPanel = (x: number, y: number): boolean => input.panels.some(panel =>
        x + w > panel.left && x < panel.right && y + h > panel.top && y < panel.bottom)

    const tested = new Set<string>()
    const accept = (rawX: number, rawY: number): { left: number, top: number } | null => {
        const x = clampX(rawX)
        const y = clampY(rawY)
        const key = `${x},${y}`
        if (tested.has(key)) return null
        tested.add(key)
        return hitsPanel(x, y) ? null : { left: Math.round(x), top: Math.round(y) }
    }

    // 1) 点击点附近（最近优先）
    for (const [x, y] of [
        [cx + gap, cy + gap],
        [cx + gap, cy - h - gap],
        [cx - w - gap, cy + gap],
        [cx - w - gap, cy - h - gap],
        [cx - w / 2, cy - h - gap],
        [cx - w / 2, cy + gap],
    ] as Array<[number, number]>) {
        const hit = accept(x, y)
        if (hit) return hit
    }

    // 2) 面板边缘 × 容器边界的 X/Y 交叉积
    const xs = new Set<number>([pad, input.viewportWidth - w - pad])
    const ys = new Set<number>([pad, input.viewportHeight - h - pad])
    for (const panel of input.panels) {
        xs.add(panel.right + gap)
        xs.add(panel.right)                 // 无缝：卡片左沿贴面板右沿
        xs.add(panel.left - w - gap)
        xs.add(panel.left - w)              // 无缝：卡片右沿贴面板左沿
        ys.add(panel.bottom + gap)
        ys.add(panel.bottom)                // 无缝：卡片上沿贴面板下沿
        ys.add(panel.top - h - gap)
        ys.add(panel.top - h)               // 无缝：卡片下沿贴面板上沿
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

    // 3) 兜底：由近及远网格（自由区域里不在任何面板边缘上的空位）
    const maxStep = Math.ceil(Math.max(input.viewportWidth, input.viewportHeight) / gap) + 1
    const offsets: Array<[number, number, number]> = []
    for (let sx = -maxStep; sx <= maxStep; sx++) {
        for (let sy = -maxStep; sy <= maxStep; sy++) {
            offsets.push([Math.abs(sx) + Math.abs(sy), sy * gap, sx * gap])
        }
    }
    offsets.sort((a, b) => a[0] - b[0] || a[1] - b[1] || a[2] - b[2])
    for (const [, dy, dx] of offsets) {
        const hit = accept(cx + dx, cy + dy)
        if (hit) return hit
    }
    // 4) 回退：首个钳制位
    return { left: Math.round(clampX(cx + gap)), top: Math.round(clampY(cy + gap)) }
}
