type Point = number[] | { x: number; y: number; z: number }
type Hit<P extends Point = number[]> = { section: string; thickness: number; normal: P; point: P; plate_id?: string | number; plateId?: string | number; part_name?: string; partName?: string; distance: number; contact_normal?: P; contact_point?: P; contact_thickness?: number; contact_part_name?: string | null }
type GeometryContext = { view: number[]; caliber: number; thicknessCoeff: number; ricochet_deg: number; normalization_deg: number; layerIndex: number; allowRicochet: boolean; isHeat: boolean }
/**
 * 统一击穿判定（客户端移植）：上游 src/wargaming/penetration.rs `calculate()` 的
 * 逐行 JS 移植，语义单点对齐 BlitzKit SpacedArmorSceneComponent shoot()——跳弹/
 * 转正/overmatch/多层消耗/外部模块 flat 抵消/HE 特殊/HEAT 间隙衰减（含 gap 层记录）/
 * 末层状态决定结果与伤害归属。基础穿深 = near × 装备系数；可选距离衰减
 * （distance_m + penetration_far：d>100m 起 400m 区间线性到 far，HE 豁免）对齐
 * 客户端装甲指示器 0x719740（证据链见上游 Agent 仓 investigation/...md §8.7）。
 * HEAT 间隙衰减系数 0.5 为项目裁定（客户端 shells.xml 的 0.05 系数据错误，见 gap
 * 分支注释）。
 *
 * 为什么客户端判定：装甲查看器/射击复现数据面是纯静态资产（静态资产契约），无 Agent
 * 服务端可 POST /api/penetrate；判定输入（板厚/法线/口径/弹参）全部来自静态 tank
 * JSON 与 raycast，纯数学无副作用——随消费端移动是架构既定方向（Agent Rust Core
 * 负责解析，WotBTools 负责消费/编排）。不变量由 penetration.*.test.js 锁定（上游
 * Rust 单测 12 例逐例对齐），上游判定变更时同版本跟随移植。
 */

/** 装甲部件分类（对齐 BlitzKit ArmorType：Primary / Spaced / External；值 = 上游 serde wire 值） */
export const ArmorSection = Object.freeze({
  HULL: 'hull',
  TURRET: 'turret',
  /** 炮盾装甲板：BlitzKit 归 Primary（角度等效分支），非外部模块 */
  GUN: 'gun',
  /** 间隙甲 Spaced：角度等效（可跳弹/转正），收集阶段不终止遍历 */
  SPACED: 'spaced',
  /** 外部模块 External（BlitzKit variant="track"，左右履带/负重轮共用） */
  CHASSIS: 'chassis',
  /** 外部模块 External（BlitzKit variant="gun"，炮管本体） */
  GUN_BARREL: 'gunBarrel',
})

/**
 * 弹种 icon 词表（唯一事实源）：`type`/`shell_type` 显示令牌 → 判定弹种
 * （tanks.pb 原始串：hc 与 hc_premium=HEAT、ap_cr 系=APCR、ap_premium=AP、he_premium=HE）。
 * `parseShellType`（判定链，未知兜底 'he'）与 `viewer/armorPlateModel.shellTypeOf`
 * （查看器，未知返回 null fail-closed）共用本表；新增 token 只改这里。
 *
 * 必须是**无原型对象**（Object.create(null)）：普通对象查表会把 `constructor` /
 * `__proto__` / `toString` 等原型属性当成命中（真值），绕过两条链的未知值兜底
 * （review P2，2026-11-06）。Object.freeze 不会移除原型链。
 */
export const SHELL_TOKEN_KIND = Object.freeze(Object.assign(Object.create(null), {
  ap: 'ap', ap_premium: 'ap',
  apcr: 'apcr', ap_cr: 'apcr', ap_cr_premium: 'apcr',
  he: 'he', he_premium: 'he', hesh: 'he', hesh_premium: 'he',
  heat: 'heat', hc: 'heat', hc_premium: 'heat', atgm_heat: 'heat',
}))

/**
 * 弹种解析：**field9 枚举优先**（权威，0=AP/1=APCR/2=HEAT/3=HE），其次 icon 串词表。
 *
 * field9 来自上游 tank 数据的 `type_id`（客户端 `<kind>` 语义枚举的翻译，4 值闭集）；
 * `type`/`shell_type` 是 field7 的 icon 显示令牌，词表（SHELL_TOKEN_KIND）是手工归纳的、
 * 客户端可自由新增变体（`atgm_heat` 就是曾经漏掉的一个）。有 id 就绝不看词表。
 * 未知串仍兜底 `'he'`——这是最后手段，不是判定依据。
 */
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
// BlitzKit isExplosive()：HEAT 与 HE 都算 → 跳弹角强制 90°（永不跳弹）
export const isExplosiveType = (shell: string) => shell === 'heat' || shell === 'he'
// 外部模块（BlitzKit External）：flat 抵消，无角度/转正/跳弹
export const isModule = (section: unknown) => section === ArmorSection.CHASSIS || section === ArmorSection.GUN_BARREL

// 主装甲 Primary（hull/turret/炮盾板）：收集阶段 push 后立即停止。
// 同时是【点击判定的触发面】：BlitzKit 的 shoot() 只挂在 Primary 网格的 onClick 上
// （spaced/外部模块网格挂的是空 handler，只为进入 event.intersections）——射线未触达
// Primary 时不发起判定。查看器相机点击路径据此过滤，勿在别处复制这份分类（唯一事实源）。
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
  // 必须先走与判定相同的命中收集：同一网格的重合三角形在 collectFilteredHits
  // 中已被合并，直接索引未过滤的原始命中会把后续层错配到重复三角形的位置。
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
// BlitzKit 外部模块按 variant 去重（"gun" | "track"），而非逐板 ID；spaced/primary 不参与
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

/**
 * HEAT 间隙衰减的间距原点：同板去重会删掉近侧的出射面/入射面，但间距必须从首个
 * 物理接触面量起（GPU 以最近屏幕深度为原点），否则层的 point 前移后 gap 变短、
 * 衰减被低估。首层之前存在被删掉的物理接触面时，返回「首层点位换成接触面点位」的
 * 新数组（其余命中与顺序不变、不改输入）；否则原样返回输入。
 * 与首层重合的命中（共享边/对角线）一起搬：保持 collectFilteredHits 的
 * 重合三角形合并语义，避免同一块板被当成两层。
 * Node 脚本通过 penetration.js 外观加载；仓库固定的 Node 版本支持直接加载 TypeScript。
 */
/**
 * 首层跳弹/续飞几何取物理首触面：同板去重删掉近侧命中后，首层的命中角/跳弹判定仍须
 * 按射线实际先碰到的那个面（GPU：厚度通道累计保留的 front 片元、状态通道按最近面判
 * 跳弹）。因此**不改**首层的 normal/thickness/point（厚度链几何保持 GPU 厚度通道口径），
 * 只把首触面的法线与点位作为 `contact_normal` / `contact_point` 附在首层命中上：
 * - `resolveLayerGeometry` 只把 `contact_normal` 用于跳弹判定（厚度/转正/角度显示仍用 normal）；
 * - `ricochetSurface` 让续飞从该物理接触点/面发射；HEAT 的间隙原点另由 withGapOrigin 处理。
 * 首触面在首层之前即可附加（不要求同键）：中间夹着别的板时，物理跳弹仍发生在首触面上。
 * 这两个字段是客户端本地扩展（`judgePenetration` 直接调用本模块），不进上游 wire 请求。
 */
export function withContactRicochet<T extends Hit<Point>>(hits: T[], contact: T | null | undefined) {
  if (!contact || hits.length === 0) return hits
  if (!(contact.distance < hits[0].distance)) return hits
  const [first, ...rest] = hits
  return [{
    ...first,
    contact_normal: contact.normal,
    contact_point: contact.point,
    // 首触板自己的厚度：3× 口径规则（overmatch 抑制跳弹）必须按它判，而不是首层保留板。
    contact_thickness: contact.thickness,
    // 首触板身份：跳弹层的结果卡要报「哪块板跳的」，而不是首层保留板（可能是前方模块）。
    contact_part_name: contact.partName || contact.part_name || null,
  }, ...rest]
}

/**
 * 跳弹/续飞的发射面：优先物理首触面（`contact_*`），否则用该层自己的点/法线。
 * 返回的对象与命中同形（point/normal），供轨迹与反射射线使用。
 */
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

/**
 * 收集阶段：外部模块按 variant 去重；确定性判定与概率链都只收集到**首个 Primary
 * （含）**——与 BlitzKit shoot() 的末层语义一致。概率链不再因某层未穿透而在收集
 * 阶段截断（那发生在判定循环），但也不得越过首个 Primary 继续收集其后的车体底板/
 * 履带：那些命中与本次装甲交火无关，会把补充概率压成 0（2026-10-18 Super
 * Conqueror 炮塔点击：19% vs 0% 的相邻位置差异）。
 */
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
      // 同一网格的重合三角形（射线掠过四边形对角线时）是同一层，不是两层。
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

/**
 * 物理首触面的跳弹几何（contact_normal / contact_point / contact_thickness）：
 * 同板去重删掉近侧命中后，跳弹仍按射线实际先碰到的面判。厚度先乘装备系数
 * （enhanced_armor 1.04）再判 3× 口径，与普通厚度路径同源——否则同一块板会因
 * 是否触发去重而得到不同的 overmatch/跳弹结果。无 contact_normal 时返回 null。
 */
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

/**
 * 单层几何（确定性与概率链共用）：外部模块 flat；实际装甲算入射角、3×/2×
 * 口径规则、逐层转正与等效厚度。概率链只需要几何量，不读取剩余穿深。
 * 转正按 BlitzKit shoot() 对**每个非外部层**独立计算（不继承首层状态）。
 * 外部模块层不跳弹，但**首触面**可能在其前方的间隙板上：此时模块层承载
 * contact_* 并按首触面判跳弹（否则模块首层会吞掉物理跳弹）。
 */
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
  // 跳弹判定按物理首触面：同板去重删掉近侧命中后，`contact_normal` 记录射线实际先
  // 碰到的面；厚度/转正/角度显示仍用保留层的 normal（GPU 厚度通道口径）。
  const contact = contactRicochetGeometry(ah, ctx)
  const ricochetAngleDeg = contact ? contact.angle_deg : angleDeg
  const threeCalibersRule = ctx.caliber > thickness * 3.0
  // 跳弹的 3× 口径规则按**首触板**判（厚度已乘装备系数）：首层保留板的厚度可能与
  // 首触板不同（中间夹着别的板）。
  const noRicochet = (contact ? contact.three_calibers : threeCalibersRule)
    || ctx.layerIndex > 0 || !ctx.allowRicochet
  const twoCalibersRule = ctx.caliber > thickness * 2.0
  // 0mm 是合法的 fail-closed 板厚：2× 公式在 thickness=0 时会 0/0，只对正厚度应用。
  const normalization = twoCalibersRule && thickness > 0.0
    ? (1.4 * ctx.normalization_deg * ctx.caliber) / (2.0 * thickness)
    : ctx.normalization_deg
  // BlitzKit：每个非外部层都用自身 thickness/angle 重新套用转正；外部模块是
  // flat 消耗，不参与 normalization，也不消耗后续层的转正资格。
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

/**
 * 概率链：遍历到首个 Primary（含）的**全部**层，包含确定性判定会因某层未穿透而
 * 提前截断的后续层；不包含首个 Primary 之后的车体/履带命中。外部模块保留 flat
 * 标记；HEAT 层间插入 gap 描述（距离），供概率区间按 penetration.js 的同一
 * 0.5/m 衰减处理。
 */
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

