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
 * 为什么客户端判定：装甲查看器/射击复现数据面是纯静态资产（契约 §13），无 Agent
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
  if (t === 'he' || t === 'he_premium') return 'he'
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
// BlitzKit 外部模块按 variant 去重（"gun" | "track"），而非逐板 ID；spaced/primary 不参与
function moduleVariant(section) {
  if (section === ArmorSection.CHASSIS) return 'track'
  if (section === ArmorSection.GUN_BARREL) return 'gun'
  return null
}

/**
 * 收集阶段：外部模块按 variant 去重。确定性判定在首个 Primary 后停止（BlitzKit
 * 同）；概率链传 stopAtPrimary=false，拿到沿射线的全部装甲层（含首个 Primary
 * 之后的多层主装甲），否则“击穿第一层即结束”的截断链会漏掉后续层。
 * 注意这里不因某层未穿透而停止——那发生在判定循环。
 */
function collectFilteredHits(hits, stopAtPrimary = true) {
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
      filteredHits.push(ah)
      if (stopAtPrimary && isPrimary(ah.section)) break
    }
  }
  return filteredHits
}

/**
 * 单层几何（确定性与概率链共用）：外部模块 flat；实际装甲算入射角、3×/2×
 * 口径规则、首层转正与等效厚度。概率链只需要几何量，不读取剩余穿深。
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
  // 转正只作用于首个实际装甲层；外部模块是 flat 消耗，不计入 armorLayerCount。
  const effNormalization = ctx.armorLayerCount === 0 ? normalization : 0.0
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
 * 概率链：遍历到首个 Primary 的**全部**层，包含确定性判定会因某层未穿透而
 * 提前截断的后续层。外部模块保留 flat 标记；HEAT 层间插入 gap 描述（距离），
 * 供概率区间按 penetration.js 的同一 0.5/m 衰减处理。
 */
function buildProbabilityLayers(filteredHits, ctx) {
  const layers = []
  let armorLayerCount = 0
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
      })
    }
    const thickness = ah.thickness * ctx.thicknessCoeff
    const geo = resolveLayerGeometry(ah, thickness, {
      ...ctx,
      layerIndex: i,
      armorLayerCount,
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
    })
    if (!geo.external) armorLayerCount++
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

  // —— 收集阶段（对齐 blitzkit noDuplicateIntersections）：确定性判定在首个 Primary
  // 后停止；概率链另取全部命中（多层主装甲必须继续向下）。
  const filteredHits = collectFilteredHits(req.hits)
  const probabilityHits = collectFilteredHits(req.hits, false)
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
  // 已处理的实际装甲层数（间隙甲/主装甲；外部模块是 flat 消耗，不计入）。
  // 「转正只作用于首个装甲层」按它判定，而不是命中序号——动能弹击穿外部模块后
  // 仍保留转正/2×口径增强转正资格（用户 2026-10-17 裁示）。
  let armorLayerCount = 0
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
      // 几何规则与概率链共用 resolveLayerGeometry（转正只作用于首个实际装甲层；
      // 外部模块是 flat 消耗，不消耗首层转正资格；0mm 板不套 2× 公式）。
      const geo = resolveLayerGeometry(ah, thickness, {
        view,
        caliber,
        normalization_deg: normDeg,
        ricochet_deg: ricochetDeg,
        allowRicochet,
        layerIndex,
        armorLayerCount,
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
      armorLayerCount++
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

  // —— HE 判定 & 溅射伤害（对齐 BlitzKit）—— totalSpaced = 非 Primary 层（外部 flat + 间隙角度等效）
  // 等效厚度和；finalDamage = 0.5*dmg*(1-dist/radius) - 1.1*(lastLayer 厚度 + min(pen, totalSpaced))。
  // 多层或末层 blocked → splash/blocked；单层穿透 → 全额 damage。
  let resultDamage
  let isSplash
  let hePenetrated
  if (isHe && layers.length > 0) {
    let totalSpacedThickness = 0.0
    filteredHits.forEach((h, i) => {
      if (!isPrimary(h.section)) totalSpacedThickness += layers[i].effective
    })
    // blitzkit：lastLayer.thicknessAngled 对 external 层不存在 → NaN → 永不 splash，
    // 导致 HE 打履带/外部模块时永远 BLOCKED(0 伤害)，与游戏不符(GB109 shot2: HE 打履带掉血 126)。
    // 修正：外部模块末层按 flat 厚度参与溅射衰减（伤害数值可能仍偏大，游戏对履带吞噬溅射有额外衰减）。
    const lastEff = layers[layers.length - 1].effective
    const dist = dist3(filteredHits[filteredHits.length - 1].point, filteredHits[0].point)
    if (req.explosion_radius > 0.0) {
      const finalDamage = 0.5 * req.damage * (1.0 - dist / req.explosion_radius)
        - 1.1 * (lastEff + Math.min(totalSpacedThickness, pen))
      const multiOrBlocked = layers.length > 1 || !layers[layers.length - 1].penetrated
      if (multiOrBlocked) {
        const s = finalDamage > 0.0
        resultDamage = s ? finalDamage : 0.0
        isSplash = s
        hePenetrated = false
      } else {
        resultDamage = req.damage
        isSplash = false
        hePenetrated = true
      }
    } else {
      // 无爆炸半径（数据缺失兜底，blitzkit 无此分支）：仅单层穿透拿全额伤害
      const singlePen = layers.length === 1 && layers[0].penetrated
      resultDamage = singlePen ? req.damage : 0.0
      isSplash = false
      hePenetrated = singlePen
    }
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
  }
}
