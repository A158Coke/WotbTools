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

// ===== 间隙甲同板去重（开放壳体入/出双面重复计厚的修复，2026-11-06）=====
// 厚度通道（GPU）与点击判定链（CPU）必须对同一块板给出同一个层数：
//   GPU：每个像素每个键由 front clone 写位、back clone 测位——有入射面片元时只计入射面，
//        没有入射面片元时计入所有出射面片元；与片元的深度先后无关。
//   CPU：collectJudgmentHits 用 resolveSpacedHitMask 采用同一判据（按整条射线的命中
//        集合判定，而不是"先遇到谁"），因此 back→front、front→back、back→back 顺序
//        都得到同一层数。

/** 去重键：与 collectJudgmentHits 的 `origSection:plateId` 同粒度（同 plate 拆多网格时共享一位）。 */
export function spacedDedupKey(
    armorSectionOrig: unknown,
    armorSection: unknown,
    armorPlateId: unknown,
): string {
    const orig = (typeof armorSectionOrig === 'string' && armorSectionOrig) || (typeof armorSection === 'string' && armorSection) || ''
    return `${orig}:${armorPlateId == null ? '' : String(armorPlateId)}`
}

/** 参与去重判定的命中视图（collectJudgmentHits 的经 classifyHit 结果投影）。 */
export interface SpacedHitView {
    /** 间隙甲命中（section === 'spaced'）；主装甲/外部模块命中不参与同键去重。 */
    spaced: boolean
    /** 背面命中（法线朝射线来向）。 */
    backface: boolean
    /** spacedDedupKey 给出的同板键。 */
    key: string
}

/**
 * 点击链同板去重掩码（与 GPU per-key stencil 同口径，顺序无关）：
 * - 非间隙甲背面命中一律剔除（主装甲/外部模块只认迎面命中）；
 * - 间隙甲同一键只要有入射面（!backface）命中，该键的出射面（backface）命中全部抑制；
 * - 该键没有入射面命中时，出射面命中全部计入（从背面看的单面屏照常计一次）。
 * 判据只看整条射线的命中集合，不依赖穿越顺序——GPU 的 stencil 位同样是按像素汇总，
 * 因此 back→front（近背远正）不会再让 CPU 多计一层。
 *
 * spanEnd：有效判定区间的长度（首个 Primary 的下标 + 1；无 Primary 时等于命中数）。
 * 区间外的命中不参与判定——`collectFilteredHits` 在首个 Primary 截断，GPU 侧主装甲
 * 深度先写、spaced 材质 depthTest 失败也不会计厚/写位。区间外的 front 因此不得抑制
 * 区间内的同键 back（`spaced back → Primary → 同键 front` 只剩那层背面）。
 */
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

/**
 * 首个物理接触面下标（厚度累计去重之前）——HE 的爆炸点契约。
 * 第一个「非背面命中」或「间隙甲背面命中」就是射线实际碰到的第一层表面（从背面看的
 * 单面屏本身即首触面）；主装甲/外部模块的背面命中是出射面，跳过。厚度累计的同板去重
 * 只改变层数，不得改变首触面；没有可用命中时返回 -1。
 */
export function firstPhysicalHit(hits: readonly SpacedHitView[]): number {
    for (let i = 0; i < hits.length; i++) {
        const hit = hits[i]
        if (!hit.backface || hit.spaced) return i
    }
    return -1
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
