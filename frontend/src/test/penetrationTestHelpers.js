// Pure fixture factories for penetration tests; each call returns fresh mutable values.
export function hit(section, thickness, point, extra = {}) {
  return {
    section,
    plate_id: '1',
    thickness,
    normal: [0.0, 1.0, 0.0],
    point,
    part_name: section,
    ...extra,
  }
}

export function req(shellType, pen, caliber, hits, overrides = {}) {
  return {
    shell_type: shellType,
    penetration: pen,
    caliber,
    view_dir: [0.0, 1.0, 0.0],
    hits,
    damage: 400.0,
    explosion_radius: 0.0,
    calibrated_shells: false,
    enhanced_armor: false,
    normalization_deg: undefined,
    ricochet_deg: undefined,
    allow_ricochet: true,
    ...overrides,
  }
}
