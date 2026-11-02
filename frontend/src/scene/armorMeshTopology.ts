/**
 * 间隙甲网格拓扑判定：闭合网格（每条边恰有两个相邻三角形）在双面 additive
 * 渲染下会把正、背两个表面各累计一次厚度；开放面片只有一个表面，从背面看必须
 * 双面渲染才可见。这里按几何结构（不是内容统计）给渲染侧选面提供权威标记。
 *
 * 顶点按 1e-5 m 量化后焊接：glTF 导出会复制顶点（法线/UV 接缝），只有位置相同
 * 才算同一条边。
 */
const _cache = new WeakMap()
const QUANTIZE = 1e5

function vertexKey(position, index) {
    return `${Math.round(position.getX(index) * QUANTIZE)},${Math.round(position.getY(index) * QUANTIZE)},${Math.round(position.getZ(index) * QUANTIZE)}`
}

/** 闭合流形 → true；开放面片 / 空几何 / 非流形 → false（按开放面处理，双面可见）。 */
export function isClosedSurfaceGeometry(geometry) {
    if (!geometry) return false
    const cached = _cache.get(geometry)
    if (cached !== undefined) return cached

    const position = geometry.attributes && geometry.attributes.position
    const index = geometry.index
    const vertexCount = index ? index.count : (position ? position.count : 0)
    if (!position || vertexCount < 3) {
        _cache.set(geometry, false)
        return false
    }

    const edges = new Map()
    let closed = true
    for (let i = 0; i + 2 < vertexCount; i += 3) {
        const a = index ? index.getX(i) : i
        const b = index ? index.getX(i + 1) : i + 1
        const c = index ? index.getX(i + 2) : i + 2
        const ka = vertexKey(position, a)
        const kb = vertexKey(position, b)
        const kc = vertexKey(position, c)
        // 退化三角形没有面积，不参与边计数。
        if (ka === kb || kb === kc || kc === ka) continue
        for (const [u, v] of [[ka, kb], [kb, kc], [kc, ka]]) {
            const key = u < v ? `${u}|${v}` : `${v}|${u}`
            edges.set(key, (edges.get(key) || 0) + 1)
        }
    }

    if (edges.size === 0) closed = false
    for (const count of edges.values()) {
        if (count !== 2) {
            closed = false
            break
        }
    }
    _cache.set(geometry, closed)
    return closed
}
