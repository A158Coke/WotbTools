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
  const heSplashInput = isHe && req.he_splash != null ? req.he_splash : null
  const heSplashShapeOk = heSplashInput
    && Number.isFinite(heSplashInput.min) && Number.isFinite(heSplashInput.max)
    && Number.isFinite(heSplashInput.avg)
    && Number.isInteger(heSplashInput.samples) && heSplashInput.samples >= 0
  const heSplash = heSplashShapeOk ? heSplashInput : null
  const heSplashError = isHe
    ? (typeof req.he_splash_error === 'string' && req.he_splash_error.length > 0
      ? req.he_splash_error
      : (heSplashInput && !heSplashShapeOk ? 'sampler:invalid-result' : null))
    : null
  const caliber = req.caliber
  const calibCoeff = req.calibrated_shells ? (isKinetic(shell) ? 1.06 : 1.07) : 1.0
  let basePen = req.penetration
  if (!isHe && req.distance_m != null && req.penetration_far != null && req.distance_m > 100.0) {
    basePen += (req.penetration_far - req.penetration) * (req.distance_m - 100.0) / 400.0
  }
  const pen = Math.max(basePen, 0.0) * calibCoeff
  const thicknessCoeff = req.enhanced_armor ? 1.04 : 1.0
  const normDeg = req.normalization_deg ?? 0
  const ricochetDeg = isExplosiveType(shell) ? 90.0 : (req.ricochet_deg ?? 70.0)

  const view = normalize(req.view_dir)

  const filteredHits = collectFilteredHits(req.hits)
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

  let remainingPen = pen
  let totalEffective = 0.0
  const layers = []
  let firstArmorAngleDeg = -1.0
  let firstArmorNormDeg = -1.0
  let ricochet = false
  let ricochetRemainingPen = 0.0

  for (let layerIndex = 0; layerIndex < filteredHits.length; layerIndex++) {
    const ah = filteredHits[layerIndex]
    const thickness = ah.thickness * thicknessCoeff

    if (isHeat && layerIndex > 0) {
      const prevPoint = filteredHits[layerIndex - 1].point
      const distance = dist3(ah.point, prevPoint)
      const before = remainingPen
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
    let layerAngleDeg = null
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
        contact_part_name: ah.contact_normal ? (ah.contact_part_name || null) : null,
        contact_thickness: contactThickness,
      })
      break
    }
    if (isModule(ah.section)) {
      eff = thickness
      if (isHe) {
        layerPenetrated = false
      } else {
        layerPenetrated = remainingPen > eff
      }
    } else {
      layerAngleDeg = geo.angle_deg
      if (firstArmorAngleDeg < 0.0) firstArmorAngleDeg = layerAngleDeg
      isOvermatch = geo.overmatch

      eff = geo.effective
      if (firstArmorNormDeg < 0.0) firstArmorNormDeg = geo.normalization_deg
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
    } else if (!isHe) {
      break
    } else {
      remainingPen -= eff
    }
  }

  const probabilityLayers = buildProbabilityLayers(filteredHits, {
    view,
    caliber,
    thicknessCoeff,
    normalization_deg: normDeg,
    ricochet_deg: ricochetDeg,
    allowRicochet,
    isHeat,
  })

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
      samples: heSplash.samples,
      source: 'sampler',
      best: heSplash.best ? {
        upper: heSplash.best.upper,
        lower: heSplash.best.lower,
        armor: heSplash.best.armor,
        distance: heSplash.best.distance,
        direction: heSplash.best.direction || null,
        layers: heSplash.best.layers,
      } : null,
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
    let splashArmor = 0.0
    let primaryIdx = -1
    for (let i = 0; i < layers.length; i++) {
      const h = filteredHits[i]
      splashArmor += Number(h ? h.thickness : layers[i].thickness) * thicknessCoeff
      if (h && isPrimary(h.section)) { primaryIdx = i; break }
    }
    const R = req.explosion_radius
    if (R > 0.0 && filteredHits.length > 0) {
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
        source: 'single-ray',
        degraded: true,
      }
    } else {
      resultDamage = 0.0
      isSplash = false
      hePenetrated = false
    }
  } else if (isHe) {
    resultDamage = 0.0
    isSplash = false
    hePenetrated = false
  } else {
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

  const blockedNoPrimary = req.require_primary === true && !isHe && !ricochet
    && !hasPrimaryLayer(probabilityLayers)
  if (blockedNoPrimary) {
    result = 'BLOCKED'
    resultDamage = 0
  }

  return {
    result,
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
    he: heData,
  }
}
