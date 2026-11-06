/**
 * 间隙甲网格拓扑判定：闭合网格（每条边恰有两个相邻三角形）在双面 additive
 * 渲染下会把正、背两个表面各累计一次厚度；开放面片只有一个表面，从背面看必须
 * 双面渲染才可见。这里按几何结构（不是内容统计）给渲染侧选面提供权威标记。
 *
 * 顶点按 1e-5 m 量化后焊接：glTF 导出会复制顶点（法线/UV 接缝），只有位置相同
 * 才算同一条边。
 */
import type { BufferAttribute, BufferGeometry, InterleavedBufferAttribute } from 'three'

const _cache = new WeakMap<BufferGeometry, boolean>()
const QUANTIZE = 1e5

type PositionAttribute = BufferAttribute | InterleavedBufferAttribute

function vertexKey(position: PositionAttribute, index: number): string {
    return `${Math.round(position.getX(index) * QUANTIZE)},${Math.round(position.getY(index) * QUANTIZE)},${Math.round(position.getZ(index) * QUANTIZE)}`
}

/** 闭合流形 → true；开放面片 / 空几何 / 非流形 → false（按开放面处理，双面可见）。 */
export function isClosedSurfaceGeometry(geometry: BufferGeometry | null | undefined): boolean {
    if (!geometry) return false
    const cached = _cache.get(geometry)
    if (cached !== undefined) return cached

    const position = geometry.attributes && geometry.attributes.position as PositionAttribute | undefined
    const index = geometry.index
    const vertexCount = index ? index.count : (position ? position.count : 0)
    if (!position || vertexCount < 3) {
        _cache.set(geometry, false)
        return false
    }

    const edges = new Map<string, number>()
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

// ===== 厚度通道同板去重键位（开放壳体入/出双面重复计厚的修复，2026-11-06）=====
// 语义权威 = 点击判定链 collectJudgmentHits 的 spacedSeen：同键（armorSectionOrig:plateId）
// 的间隙板背面命中只计一次。开放壳体（如炮盾）的出射面绕序朝外、属同一块板——
// thickness RT 对该板必须按"入射面计一次、同键更深的穿越面抑制"累计，而不是把
// 出射面当成第二块板。GPU 侧用 per-key stencil 位实现：front 面写位、back 面测位。

/** 去重键：与 collectJudgmentHits 的 `origSection:plateId` 同粒度（同 plate 拆多网格时共享一位）。 */
export function spacedDedupKey(
    armorSectionOrig: unknown,
    armorSection: unknown,
    armorPlateId: unknown,
): string {
    const orig = (typeof armorSectionOrig === 'string' && armorSectionOrig) || (typeof armorSection === 'string' && armorSection) || ''
    return `${orig}:${armorPlateId == null ? '' : String(armorPlateId)}`
}

/** WebGL 保证的 stencil 位宽下界（WebGLRenderTarget stencilBuffer:true → ≥8 位）。 */
export const SPACED_STENCIL_BIT_LIMIT = 8

export interface SpacedStencilBits {
    /** 键 → 位掩码（0x01..0x80），按首次出现顺序分配。 */
    bits: Map<string, number>
    /** 键数超位宽 → true；调用方必须整车回退现行双面累计并显式报告（fail-closed，不做逐网格半修）。 */
    overflow: boolean
}

/**
 * 给去重键分配 stencil 位。同键多网格共享同一位（与点击链键级去重一致）；
 * 键数 > 8 时 overflow=true，返回已分配的前缀但消费方不得使用。
 */
export function assignSpacedStencilBits(dedupKeys: readonly string[]): SpacedStencilBits {
    const bits = new Map<string, number>()
    let next = 1
    for (const key of dedupKeys) {
        if (bits.has(key)) continue
        if (bits.size >= SPACED_STENCIL_BIT_LIMIT) {
            return { bits, overflow: true }
        }
        bits.set(key, next)
        next <<= 1
    }
    return { bits, overflow: false }
}
