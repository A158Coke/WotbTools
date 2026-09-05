from pathlib import Path


def replace_once(path, old, new):
    p = Path(path)
    text = p.read_text(encoding='utf-8')
    if old not in text:
        raise SystemExit(f'anchor not found in {path}: {old[:120]!r}')
    p.write_text(text.replace(old, new, 1), encoding='utf-8')


terrain = Path('frontend/src/utils/terrainReliefProjection.js')
text = terrain.read_text(encoding='utf-8')
anchor = "export function terrainReliefEdgeWeight(model, x, y) {"
addition = '''export const VEHICLE_ATTITUDE_MAX_PITCH_DEG = 14
export const VEHICLE_ATTITUDE_MAX_ROLL_DEG = 10
export const VEHICLE_ATTITUDE_RELIEF_SCALE = 1.35
const VEHICLE_ATTITUDE_SAMPLE_FRACTION = 0.42
const VEHICLE_ATTITUDE_DEFAULT_LENGTH_M = 7
const VEHICLE_ATTITUDE_DEFAULT_WIDTH_M = 3.2

/**
 * Presentation-only vehicle attitude from the authoritative terrain heightfield.
 * yaw follows the replay/map convention: 0° = +Y/north, 90° = +X/east.
 * The vehicle footprint comes from the existing marker sizing SSOT when available.
 * This does not invent replay Z or modify the terrain geometry; it only derives
 * pitch/roll from front/rear/left/right ground samples under the current hull.
 */
export function sampleTerrainAttitude(model, x, y, hullYawDeg, footprint = null) {
  if (!model || !Number.isFinite(Number(hullYawDeg))) return null
  const length = clamp(finite(footprint?.length, VEHICLE_ATTITUDE_DEFAULT_LENGTH_M), 4, 12)
  const width = clamp(finite(footprint?.width, VEHICLE_ATTITUDE_DEFAULT_WIDTH_M), 2, 5)
  const halfLength = clamp(length * VEHICLE_ATTITUDE_SAMPLE_FRACTION, 1.5, 4.5)
  const halfWidth = clamp(width * VEHICLE_ATTITUDE_SAMPLE_FRACTION, 0.8, 2.2)
  const yaw = Number(hullYawDeg) * Math.PI / 180
  const forwardX = Math.sin(yaw)
  const forwardY = Math.cos(yaw)
  const rightX = Math.cos(yaw)
  const rightY = -Math.sin(yaw)

  const frontZ = sampleTerrainHeight(model, x + forwardX * halfLength, y + forwardY * halfLength)
  const rearZ = sampleTerrainHeight(model, x - forwardX * halfLength, y - forwardY * halfLength)
  const rightZ = sampleTerrainHeight(model, x + rightX * halfWidth, y + rightY * halfWidth)
  const leftZ = sampleTerrainHeight(model, x - rightX * halfWidth, y - rightY * halfWidth)

  const pitchDeg = clamp(
    Math.atan2(frontZ - rearZ, halfLength * 2) * 180 / Math.PI * VEHICLE_ATTITUDE_RELIEF_SCALE,
    -VEHICLE_ATTITUDE_MAX_PITCH_DEG,
    VEHICLE_ATTITUDE_MAX_PITCH_DEG,
  )
  const rollDeg = clamp(
    Math.atan2(rightZ - leftZ, halfWidth * 2) * 180 / Math.PI * VEHICLE_ATTITUDE_RELIEF_SCALE,
    -VEHICLE_ATTITUDE_MAX_ROLL_DEG,
    VEHICLE_ATTITUDE_MAX_ROLL_DEG,
  )

  return Object.freeze({ pitchDeg, rollDeg })
}

'''
if 'sampleTerrainAttitude' not in text:
    text = text.replace(anchor, addition + anchor, 1)
    terrain.write_text(text, encoding='utf-8')

replace_once(
    'frontend/src/components/BattlePlayback.vue',
    "import { activeTerrainRelief, projectTerrainPoint, unprojectTerrainPoint } from '../utils/terrainReliefProjection.js'",
    "import { activeTerrainRelief, projectTerrainPoint, sampleTerrainAttitude, unprojectTerrainPoint } from '../utils/terrainReliefProjection.js'",
)
old_block = '''      return projectVehicleState({
      vehicle,
      track,
      time: currentTime.value,
      recorderAccountId: pbOverview.value.recorderAccountId,
      model,
      markerSize,
      // Unknown perspective keeps neutral CSS state; enemy assets are only a
      // visual fallback because the asset pack has no neutral hull/turret.
      hullImage: track.friendly === true ? friendlyHull : enemyHull,
      turretImage: track.friendly === true ? friendlyTurret : enemyTurret,
      markerLeft: markerLeft,
      markerTop: markerTop,
      markerTransform: markerTransform.value,
      overlayInverseScale: overlayInverseScale.value,
      overlayInverse: overlayInverse.value,
      translate: t,
      })'''
new_block = '''      const state = projectVehicleState({
        vehicle,
        track,
        time: currentTime.value,
        recorderAccountId: pbOverview.value.recorderAccountId,
        model,
        markerSize,
        // Unknown perspective keeps neutral CSS state; enemy assets are only a
        // visual fallback because the asset pack has no neutral hull/turret.
        hullImage: track.friendly === true ? friendlyHull : enemyHull,
        turretImage: track.friendly === true ? friendlyTurret : enemyTurret,
        markerLeft: markerLeft,
        markerTop: markerTop,
        markerTransform: markerTransform.value,
        overlayInverseScale: overlayInverseScale.value,
        overlayInverse: overlayInverse.value,
        translate: t,
      })
      if (!state) return null
      const terrainModel = reliefModelForPlayback()
      const hullYawDeg = state.direction?.hullYawDeg
      const terrainAttitude = terrainModel && Number.isFinite(hullYawDeg)
        ? sampleTerrainAttitude(
          terrainModel,
          state.pos.x,
          state.pos.y,
          hullYawDeg,
          markerSize?.footprint,
        )
        : null
      return { ...state, terrainAttitude }'''
replace_once('frontend/src/components/BattlePlayback.vue', old_block, new_block)

marker = Path('frontend/src/components/VehicleMarker.vue')
marker_text = marker.read_text(encoding='utf-8')
marker_anchor = "const turretDeg = computed(() => st.value.turretScreenDeg)\n"
marker_add = '''const turretDeg = computed(() => st.value.turretScreenDeg)

// 2.5D vehicle attitude: only the vehicle artwork tilts. Hitbox/HP/labels/selection
// remain screen-aligned and keep their existing collision/accessibility contracts.
const graphicsStyle = computed(() => {
  const attitude = st.value.terrainAttitude
  if (!attitude || hullDeg.value == null) return null
  const pitch = Number(attitude.pitchDeg)
  const roll = Number(attitude.rollDeg)
  const heading = Number(hullDeg.value)
  if (![pitch, roll, heading].every(Number.isFinite)) return null
  return {
    // Conjugate the 3D tilt by hull heading so pitch is always front/rear and
    // roll is always left/right in vehicle-local axes while child yaw remains authoritative.
    transform: `rotateZ(${heading}deg) rotateX(${-pitch}deg) rotateY(${-roll}deg) rotateZ(${-heading}deg)`,
  }
})
'''
if 'const graphicsStyle = computed(() =>' not in marker_text:
    if marker_anchor not in marker_text:
        raise SystemExit('VehicleMarker computed anchor missing')
    marker_text = marker_text.replace(marker_anchor, marker_add, 1)
marker_text = marker_text.replace('<div class="pb-graphics">', '<div class="pb-graphics" :style="graphicsStyle">', 1)
css_old = '''.pb-hull, .pb-turret {
  position: absolute;'''
css_new = '''.pb-vehicle {
  perspective: 96px;
  transform-style: preserve-3d;
}
.pb-hull, .pb-turret {
  position: absolute;'''
if '.pb-vehicle {\n  perspective: 96px;' not in marker_text:
    if css_old not in marker_text:
        raise SystemExit('VehicleMarker CSS root anchor missing')
    marker_text = marker_text.replace(css_old, css_new, 1)
graphics_old = '''.pb-graphics {
  position: absolute;
  inset: 0;
}'''
graphics_new = '''.pb-graphics {
  position: absolute;
  inset: 0;
  transform-origin: 50% 50%;
  transform-style: preserve-3d;
  backface-visibility: visible;
  transition: transform 90ms linear;
  will-change: transform;
}
@media (prefers-reduced-motion: reduce) {
  .pb-graphics { transition: none; }
}'''
if 'transition: transform 90ms linear' not in marker_text:
    if graphics_old not in marker_text:
        raise SystemExit('VehicleMarker graphics CSS anchor missing')
    marker_text = marker_text.replace(graphics_old, graphics_new, 1)
marker.write_text(marker_text, encoding='utf-8')

test = Path('frontend/src/utils/terrainReliefProjection.test.js')
ttext = test.read_text(encoding='utf-8')
ttext = ttext.replace(
    '  RELIEF_Z_EXAGGERATION,\n  createTerrainReliefModel,',
    '  RELIEF_Z_EXAGGERATION,\n  VEHICLE_ATTITUDE_MAX_PITCH_DEG,\n  createTerrainReliefModel,',
    1,
)
ttext = ttext.replace(
    '  sampleTerrainHeight,\n  terrainReliefEdgeWeight,',
    '  sampleTerrainAttitude,\n  sampleTerrainHeight,\n  terrainReliefEdgeWeight,',
    1,
)
attitude_tests = '''

describe('vehicle terrain attitude', () => {
  function gradientModel(axis, step = 0.5) {
    const size = 6
    const heights = []
    for (let row = 0; row < size; row++) {
      for (let col = 0; col < size; col++) {
        heights.push((axis === 'y' ? row : col) * step)
      }
    }
    return createTerrainReliefModel({
      mapCode: 'attitude',
      worldBounds: { xMin: -12, yMin: -12, xMax: 12, yMax: 12 },
      heightRangeMeters: { min: 0, max: 100 },
      samplesPerAxis: size,
      heights: new Float32Array(heights),
      zExaggeration: 1,
      padding: 0,
    })
  }

  it('derives positive pitch from an uphill front/rear ground slope', () => {
    const attitude = sampleTerrainAttitude(gradientModel('y'), 0, 0, 0, { length: 8, width: 3.5 })
    expect(attitude.pitchDeg).toBeGreaterThan(5)
    expect(Math.abs(attitude.rollDeg)).toBeLessThan(0.01)
  })

  it('derives roll in vehicle-local axes without inventing pitch', () => {
    const attitude = sampleTerrainAttitude(gradientModel('x'), 0, 0, 0, { length: 8, width: 3.5 })
    expect(attitude.rollDeg).toBeGreaterThan(5)
    expect(Math.abs(attitude.pitchDeg)).toBeLessThan(0.01)
  })

  it('clamps extreme terrain to the presentation safety limit', () => {
    const attitude = sampleTerrainAttitude(gradientModel('y', 20), 0, 0, 0, { length: 8, width: 3.5 })
    expect(attitude.pitchDeg).toBe(VEHICLE_ATTITUDE_MAX_PITCH_DEG)
  })
})
'''
if "describe('vehicle terrain attitude'" not in ttext:
    pos = ttext.rfind('\n})\n')
    if pos < 0:
        raise SystemExit('terrain test closing anchor missing')
    ttext = ttext[:pos+4] + attitude_tests + ttext[pos+4:]
test.write_text(ttext, encoding='utf-8')

vtest = Path('frontend/src/components/VehicleMarker.test.js')
vtext = vtest.read_text(encoding='utf-8')
marker_test = '''

  it('tilts only vehicle graphics with terrain pitch/roll while overlays stay screen-aligned', () => {
    const w = mountMarker({
      ...genericMarker,
      terrainAttitude: { pitchDeg: 8, rollDeg: -3 },
    })
    const graphics = w.find('.pb-graphics')
    const style = graphics.attributes('style') || ''
    expect(style).toContain('rotateZ(30deg)')
    expect(style).toContain('rotateX(-8deg)')
    expect(style).toContain('rotateY(3deg)')
    expect(style).toContain('rotateZ(-30deg)')
    expect(w.find('button.pb-vehicle').attributes('style')).not.toContain('rotateX')
    expect(w.find('.pb-hitbox').attributes('style')).not.toContain('rotateX')
  })
'''
if 'terrain pitch/roll while overlays stay screen-aligned' not in vtext:
    anchor = "  it('无方向样本（hullDeg/turretDeg null）→ 不渲染 img（不伪造朝向）', () => {"
    idx = vtext.find(anchor)
    if idx < 0:
        raise SystemExit('VehicleMarker test insertion anchor missing')
    vtext = vtext[:idx] + marker_test + '\n' + vtext[idx:]
vtest.write_text(vtext, encoding='utf-8')

plan = Path('docs/current-plan.md')
ptext = plan.read_text(encoding='utf-8')
plan_section = '''# Battle Playback 2.5D Vehicle Terrain Attitude

## 状态

IMPLEMENTED — READY FOR PR REVIEW

## 范围

- 保持现有 2D hull/turret 与 Tier X dedicated top-view assets，不引入 3D 坦克模型。
- 复用 2.5D authoritative terrain heightfield，在车辆 footprint 的前/后/左/右采样地面高度。
- hull yaw 仅负责把 terrain slope 转到车辆局部轴；pitch/roll 只作用于 `.pb-graphics`。
- HP、标签、hitbox、selected/recorder、碰撞布局继续 screen-aligned，不随车体倾斜。
- 视觉 pitch/roll 做轻度放大并分别 clamp ±14° / ±10°；不伪造 replay Z。

## 验收

- [x] 上坡/下坡可见车头抬起/下压；横坡可见轻微 roll。
- [x] flat terrain = 0° attitude。
- [x] marker 真实 footprint 继续来自现有 `vehicleMarkerSizing` SSOT。
- [x] 无 heightfield 或无可靠 hull yaw 时退化为原 2D marker，不猜方向。
- [x] targeted unit tests 覆盖 pitch/roll/clamp 与 graphics-only transform。

---
'''
if not ptext.startswith('# Battle Playback 2.5D Vehicle Terrain Attitude'):
    plan.write_text(plan_section + ptext, encoding='utf-8')

feature = Path('docs/features/battle-playback.md')
ftext = feature.read_text(encoding='utf-8')
feature_section = '''

## 2.5D 车辆地形姿态

Playback 继续使用现有俯视 hull/turret 资产，不引入 3D 坦克模型。启用 2.5D terrain relief 时，前端以当前车辆 footprint 和可靠 hull yaw 在 heightfield 上采样前/后/左/右地面高度，得到 presentation-only pitch/roll。pitch/roll 只倾斜车辆视觉层 `.pb-graphics`；HP、名称、hitbox、selected/recorder 与 collision layout 保持 screen-aligned。

该姿态来自地图权威 heightfield，不从前端猜测 replay Z；无 terrain model 或无可靠 hull yaw 时保持原有平面 marker。为避免小尺寸贴图翻卡片，视觉 pitch clamp ±14°、roll clamp ±10°，并遵守 `prefers-reduced-motion`。
'''
if '## 2.5D 车辆地形姿态' not in ftext:
    feature.write_text(ftext.rstrip() + feature_section + '\n', encoding='utf-8')

changelog = Path('docs/CHANGELOG.md')
ctext = changelog.read_text(encoding='utf-8')
cbullet = '- **Battle Playback 2.5D 车辆地形姿态**：复用 terrain heightfield 与现有真实车辆 footprint，在车辆局部前/后/左/右采样地面高度并计算受限 pitch/roll；只倾斜 hull/turret 视觉层，HP/标签/hitbox/碰撞布局继续保持屏幕对齐，无 heightfield 或无可靠朝向时退化为原平面 marker。\n'
if cbullet not in ctext:
    ctext = ctext.replace('## [Unreleased]\n\n', '## [Unreleased]\n\n### Battle Playback\n' + cbullet + '\n', 1)
    changelog.write_text(ctext, encoding='utf-8')

product = Path('docs/CHANGELOG-PRODUCT.md')
prtext = product.read_text(encoding='utf-8')
pbullet = '- **2.5D 战局回放车辆会随坡面抬头/低头**：坦克仍使用现有俯视贴图，但在上坡、下坡和横坡时会根据地图高度产生克制的车体倾斜；血量、名字和点击区域仍保持清晰稳定，不需要 3D 坦克模型。\n'
if pbullet not in prtext:
    prtext = prtext.replace('### Changed\n', '### Changed\n' + pbullet, 1)
    product.write_text(prtext, encoding='utf-8')
