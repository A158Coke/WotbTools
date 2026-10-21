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
 * 负责解析，WotBTools 负责消费/编排）。不变量由 penetration.test.js 锁定（上游
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

/** 弹种解析（tanks.pb 原始串：hc 与 hc_premium=HEAT、ap_cr 系=APCR、ap_premium=AP、he_premium=HE） */
/**
 * 弹种解析：**field9 枚举优先**（权威，0=AP/1=APCR/2=HEAT/3=HE），其次 icon 串词表。
 *
 * field9 来自上游 tank 数据的 `type_id`（客户端 `<kind>` 语义枚举的翻译，4 值闭集）；
 * `type`/`shell_type` 是 field7 的 icon 显示令牌，词表是手工归纳的、客户端可自由新增
 * 变体（`atgm_heat` 就是曾经漏掉的一个）。有 id 就绝不看词表。
 * 未知串仍兜底 `'he'`——这是最后手段，不是判定依据。
 */
export function parseShellType(s, id) {
  if (typeof id === 'number') {
    if (id === 0) return 'ap'
    if (id === 1) return 'apcr'
    if (id === 2) return 'heat'
    if (id === 3) return 'he'
  }
  const t = String(s || '').toLowerCase()
  if (t === 'ap' || t === 'ap_premium') return 'ap'
  if (t === 'apcr' || t === 'ap_cr' || t === 'ap_cr_premium') return 'apcr'
  if (t === 'he' || t === 'he_premium' || t === 'hesh' || t === 'hesh_premium') return 'he'
  if (t === 'heat' || t === 'hc' || t === 'hc_premium' || t === 'atgm_heat') return 'heat'
  return 'he'
}

const isKinetic = (shell) => shell === 'ap' || shell === 'apcr'
const isExplosive = (shell) => shell === 'he'
// BlitzKit isExplosive()：HEAT 与 HE 都算 → 跳弹角强制 90°（永不跳弹）
const isExplosiveType = (shell) => shell === 'heat' || shell === 'he'
// 外部模块（BlitzKit External）：flat 抵消，无角度/转正/跳弹
const isModule = (section) => section === ArmorSection.CHASSIS || section === ArmorSection.GUN_BARREL

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
function moduleVariant(section) {
  if (section === ArmorSection.CHASSIS) return 'track'
  if (section === ArmorSection.GUN_BARREL) return 'gun'
  return null
}

const plateIdOf = (hit) => hit.plate_id ?? hit.plateId
const hitNameOf = (hit) => hit.partName ?? hit.part_name
const pointsCoincide = (a, b) => {
  if (Array.isArray(a) && Array.isArray(b)) return dist3(a, b) < 1e-6
  if (a && b && [a.x, a.y, a.z, b.x, b.y, b.z].every(Number.isFinite)) {
    return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z) < 1e-6
  }
  return false
}

/**
 * 收集阶段：外部模块按 variant 去重；确定性判定与概率链都只收集到**首个 Primary
 * （含）**——与 BlitzKit shoot() 的末层语义一致。概率链不再因某层未穿透而在收集
 * 阶段截断（那发生在判定循环），但也不得越过首个 Primary 继续收集其后的车体底板/
 * 履带：那些命中与本次装甲交火无关，会把补充概率压成 0（2026-10-18 Super
 * Conqueror 炮塔点击：19% vs 0% 的相邻位置差异）。
 */
function collectFilteredHits(hits) {
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
 * 单层几何（确定性与概率链共用）：外部模块 flat；实际装甲算入射角、3×/2×
 * 口径规则、逐层转正与等效厚度。概率链只需要几何量，不读取剩余穿深。
 * 转正按 BlitzKit shoot() 对**每个非外部层**独立计算（不继承首层状态）。
 */
function resolveLayerGeometry(ah, thickness, ctx) {
  if (isModule(ah.section)) {
    return {
      thickness,
      effective: thickness,
      external: true,
      angle_deg: null,
      ricochet: false,
      overmatch: false,
      normalization_deg: 0,
    }
  }
  const n = normalize(ah.normal)
  const cosA = Math.min(Math.abs(dot(n, ctx.view)), 1.0)
  const angleRad = Math.acos(cosA)
  const angleDeg = angleRad / DEG
  const threeCalibersRule = ctx.caliber > thickness * 3.0
  const noRicochet = threeCalibersRule || ctx.layerIndex > 0 || !ctx.allowRicochet
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
  const ricochet = !noRicochet && angleDeg >= ctx.ricochet_deg
  return {
    thickness,
    effective: ricochet ? 0.0 : effective,
    external: false,
    angle_deg: angleDeg,
    ricochet,
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
function buildProbabilityLayers(filteredHits, ctx) {
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
    })
    if (geo.ricochet) break
  }
  return layers
}

function dist3(a, b) {
  const dx = a[0] - b[0]
  const dy = a[1] - b[1]
  const dz = a[2] - b[2]
  return Math.sqrt(dx * dx + dy * dy + dz * dz)
}

function normalize(v) {
  const len = Math.sqrt(v[0] * v[0] + v[1] * v[1] + v[2] * v[2])
  return len > 0 ? [v[0] / len, v[1] / len, v[2] / len] : [0, 1, 0]
}

function dot(a, b) {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
}

const DEG = Math.PI / 180
const HIT_SECTIONS = new Set(Object.values(ArmorSection))

/**
 * 判定输入的结构完整性。缺 section / 板厚 NaN / 缺法线或命中点都会让后续几何
 * 静默失真（NaN 传染、按 0mm 板处理、拿 [0,1,0] 猜法线），必须在进入几何链之前
 * 返回结构化 ERROR，而不是崩溃或产出伪造数字。
 * @returns {string|null} 失败原因；null = 通过
 */
function invalidHitReason(hits) {
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

/**
 * 击穿判定（上游 PenetrationRequest/PenetrationResult 的 wire 形状，snake_case 保持）。
 * @param {object} req { shell_type, penetration, caliber, view_dir, hits, damage?,
 *   explosion_radius?, calibrated_shells?, enhanced_armor?, normalization_deg?,
 *   ricochet_deg?, allow_ricochet?, distance_m?, penetration_far? }
 * @returns {object} { result, total_effective, layers, probability_layers,
 *   probability_penetration, first_armor_angle_deg, first_armor_norm_deg,
 *   ricochet, ricochet_remaining_pen, damage }。
 *   层另带 angle_deg（该层入射角，度；外部模块层无）——结果面板对照 BlitzKit
 *   ShotDisplayCard 显示「等效厚度 @ 角度」用。
 */
export function calculate(req) {
  const shell = parseShellType(req.shell_type, req.shell_type_id)
  const isHe = isExplosive(shell)
  const isHeat = shell === 'heat'
  // 结构非法 → 直接 ERROR。几何链对 NaN/缺字段没有安全语义，不能进。
  const invalidHits = invalidHitReason(req.hits)
  if (invalidHits) {
    return {
      result: 'ERROR',
      total_effective: 0,
      layers: [],
      probability_layers: [],
      probability_penetration: Math.max(Number(req.penetration) || 0, 0),
      first_armor_angle_deg: -1,
      first_armor_norm_deg: -1,
      ricochet: false,
      ricochet_remaining_pen: 0,
      damage: 0,
      he: isHe ? {
        splash_min: 0,
        splash_max: 0,
        splash_avg: 0,
        full_damage: req.damage,
        explosion_radius: req.explosion_radius,
        samples: 0,
        best: null,
        best_lower: null,
        source: 'single-ray',
        degraded: true,
        unavailable: true,
        reason: invalidHits,
      } : null,
    }
  }
  // Armor Inspector HE 溅射采样结果（tankViewer 的 800 射线采样器给出）。
  //
  // 三态，语义不可混用：
  // - he_splash 存在：采样器跑了。`samples === 0` 是**权威的零伤害**
  //   （没有任何射线在 R 内遇到主装，func7695 对这类样本 skip）。
  // - he_splash_error 存在：采样器**跑不了**（碰撞包/网格/入参）。显式错误，
  //   禁止用单射线公式冒充采样结果。
  // - 两者都没有：调用方没有采样器（上游纯函数 / `/api/penetrate`）。此时单射线
  //   func7695 公式就是该契约的定义行为，结果标记 `source:'single-ray', degraded:true`。
  const heSplashInput = isHe && req.he_splash != null ? req.he_splash : null
  const heSplashShapeOk = heSplashInput
    && Number.isFinite(heSplashInput.min) && Number.isFinite(heSplashInput.max)
    && Number.isFinite(heSplashInput.avg)
    && Number.isInteger(heSplashInput.samples) && heSplashInput.samples >= 0
  const heSplash = heSplashShapeOk ? heSplashInput : null
  // 采样结果形状非法（字段缺失/NaN）= 采样器输出不可信 → 显式错误，不得静默落回单射线。
  const heSplashError = isHe
    ? (typeof req.he_splash_error === 'string' && req.he_splash_error.length > 0
      ? req.he_splash_error
      : (heSplashInput && !heSplashShapeOk ? 'sampler:invalid-result' : null))
    : null
  const caliber = req.caliber
  // 装备修正（对齐 BlitzKit resolvePenetrationCoefficient）：Calibrated 穿深 +6%(动能)/+7%，Enhanced Armor 装甲 +4%
  const calibCoeff = req.calibrated_shells ? (isKinetic(shell) ? 1.06 : 1.07) : 1.0
  // 基础穿深：near × 装备系数；提供 distance_m + penetration_far 时叠加客户端指示器的
  // 距离衰减（d>100m 起 400m 区间线性到 far，不截断插值、最终 max(0)；HE 豁免——客户端
  // flag 分支 = kind==kHighExplosive）。对齐 wotblitz.exe 0x719740（常量 100/400 反汇编
  // 实测，证据链见上游 Agent 仓 investigation/blitz-client-protocol-and-replay.md §8.7）。
  // 注意 HEAT 数据 far==near → 飞行段天然恒平，其专属衰减是间隙项（见下方 gap 分支）。
  let basePen = req.penetration
  if (!isHe && req.distance_m != null && req.penetration_far != null && req.distance_m > 100.0) {
    basePen += (req.penetration_far - req.penetration) * (req.distance_m - 100.0) / 400.0
  }
  const pen = Math.max(basePen, 0.0) * calibCoeff
  const thicknessCoeff = req.enhanced_armor ? 1.04 : 1.0
  // 每发弹参数（blitzkit：normalization ?? 0；HEAT/HE 的 ricochet 上游即为 90°——永不跳弹）
  const normDeg = req.normalization_deg ?? 0
  const ricochetDeg = isExplosiveType(shell) ? 90.0 : (req.ricochet_deg ?? 70.0)

  const view = normalize(req.view_dir)

  // —— 收集阶段（对齐 blitzkit noDuplicateIntersections）：确定性判定与概率链
  // 都停在首个 Primary（含）。概率链的差异只在判定循环：即使某层未穿透，
  // 也继续评估后面直到首个 Primary 的层，而不是复用确定性截断结果。
  const filteredHits = collectFilteredHits(req.hits)
  const probabilityHits = collectFilteredHits(req.hits)
  // blitzkit：出射射线（allowRicochet=false）未命中任何 Primary → null；这里以空结果 "-" 表达。
  const allowRicochet = req.allow_ricochet !== false
  if (!allowRicochet && filteredHits.every((h) => !isPrimary(h.section))) {
    return {
      result: '-',
      total_effective: 0.0,
      layers: [],
      probability_layers: [],
      probability_penetration: pen,
      first_armor_angle_deg: -1.0,
      first_armor_norm_deg: -1.0,
      ricochet: false,
      ricochet_remaining_pen: 0.0,
      damage: 0.0,
    }
  }

  let remainingPen = pen // 剩余穿深
  let totalEffective = 0.0 // 累计等效厚度
  const layers = [] // 每层结果
  let firstArmorAngleDeg = -1.0
  let firstArmorNormDeg = -1.0
  let ricochet = false
  let ricochetRemainingPen = 0.0

  for (let layerIndex = 0; layerIndex < filteredHits.length; layerIndex++) {
    const ah = filteredHits[layerIndex]
    const thickness = ah.thickness * thicknessCoeff

    // HEAT 间隙衰减：位于每层处理最前（对齐 blitzkit 顺序），并像 blitzkit
    // 一样 push 一条 gap 层（type=null）——gap 阻断时它成为末层 → blocked。
    if (isHeat && layerIndex > 0) {
      const prevPoint = filteredHits[layerIndex - 1].point
      const distance = dist3(ah.point, prevPoint)
      const before = remainingPen
      // 系数 0.5 为项目裁定（2026-10-13）：WG 客户端 shells.xml 的
      // piercingPowerLossFactorByDistance=0.05（HEAT 全量）与实际判定不符，判定为数据
      // 填写错误。客户端装甲指示器确实按 0.05/米计算（0x6b54da，反汇编证据见上游
      // Agent 仓 investigation §8.7）——即客户端指示器偏乐观，实现以 BlitzKit 经验值
      // 0.5/米为准。勿"对齐修正"回 0.05。
      remainingPen -= 0.5 * remainingPen * distance
      const gapBlocked = remainingPen <= 0.0
      layers.push({
        part_name: `Gap ${distance.toFixed(2)}m`,
        thickness: 0.0,
        effective: 0.0,
        remaining_before: before,
        penetrated: !gapBlocked,
        ricochet: false,
        overmatch: false,
      })
      if (gapBlocked) break
    }

    let eff
    let layerPenetrated
    let isOvermatch = false
    let layerAngleDeg = null   // 该层入射角（外部模块层无角度——flat 消耗）
    if (isModule(ah.section)) {
      eff = thickness
      if (isHe) {
        // HE 弹遇外部模块：永远 blocked，但消耗穿深并继续（算溅射）。
        layerPenetrated = false
      } else {
        // blitzkit：减去厚度后 remaining <= 0 即 blocked（严格大于才穿透）
        layerPenetrated = remainingPen > eff
      }
    } else {
      // 几何规则与概率链共用 resolveLayerGeometry：BlitzKit 对每个非外部层
      // 都用自身厚度/角度重新计算 normalization 与 2× 口径增强；外部模块 flat，
      // 不参与转正；0mm 板不套 2× 公式。
      const geo = resolveLayerGeometry(ah, thickness, {
        view,
        caliber,
        normalization_deg: normDeg,
        ricochet_deg: ricochetDeg,
        allowRicochet,
        layerIndex,
      })
      layerAngleDeg = geo.angle_deg
      if (firstArmorAngleDeg < 0.0) firstArmorAngleDeg = layerAngleDeg
      isOvermatch = geo.overmatch

      // 跳弹：入射角 ≥ 跳弹角 且 未被抑制（HEAT/HE 跳弹角=90° 永不触发）
      if (geo.ricochet) {
        ricochet = true
        ricochetRemainingPen = remainingPen * 0.75
        layers.push({
          part_name: ah.part_name,
          thickness,
          effective: 0.0,
          remaining_before: remainingPen,
          penetrated: false,
          ricochet: true,
          overmatch: false,
          angle_deg: layerAngleDeg,
        })
        break
      }

      eff = geo.effective
      if (firstArmorNormDeg < 0.0) firstArmorNormDeg = geo.normalization_deg
      // HE 命中非 Primary（间隙甲）：blitzkit 标 blocked，但穿深照常消耗
      layerPenetrated = (isPrimary(ah.section) || !isHe) && remainingPen > eff
    }

    totalEffective += eff
    layers.push({
      part_name: ah.part_name,
      thickness,
      effective: eff,
      remaining_before: remainingPen,
      penetrated: layerPenetrated,
      ricochet: false,
      overmatch: isOvermatch,
      angle_deg: layerAngleDeg,
    })

    if (layerPenetrated) {
      remainingPen -= eff
      // 无需 break：收集阶段已在首个 Primary 后截断（blitzkit 同）
    } else if (!isHe) {
      break // blitzkit：remaining <= 0 即终止（HE 除外）
    } else {
      remainingPen -= eff // HE 的 blocked 层同样消耗穿深
    }
  }

  // 概率链必须在确定性循环之外重建：上面的 layers 会在首个未穿透层提前 break，
  // 而概率模型要看到到首个 Primary 的完整路径。
  const probabilityLayers = buildProbabilityLayers(probabilityHits, {
    view,
    caliber,
    thicknessCoeff,
    normalization_deg: normDeg,
    ricochet_deg: ricochetDeg,
    allowRicochet,
    isHeat,
  })

  // —— HE 判定 & 溅射伤害 ——
  // 优先使用 req.he_splash：tankViewer 的 800 条世界空间方向采样（Armor Inspector
  // wasm func7695 的精确语义：0.75/1.25 两个浮动界、名义层装甲累加、R=explosion_radius、
  // he_min/max = 两个界各自的最大值、avg 取中点）。概率击穿仍由外层 CDF 决定。
  //
  // 采样器跑不了（req.he_splash_error）时结果是 ERROR + 零伤害，绝不回退单射线：
  // 单射线估算与 800 射线采样不是同一个语义，冒充采样会把面板数字拉离 AI。
  // 只有从未提供采样器的调用方（上游纯函数 / `/api/penetrate`）才使用单射线
  // func7695 公式，并在 he 上标记 `source:'single-ray', degraded:true`。
  let resultDamage
  let isSplash
  let hePenetrated
  let heData = null
  if (isHe && heSplashError) {
    resultDamage = 0.0
    isSplash = false
    hePenetrated = false
    heData = {
      splash_min: 0.0,
      splash_max: 0.0,
      splash_avg: 0.0,
      full_damage: req.damage,
      explosion_radius: req.explosion_radius,
      samples: 0,
      best: null,
      best_lower: null,
      source: 'sampler',
      unavailable: true,
      reason: heSplashError,
    }
  } else if (isHe && heSplash) {
    resultDamage = heSplash.avg > 0.0 ? heSplash.avg : 0.0
    isSplash = heSplash.avg > 0.0
    hePenetrated = false
    heData = {
      splash_min: heSplash.min,
      splash_max: heSplash.max,
      splash_avg: heSplash.avg,
      full_damage: req.damage,
      explosion_radius: req.explosion_radius,
      // samples === 0：采样跑了但没有有效主装射线 → 权威的零溅射（不是“不可用”）。
      samples: heSplash.samples,
      source: 'sampler',
      // 诊断：最佳射线（max upper）的层链；armordebug=1 可直接对照 Armor Inspector
      best: heSplash.best ? {
        upper: heSplash.best.upper,
        lower: heSplash.best.lower,
        armor: heSplash.best.armor,
        distance: heSplash.best.distance,
        direction: heSplash.best.direction || null,
        layers: heSplash.best.layers,
      } : null,
      // he_min 是 lower 的最大值，可能与 max-upper 样本不是同一条射线。
      best_lower: heSplash.bestLower ? {
        upper: heSplash.bestLower.upper,
        lower: heSplash.bestLower.lower,
        armor: heSplash.bestLower.armor,
        distance: heSplash.bestLower.distance,
        direction: heSplash.bestLower.direction || null,
        layers: heSplash.bestLower.layers,
      } : null,
    }
  } else if (isHe && layers.length > 0) {
    // 单射线路径：只服务**从未提供采样器**的调用方（上游纯函数 / `/api/penetrate`，
    // 上游 Rust `calculate()` 同口径）。客户端在采样器不可用时走 he_splash_error，
    // 不会到达这里。名义层厚（不是等效）累加到首个主装（含）；没有主装时累加全部
    // 模块层并仍给溅射——这是上游契约的历史行为，结果以 degraded 标记，不能当作
    // 800 射线采样的替代。
    let splashArmor = 0.0
    let primaryIdx = -1
    for (let i = 0; i < layers.length; i++) {
      const h = filteredHits[i]
      // 与 800 射线采样器同一装甲系数：强化装甲对 HE 兜底同样生效。
      // 板厚/法线已由 invalidHitReason 在入口保证有限，这里不再做 ||0 掩盖。
      splashArmor += Number(h ? h.thickness : layers[i].thickness) * thicknessCoeff
      if (h && isPrimary(h.section)) { primaryIdx = i; break }
    }
    const R = req.explosion_radius
    if (R > 0.0 && filteredHits.length > 0) {
      // 与采样器一致：原点是命中点沿射向反方向（朝射手）外移 10cm，因此点击
      // 射线到首板的层距离是 0.1×|cos(shot, plateNormal)|（AI 锚点：T-34
      // 0.0496 / Pz IV 0.0751 / D2 0.0593）。多层的几何间隔就是命中点之间的
      // 距离（点击射线共线）；薄板内部行程没有逐层 t，兜底不建模。
      const firstNormal = normalize(filteredHits[0].normal)
      const base = 0.1 * Math.abs(dot(view, firstNormal))
      const endIdx = primaryIdx >= 0 ? primaryIdx : layers.length - 1
      const endPoint = (filteredHits[endIdx] || filteredHits[0]).point
      const d = base + dist3(endPoint, filteredHits[0].point)
      const falloff = 1.0 - d / R
      const upper = Math.max(0.0, 0.5 * req.damage * 1.25 * falloff - splashArmor)
      const lower = Math.max(0.0, 0.5 * req.damage * 0.75 * falloff - splashArmor)
      resultDamage = (upper + lower) / 2.0
      isSplash = resultDamage > 0.0
      hePenetrated = false
      heData = {
        splash_min: lower,
        splash_max: upper,
        splash_avg: resultDamage,
        full_damage: req.damage,
        explosion_radius: R,
        samples: 1,
        best: null,
        best_lower: null,
        // 不是 800 射线采样：UI/诊断必须能区分（客户端正常路径不会走到这里）。
        source: 'single-ray',
        degraded: true,
      }
    } else {
      // 无爆炸半径：fail-closed，不猜单层满伤。
      resultDamage = 0.0
      isSplash = false
      hePenetrated = false
    }
  } else if (isHe) {
    resultDamage = 0.0
    isSplash = false
    hePenetrated = false
  } else {
    // 伤害归属（对齐 blitzkit lastLayer.status）：末层被穿透 → 全额 armor_damage
    //（含仅穿透履带/间隙甲的情形）；否则 0。跳弹段伤害由前端二次判定补充。
    const last = layers[layers.length - 1]
    if (layers.length > 0 && last.penetrated) {
      resultDamage = req.damage
      isSplash = false
      hePenetrated = true
    } else {
      resultDamage = 0.0
      isSplash = false
      hePenetrated = false
    }
  }

  const result = ricochet
    ? 'RICOCHET'
    : (heData && heData.unavailable)
      ? 'ERROR'
      : isSplash
        ? 'SPLASH'
        : hePenetrated
          ? 'PENETRATION'
          : pen > 0.0
            ? 'BLOCKED'
            : '-'

  return {
    result,
    total_effective: totalEffective,
    layers,
    probability_layers: probabilityLayers,
    probability_penetration: pen,
    first_armor_angle_deg: firstArmorAngleDeg,
    first_armor_norm_deg: firstArmorNormDeg,
    ricochet,
    ricochet_remaining_pen: ricochetRemainingPen,
    damage: resultDamage,
    // HE 溅射界（Armor Inspector func7695 口径）。`source` 标明来源：
    // - 'sampler'（samples 可为 0 = 权威零伤害，或 unavailable:true + reason = 采样器跑不了）
    // - 'single-ray'（degraded:true；仅无采样器的上游/纯函数调用方）
    // 非 HE 为 null。概率/期望伤害由外层结合 CDF 计算。
    he: heData,
  }
}
