type Point = number[] | { x: number; y: number; z: number }
type Hit<P extends Point = number[]> = { section: string; thickness: number; normal: P; point: P; plate_id?: string | number; plateId?: string | number; part_name?: string; partName?: string; distance: number; contact_normal?: P; contact_point?: P; contact_thickness?: number; contact_part_name?: string | null }
type GeometryContext = { view: number[]; caliber: number; thicknessCoeff: number; ricochet_deg: number; normalization_deg: number; layerIndex: number; allowRicochet: boolean; isHeat: boolean }

export const ArmorSection = Object.freeze({
  HULL: 'hull',
  TURRET: 'turret',
  GUN: 'gun',
  SPACED: 'spaced',
  CHASSIS: 'chassis',
  GUN_BARREL: 'gunBarrel',
})

export const SHELL_TOKEN_KIND = Object.freeze(Object.assign(Object.create(null), {
  ap: 'ap', ap_premium: 'ap',
  apcr: 'apcr', ap_cr: 'apcr', ap_cr_premium: 'apcr',
  he: 'he', he_premium: 'he', hesh: 'he', hesh_premium: 'he',
  heat: 'heat', hc: 'heat', hc_premium: 'heat', atgm_heat: 'heat',
}))

export function parseShellType(s: unknown, id?: unknown) {
  if (typeof id === 'number') {
    if (id === 0) return 'ap'
    if (id === 1) return 'apcr'
    if (id === 2) return 'heat'
    if (id === 3) return 'he'
  }
  return SHELL_TOKEN_KIND[String(s || '').toLowerCase()] || 'he'
}

export const isKinetic = (shell: string) => shell === 'ap' || shell === 'apcr'
export const isExplosive = (shell: string) => shell === 'he'
export const isExplosiveType = (shell: string) => shell === 'heat' || shell === 'he'
export const isModule = (section: unknown) => section === ArmorSection.CHASSIS || section === ArmorSection.GUN_BARREL

export const isPrimary = (section: unknown) => section === ArmorSection.HULL || section === ArmorSection.TURRET || section === ArmorSection.GUN

/**
 * 概率卡的前置条件：链上存在 Primary 层。
 * 0mm 是合法的 fail-closed 板厚（与 10mm 板同一处理方式）：它仍然是 Primary，
 * 只是等效厚度为 0，不因为它没有正厚度而走另一套卡面语义。
 * 只有外部模块（履带/炮管）而没有 Primary 的射线不构成概率判定——把模块的
 * flat 消耗当成“剩余区间仍大于 0”会让纯外部命中显示成必穿全额伤害。
 *
 * @param {Array<object>} layers probability_layers / trajLayers
 * @returns {boolean}
 */
export function hasPrimaryLayer(layers: Array<{ [key: string]: unknown; section?: unknown }> | null | undefined) {
  return Array.isArray(layers) && layers.some(layer => isPrimary(layer?.section))
}

/**
 * 把判定层链按**命中次序**匹配回 hitsForCheck：同名装甲板可能被射线打穿两次
 * （collectFilteredHits 有意保留为两个非重合层），按 partName 查找第一个会把
 * 两个轨迹点都放到第一块板上。gap 层没有对应 hit，返回 null 由调用方借用
 * 相邻层；未匹配的层同样返回 null。
 *
 * @param {Array<object>} layers 判定层链（part_name）
 * @param {Array<object>} hits 与判定同源的命中链（partName）
 * @returns {Array<object|null>}
 */
export function matchHitsByOccurrence<T extends Hit<Point>>(layers: Array<{ part_name?: string }> | null | undefined, hits: T[] | null | undefined) {
  const chain = collectFilteredHits(hits || [])
  const used = new Array(chain.length).fill(false)
  return (layers || []).map(layer => {
    const name = layer?.part_name
    if (typeof name !== 'string' || !name) return null
    for (let i = 0; i < chain.length; i++) {
      if (!used[i] && hitNameOf(chain[i]) === name) {
        used[i] = true
        return chain[i]
      }
    }
    return null
  })
}
function moduleVariant(section: unknown) {
  if (section === ArmorSection.CHASSIS) return 'track'
  if (section === ArmorSection.GUN_BARREL) return 'gun'
  return null
}

const plateIdOf = (hit: Hit<Point>) => hit.plate_id ?? hit.plateId
const hitNameOf = (hit: Hit<Point>) => hit.partName ?? hit.part_name
const pointsCoincide = (a: Point, b: Point) => {
  if (Array.isArray(a) && Array.isArray(b)) return dist3(a, b) < 1e-6
  const av = a as { x: number; y: number; z: number }, bv = b as { x: number; y: number; z: number }
  if (a && b && [av.x, av.y, av.z, bv.x, bv.y, bv.z].every(Number.isFinite)) {
    return Math.hypot(av.x - bv.x, av.y - bv.y, av.z - bv.z) < 1e-6
  }
  return false
}

export function withContactRicochet<T extends Hit<Point>>(hits: T[], contact: T | null | undefined) {
  if (!contact || hits.length === 0) return hits
  if (!(contact.distance < hits[0].distance)) return hits
  const [first, ...rest] = hits
  return [{
    ...first,
    contact_normal: contact.normal,
    contact_point: contact.point,
    contact_thickness: contact.thickness,
    contact_part_name: contact.partName || contact.part_name || null,
  }, ...rest]
}

export function ricochetSurface<P extends Point>(hit: Hit<P> | null | undefined) {
  if (!hit) return null
  return {
    point: hit.contact_point || hit.point,
    normal: hit.contact_normal || hit.normal,
  }
}

export function withGapOrigin<T extends Hit<Point>>(hits: T[], contact: T | null | undefined) {
  if (!contact || hits.length === 0) return hits
  if (!(contact.distance < hits[0].distance)) return hits
  const origin = hits[0].point
  return hits.map((hit) => (
    pointsCoincide(hit.point, origin) ? { ...hit, point: contact.point } : hit
  ))
}

export function collectFilteredHits<T extends Hit<Point>>(hits: T[]) {
  const seenVariants = new Set()
  const filteredHits = []
  for (const ah of hits) {
    if (isModule(ah.section)) {
      const variant = moduleVariant(ah.section)
      if (variant && !seenVariants.has(variant)) {
        seenVariants.add(variant)
        filteredHits.push(ah)
      }
    } else {
      const prev = filteredHits[filteredHits.length - 1]
      const prevId = prev ? plateIdOf(prev) : null
      const id = plateIdOf(ah)
      const samePlate = prev && prev.section === ah.section
        && (id == null || prevId == null || String(id) === String(prevId))
        && pointsCoincide(ah.point, prev.point)
      if (samePlate) continue
      filteredHits.push(ah)
      if (isPrimary(ah.section)) break
    }
  }
  return filteredHits
}

function contactRicochetGeometry(ah: Hit, ctx: GeometryContext) {
  if (!ah.contact_normal) return null
  const coeff = Number.isFinite(ctx.thicknessCoeff) ? ctx.thicknessCoeff : 1.0
  const raw = ah.contact_thickness != null ? ah.contact_thickness : ah.thickness
  const thickness = raw * coeff
  const threeCalibers = ctx.caliber > thickness * 3.0
  const n = normalize(ah.contact_normal)
  const angleDeg = Math.acos(Math.min(Math.abs(dot(n, ctx.view)), 1.0)) / DEG
  return { thickness, three_calibers: threeCalibers, angle_deg: angleDeg, ricochet: angleDeg >= ctx.ricochet_deg }
}

export function resolveLayerGeometry(ah: Hit, thickness: number, ctx: GeometryContext) {
  if (isModule(ah.section)) {
    const contact = contactRicochetGeometry(ah, ctx)
    const noRicochet = ctx.layerIndex > 0 || !ctx.allowRicochet || (contact ? contact.three_calibers : true)
    const ricochet = !!contact && !noRicochet && contact.ricochet
    return {
      thickness,
      effective: thickness,
      external: true,
      angle_deg: null,
      ricochet,
      ricochet_angle_deg: contact ? contact.angle_deg : null,
      overmatch: false,
      normalization_deg: 0,
    }
  }
  const n = normalize(ah.normal)
  const cosA = Math.min(Math.abs(dot(n, ctx.view)), 1.0)
  const angleRad = Math.acos(cosA)
  const angleDeg = angleRad / DEG
  const contact = contactRicochetGeometry(ah, ctx)
  const ricochetAngleDeg = contact ? contact.angle_deg : angleDeg
  const threeCalibersRule = ctx.caliber > thickness * 3.0
  const noRicochet = (contact ? contact.three_calibers : threeCalibersRule)
    || ctx.layerIndex > 0 || !ctx.allowRicochet
  const twoCalibersRule = ctx.caliber > thickness * 2.0
  const normalization = twoCalibersRule && thickness > 0.0
    ? (1.4 * ctx.normalization_deg * ctx.caliber) / (2.0 * thickness)
    : ctx.normalization_deg
  const effNormalization = normalization
  const finalAngle = Math.max(angleRad - effNormalization * DEG, 0.0)
  const effective = thickness / Math.max(Math.cos(finalAngle), 1e-6)
  const ricochet = !noRicochet && ricochetAngleDeg >= ctx.ricochet_deg
  return {
    thickness,
    effective: ricochet ? 0.0 : effective,
    external: false,
    angle_deg: angleDeg,
    ricochet,
    ricochet_angle_deg: ricochetAngleDeg,
    overmatch: threeCalibersRule,
    normalization_deg: effNormalization,
  }
}

export function buildProbabilityLayers(filteredHits: Hit[], ctx: GeometryContext) {
  const layers = []
  for (let i = 0; i < filteredHits.length; i++) {
    const ah = filteredHits[i]
    if (ctx.isHeat && i > 0) {
      const distance = dist3(ah.point, filteredHits[i - 1].point)
      layers.push({
        part_name: `Gap ${distance.toFixed(2)}m`,
        section: 'gap',
        thickness: 0.0,
        effective: 0.0,
        gap: true,
        gap_distance: distance,
        angle_deg: null,
        external: false,
        ricochet: false,
        point: ah.point,
        normal: ah.normal,
      })
    }
    const thickness = ah.thickness * ctx.thicknessCoeff
    const geo = resolveLayerGeometry(ah, thickness, {
      ...ctx,
      layerIndex: i,
    })
    layers.push({
      part_name: ah.part_name,
      section: ah.section,
      thickness: geo.thickness,
      effective: geo.effective,
      angle_deg: geo.angle_deg,
      external: geo.external,
      ricochet: geo.ricochet,
      overmatch: geo.overmatch,
      gap: false,
      point: ah.point,
      normal: ah.normal,
      ...(geo.ricochet && ah.contact_normal ? {
        contact_part_name: ah.contact_part_name || null,
        contact_thickness: (ah.contact_thickness != null ? ah.contact_thickness : ah.thickness) * ctx.thicknessCoeff,
      } : {}),
    })
    if (geo.ricochet) break
  }
  return layers
}

export function dist3(a: number[], b: number[]) {
  const dx = a[0] - b[0]
  const dy = a[1] - b[1]
  const dz = a[2] - b[2]
  return Math.sqrt(dx * dx + dy * dy + dz * dz)
}

export function normalize(v: number[]) {
  const len = Math.sqrt(v[0] * v[0] + v[1] * v[1] + v[2] * v[2])
  return len > 0 ? [v[0] / len, v[1] / len, v[2] / len] : [0, 1, 0]
}

export function dot(a: number[], b: number[]) {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
}

export const DEG = Math.PI / 180
const HIT_SECTIONS = new Set<string>(Object.values(ArmorSection))

/**
 * 判定输入的结构完整性。缺 section / 板厚 NaN / 缺法线或命中点都会让后续几何
 * 静默失真（NaN 传染、按 0mm 板处理、拿 [0,1,0] 猜法线），必须在进入几何链之前
 * 返回结构化 ERROR，而不是崩溃或产出伪造数字。
 * @returns {string|null} 失败原因；null = 通过
 */
export function invalidHitReason(hits: Hit[]) {
  if (!Array.isArray(hits)) return 'hits-not-array'
  for (const h of hits) {
    if (!h || typeof h !== 'object') return 'invalid-hit'
    if (!HIT_SECTIONS.has(h.section)) return 'invalid-hit-section'
    if (!Number.isFinite(h.thickness) || h.thickness < 0) return 'invalid-hit-thickness'
    if (!Array.isArray(h.normal) || h.normal.length !== 3 || !h.normal.every(Number.isFinite)) {
      return 'missing-hit-normal'
    }
    if (!Array.isArray(h.point) || h.point.length !== 3 || !h.point.every(Number.isFinite)) {
      return 'invalid-hit-point'
    }
  }
  return null
}

