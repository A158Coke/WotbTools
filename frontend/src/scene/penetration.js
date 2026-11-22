// Penetration facade: preserve the public entrypoint while geometry and hit-chain ownership live in TypeScript.
import { parseShellType, isExplosive, invalidHitReason, isKinetic, isExplosiveType, normalize,
  collectFilteredHits, isPrimary, dist3, resolveLayerGeometry, isModule, buildProbabilityLayers, dot, hasPrimaryLayer } from './penetrationGeometry.ts'
export { ArmorSection, SHELL_TOKEN_KIND, parseShellType, isPrimary, hasPrimaryLayer,
  matchHitsByOccurrence, withContactRicochet, ricochetSurface, withGapOrigin } from './penetrationGeometry.ts'

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
  // **共享同一份命中链**——收集结果与后续评估无关（都停在首个 Primary 含；差异只在
  // 判定循环本身：概率链对未穿透层继续评估，见 buildProbabilityLayers）。
  const filteredHits = collectFilteredHits(req.hits)
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
    // 几何规则与概率链共用 resolveLayerGeometry：外部模块 flat，不参与转正；0mm 板
    // 不套 2× 公式。模块层也可能承载物理首触面（首触板在模块前方）→ 跳弹先在
    // 分支之前判定，避免 isModule 提前返回吞掉 contact_*。
    const geo = resolveLayerGeometry(ah, thickness, {
      view,
      caliber,
      normalization_deg: normDeg,
      ricochet_deg: ricochetDeg,
      allowRicochet,
      layerIndex,
      thicknessCoeff,
    })
    if (geo.ricochet) {
      ricochet = true
      ricochetRemainingPen = remainingPen * 0.75
      const contactThickness = ah.contact_normal
        ? (ah.contact_thickness != null ? ah.contact_thickness : ah.thickness) * thicknessCoeff
        : null
      layers.push({
        part_name: ah.part_name,
        thickness,
        effective: 0.0,
        remaining_before: remainingPen,
        penetrated: false,
        ricochet: true,
        overmatch: false,
        angle_deg: geo.ricochet_angle_deg != null ? geo.ricochet_angle_deg : geo.angle_deg,
        // 跳弹发生在首触面时，结果卡按首触板的名字/厚度呈现（保留层仍是厚度链那一层）。
        contact_part_name: ah.contact_normal ? (ah.contact_part_name || null) : null,
        contact_thickness: contactThickness,
      })
      break
    }
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
      layerAngleDeg = geo.angle_deg
      if (firstArmorAngleDeg < 0.0) firstArmorAngleDeg = layerAngleDeg
      isOvermatch = geo.overmatch

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
  // 而概率模型要看到到首个 Primary 的完整路径（命中链与确定性判定同一份）。
  const probabilityLayers = buildProbabilityLayers(filteredHits, {
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

  let result = ricochet
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

  // 射击复现的“无主装甲链”门禁（require_primary）：射线只命中履带/炮管/间隙甲时，
  // 末层规则会给出 PENETRATION + 全额伤害，但服务器对这类 hit 的 result=1/2/4、damage=0。
  // 查看器相机点击仍沿用 BlitzKit 末层语义（默认 false）；射击复现请求 true，
  // 无 Primary（hull/turret/gun，0mm 也算）且非 HE/非跳弹 → BLOCKED、0 伤害。
  // 只要 require_primary 命中“无 Primary”链就阻断，**不要求原结果已经是 PENETRATION**：
  // 原结果可能已被唯一间隙甲挡住（BLOCKED/0），但卡片概率链仍会把它回填成
  // “可能击穿 + 满伤”。无主装甲的定义不依赖确定性末层是否恰好穿透。
  const blockedNoPrimary = req.require_primary === true && !isHe && !ricochet
    && !hasPrimaryLayer(probabilityLayers)
  if (blockedNoPrimary) {
    result = 'BLOCKED'
    resultDamage = 0
  }

  return {
    result,
    // 无主装甲门禁命中：消费方必须禁用概率/满伤回填，不能只读 result/damage。
    blocked_no_primary: blockedNoPrimary,
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
