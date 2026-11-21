/**
 * 弹种词表/解析与命中收集辅助（自 penetration.js 原样平移）： ArmorSection 分类、
 * SHELL_TOKEN_KIND 词表、parseShellType、命中层辅助（matchHitsByOccurrence /
 * withContactRicochet / ricochetSurface / withGapOrigin）与 collectFilteredHits 收集。
 * 数值行为与分类口径保持原样。本模块不 import penetration.js（避免环）。
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
export function parseShellType(s, id) {
  if (typeof id === 'number') {
    if (id === 0) return 'ap'
    if (id === 1) return 'apcr'
    if (id === 2) return 'heat'
    if (id === 3) return 'he'
  }
  return SHELL_TOKEN_KIND[String(s || '').toLowerCase()] || 'he'
}

export const isKinetic = (shell) => shell === 'ap' || shell === 'apcr'
export const isExplosive = (shell) => shell === 'he'
// BlitzKit isExplosive()：HEAT 与 HE 都算 → 跳弹角强制 90°（永不跳弹）
export const isExplosiveType = (shell) => shell === 'heat' || shell === 'he'
// 外部模块（BlitzKit External）：flat 抵消，无角度/转正/跳弹
export const isModule = (section) => section === ArmorSection.CHASSIS || section === ArmorSection.GUN_BARREL

// 主装甲 Primary（hull/turret/炮盾板）：收集阶段 push 后立即停止。
// 同时是【点击判定的触发面】：BlitzKit 的 shoot() 只挂在 Primary 网格的 onClick 上
// （spaced/外部模块网格挂的是空 handler，只为进入 event.intersections）——射线未触达
// Primary 时不发起判定。查看器相机点击路径据此过滤，勿在别处复制这份分类（唯一事实源）。
export const isPrimary = (section) => section === ArmorSection.HULL || section === ArmorSection.TURRET || section === ArmorSection.GUN

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
export function hasPrimaryLayer(layers) {
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
export function matchHitsByOccurrence(layers, hits) {
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
export function moduleVariant(section) {
  if (section === ArmorSection.CHASSIS) return 'track'
  if (section === ArmorSection.GUN_BARREL) return 'gun'
  return null
}

export const plateIdOf = (hit) => hit.plate_id ?? hit.plateId
export const hitNameOf = (hit) => hit.partName ?? hit.part_name
export const pointsCoincide = (a, b) => {
  if (Array.isArray(a) && Array.isArray(b)) return dist3(a, b) < 1e-6
  if (a && b && [a.x, a.y, a.z, b.x, b.y, b.z].every(Number.isFinite)) {
    return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z) < 1e-6
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
 * 本模块由 Node 脚本直接加载（scripts/browser-armor-aiming.mjs 等），不得 import
 * `.ts` 模块——import specifier 必须指向真实存在的 `.js`。
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
export function withContactRicochet(hits, contact) {
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
export function ricochetSurface(hit) {
  if (!hit) return null
  return {
    point: hit.contact_point || hit.point,
    normal: hit.contact_normal || hit.normal,
  }
}

export function withGapOrigin(hits, contact) {
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
export function collectFilteredHits(hits) {
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

export function dist3(a, b) {
  const dx = a[0] - b[0]
  const dy = a[1] - b[1]
  const dz = a[2] - b[2]
  return Math.sqrt(dx * dx + dy * dy + dz * dz)
}
