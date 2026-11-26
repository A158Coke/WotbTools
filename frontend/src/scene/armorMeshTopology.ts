import type { BufferAttribute, BufferGeometry, InterleavedBufferAttribute } from 'three'

const _cache = new WeakMap<BufferGeometry, boolean>()
const QUANTIZE = 1e5

type PositionAttribute = BufferAttribute | InterleavedBufferAttribute

function vertexKey(position: PositionAttribute, index: number): string {
    return `${Math.round(position.getX(index) * QUANTIZE)},${Math.round(position.getY(index) * QUANTIZE)},${Math.round(position.getZ(index) * QUANTIZE)}`
}

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


export function spacedDedupKey(
    armorSectionOrig: unknown,
    armorSection: unknown,
    armorPlateId: unknown,
): string {
    const orig = (typeof armorSectionOrig === 'string' && armorSectionOrig) || (typeof armorSection === 'string' && armorSection) || ''
    return `${orig}:${armorPlateId == null ? '' : String(armorPlateId)}`
}

export interface SpacedHitView {
    spaced: boolean
    backface: boolean
    key: string
}

export function resolveSpacedHitMask(hits: readonly SpacedHitView[], spanEnd: number = hits.length): boolean[] {
    const end = Math.max(0, Math.min(hits.length, spanEnd))
    const frontKeys = new Set<string>()
    for (let i = 0; i < end; i++) {
        const hit = hits[i]
        if (hit.spaced && !hit.backface) frontKeys.add(hit.key)
    }
    const keep = new Array<boolean>(hits.length)
    for (let i = 0; i < hits.length; i++) {
        if (i >= end) { keep[i] = true; continue }
        const hit = hits[i]
        keep[i] = !hit.backface || (hit.spaced && !frontKeys.has(hit.key))
    }
    return keep
}

export function firstPhysicalHit(hits: readonly SpacedHitView[]): number {
    for (let i = 0; i < hits.length; i++) {
        const hit = hits[i]
        if (!hit.backface || hit.spaced) return i
    }
    return -1
}

export const SPACED_STENCIL_BIT_LIMIT = 8

export interface SpacedStencilBits {
    bits: Map<string, number>
    overflow: boolean
}

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
