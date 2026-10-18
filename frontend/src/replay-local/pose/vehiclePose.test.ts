import { describe, expect, it } from 'vitest'
import {
  GRID_DT,
  buildPoseFacet,
  poseCoveredAt,
  poseKeyframesOf,
  sampleVehiclePoseGame,
  selectActiveDef,
  visibilitySpansByEid,
  wrapPi,
} from './vehiclePose.js'
import type { AgentVehicleTrack } from '../../api/agent-replay-facets.js'

const GRID = { tStart: 0, samples: 11 }   // 0.0 .. 1.0s，步长 0.1s

function gridDef(over: Partial<AgentVehicleTrack> = {}): AgentVehicleTrack {
  // 网格列：pos 线性 (0,0,0)→(100,10,0)；yaw 0→90°；pitch 0；炮塔绝对 -20°→-20°；炮管 1°
  const n = GRID.samples
  const pos: number[] = []
  const hullYaw: number[] = []
  const hullPitch: number[] = []
  const hullRoll: number[] = []
  const turretYaw: number[] = []
  const gunPitch: number[] = []
  for (let i = 0; i < n; i++) {
    const f = i / (n - 1)
    pos.push(100 * f, 10 * f, -50 * f)
    hullYaw.push((Math.PI / 2) * f)
    hullPitch.push(0)
    hullRoll.push(0)
    turretYaw.push(-Math.PI / 9)
    gunPitch.push(Math.PI / 180)
  }
  return {
    eid: 7, account_id: 1, nickname: '', tank_id: 1, tank_name: '', team: 1,
    is_author: false, max_hp: 100,
    pos, hull_yaw: hullYaw, hull_pitch: hullPitch, hull_roll: hullRoll,
    turret_yaw: turretYaw, gun_pitch: gunPitch,
    hp: [], death_t: null, killer_eid: 0, shell_ids: [],
    turret_index: null, gun_index: null, coverage: [0, 1],
    ...over,
  } as AgentVehicleTrack
}

function keyframeDef(): AgentVehicleTrack {
  // 关键帧折线：三段 (0s, 0.5s, 1s)，位置/偏航/俯仰都只由折线决定；
  // 网格列故意给"错值"以证明关键帧优先。
  return gridDef({
    pos: new Array(GRID.samples * 3).fill(999),
    hull_yaw: new Array(GRID.samples).fill(9),
    hull_pitch: new Array(GRID.samples).fill(9),
    pose_kf: {
      t: [0, 0.5, 1],
      pos: [0, 0, 0, 10, 1, 0, 20, 2, 0],
      yaw: [0, Math.PI / 2, Math.PI],
      pitch: [0, 0.1, 0.2],
    },
  })
}

describe('sampleVehiclePoseGame（2D/3D 共用的唯一位姿采样器）', () => {
  it('缺 pose_kf 时按 10Hz 网格线性插值（分量级）', () => {
    const pose = sampleVehiclePoseGame(gridDef(), GRID, 0.5)
    expect(pose.x).toBeCloseTo(50, 6)
    expect(pose.y).toBeCloseTo(5, 6)
    expect(pose.z).toBeCloseTo(-25, 6)
    expect(pose.yaw).toBeCloseTo(Math.PI / 4, 6)
    expect(pose.pitch).toBeCloseTo(0, 6)
    expect(pose.gunPitch).toBeCloseTo(Math.PI / 180, 6)
  })

  it('t 落在采样点上时取原值；导出 GRID_DT 与上游网格步长一致', () => {
    const pose = sampleVehiclePoseGame(gridDef(), GRID, 0.3)
    expect(pose.x).toBeCloseTo(30, 6)
    expect(pose.yaw).toBeCloseTo(0.3 * (Math.PI / 2), 6)
    expect(GRID_DT).toBe(0.1)
  })

  it('pose_kf（≥2 点）优先：pos/yaw/pitch 走折线，roll/turret/gun 仍走网格列', () => {
    const pose = sampleVehiclePoseGame(keyframeDef(), GRID, 0.25)
    expect(pose.x).toBeCloseTo(5, 6)              // 折线：0 → 10 的中点
    expect(pose.y).toBeCloseTo(0.5, 6)
    expect(pose.yaw).toBeCloseTo(Math.PI / 4, 6)  // 折线：0 → π/2 的中点
    expect(pose.pitch).toBeCloseTo(0.05, 6)       // 折线：0 → 0.1 的中点
    expect(pose.roll).toBeCloseTo(0, 6)           // 网格列（本 fixture = 0）
    expect(pose.turretRel).toBeCloseTo(wrapPi(-Math.PI / 9 - Math.PI / 4), 6)
  })

  it('端点外按端点保持（关键帧与网格同语义）', () => {
    const before = sampleVehiclePoseGame(keyframeDef(), GRID, -3)
    expect(before.x).toBeCloseTo(0, 6)
    expect(before.yaw).toBeCloseTo(0, 6)
    const after = sampleVehiclePoseGame(gridDef(), GRID, 99)
    expect(after.x).toBeCloseTo(100, 6)
    expect(after.yaw).toBeCloseTo(Math.PI / 2, 6)
  })

  it('t 早于网格起点同样保持首值（绝不外推）', () => {
    const pose = sampleVehiclePoseGame(gridDef(), GRID, -1)
    expect(pose.x).toBeCloseTo(0, 6)
    expect(pose.y).toBeCloseTo(0, 6)
  })

  it('覆盖段内炮塔只在段内网格点插值（禁止跨隐藏段滑移）', () => {
    // 0.0..0.8s 炮塔 0°，0.9s 起 90°；覆盖从 0.85s 开始。
    // 不给覆盖段时 0.86s 会在 0.8s(0°)→0.9s(90°) 之间插值成 54°（跨隐藏段滑移）；
    // 给覆盖段后取段内第一个网格点 0.9s 的值，段首不再先指旧方向。
    const turret = new Array(GRID.samples).fill(0)
    turret[9] = 90
    turret[10] = 90
    const def = gridDef({ coverage: [0.85, 1], turret_yaw: turret })
    expect(sampleVehiclePoseGame(def, GRID, 0.86).turretAbs).toBeCloseTo(54, 6)
    expect(sampleVehiclePoseGame(def, GRID, 0.86, undefined, def.coverage).turretAbs).toBeCloseTo(90, 6)
  })

  it('buildPoseFacet 透出协议精确 visibility 段（末段缺 t_out = +∞）', () => {
    const playback = {
      meta: { t_start: 0, samples: GRID.samples } as never,
      vehicles: [gridDef()],
      visibility: [
        { eid: 7, t_in: 0.5, t_out: 0.8 },
        { eid: 7, t_in: 0.9 },
      ],
    }
    const facet = buildPoseFacet(playback)
    expect(facet.vehicles[0].visibility).toEqual([0.5, 0.8, 0.9, Number.POSITIVE_INFINITY])
    // 无 visibility 证据时回退 coverage（fail-safe）
    expect(buildPoseFacet({ meta: playback.meta, vehicles: [gridDef()] }).vehicles[0].visibility).toEqual([0, 1])
  })

  it('开放末段（+Infinity）也走段内采样；visibilitySpansByEid 与 2D/3D 共用投影', () => {
    const turret = new Array(GRID.samples).fill(0)
    turret[9] = 90
    turret[10] = 90
    const def = gridDef({ coverage: [0.85, Number.POSITIVE_INFINITY], turret_yaw: turret })
    // 无有限终点也必须识别为当前段，不能回退无约束插值（0.86s 应为 90，而不是 54）
    expect(sampleVehiclePoseGame(def, GRID, 0.86, undefined, def.coverage).turretAbs).toBeCloseTo(90, 6)
    const spans = visibilitySpansByEid([
      { eid: 7, t_in: 0.5, t_out: 0.8 },
      { eid: 7, t_in: 0.9 },
    ])
    expect(spans.get(7)).toEqual([0.5, 0.8, 0.9, Number.POSITIVE_INFINITY])
    expect(visibilitySpansByEid(null).size).toBe(0)
  })

  it('短隐藏段内炮塔/炮管/侧倾冻结在最后已知端点（不提前滑向下一段）', () => {
    const turret = new Array(GRID.samples).fill(0)
    turret[9] = 90
    turret[10] = 90
    const def = gridDef({ coverage: [0, 1], turret_yaw: turret })
    expect(sampleVehiclePoseGame(def, GRID, 0.85).turretAbs).toBeCloseTo(45, 6)
    // 精确 visibility 在 0.75→0.86 断开：0.85 取前一段末（0.75s，0°）而不是 45°
    expect(sampleVehiclePoseGame(def, GRID, 0.85, undefined, [0, 0.75, 0.86, 1]).turretAbs).toBeCloseTo(0, 6)
  })

  it('炮塔相对角 = wrapPi(绝对 − 车体)（跨 ±π 不跳变）', () => {
    const def = gridDef({
      hull_yaw: new Array(GRID.samples).fill((170 * Math.PI) / 180),
      turret_yaw: new Array(GRID.samples).fill((-170 * Math.PI) / 180),
    })
    const pose = sampleVehiclePoseGame(def, GRID, 0)
    expect(pose.turretRel).toBeCloseTo((20 * Math.PI) / 180, 6)   // 340° → 20°
  })

  it('侧倾缺列（旧产物）落 0，绝不拿 pitch 顶替', () => {
    const def = gridDef({ hull_roll: undefined, hull_pitch: new Array(GRID.samples).fill(0.4) })
    const pose = sampleVehiclePoseGame(def, GRID, 0.5)
    expect(pose.roll).toBe(0)
    expect(pose.pitch).toBeCloseTo(0.4, 6)
  })

  it('空列（长度 0）同样落 0；单点列取该点', () => {
    const empty = sampleVehiclePoseGame(gridDef({ turret_yaw: [], gun_pitch: [] }), GRID, 0.5)
    expect(empty.turretAbs).toBe(0)
    expect(empty.turretRel).toBeCloseTo(-empty.yaw, 6)
    const single = sampleVehiclePoseGame(gridDef({ gun_pitch: [0.5] }), GRID, 0.9)
    expect(single.gunPitch).toBe(0.5)
  })

  it('out 参数复用：返回同一对象，零分配热路径', () => {
    const out = { x: 0, y: 0, z: 0, yaw: 0, pitch: 0, roll: 0, turretAbs: 0, turretRel: 0, gunPitch: 0 }
    expect(sampleVehiclePoseGame(gridDef(), GRID, 0.5, out)).toBe(out)
  })

  it('poseKeyframesOf：缺省/单点折线 = null（回退网格），两点起生效', () => {
    expect(poseKeyframesOf(gridDef())).toBeNull()
    expect(poseKeyframesOf(gridDef({ pose_kf: { t: [0], pos: [0, 0, 0], yaw: [0], pitch: [0] } }))).toBeNull()
    expect(poseKeyframesOf(keyframeDef())).not.toBeNull()
    expect(poseKeyframesOf(null)).toBeNull()
  })

  it('wrapPi 收敛到 [−π, π)（与场景既有 wrapPi 同域）', () => {
    expect(wrapPi(3 * Math.PI)).toBeCloseTo(Math.PI, 9)
    expect(wrapPi(2 * Math.PI)).toBeCloseTo(0, 9)
    expect(wrapPi(-3 * Math.PI)).toBeCloseTo(-Math.PI, 9)
    expect(wrapPi(0.5)).toBeCloseTo(0.5, 9)
  })
})

describe('selectActiveDef（多实体账号的活跃实体选择，canonical 身份证据）', () => {
  const defA = { ...gridDef({ eid: 7, account_id: 1 }) }
  const defB = { ...gridDef({ eid: 9, account_id: 1 }) }
  // 首见证据：eid 7 从 10s 起、eid 9 从 100s 起（同一账号的重入/复活换实体）
  const starts = new Map<number, number | null>([[7, 10], [9, 100]])

  it('单实体账号直取（无身份判定），空集合 = null', () => {
    expect(selectActiveDef([defA], undefined, 0)).toBe(defA)
    expect(selectActiveDef([defA], starts, 0)).toBe(defA)
    expect(selectActiveDef([], starts, 50)).toBeNull()
  })

  it('多实体：按 activeEntityAt 选活跃实体——重入前取前实体，重入后取后实体', () => {
    expect(selectActiveDef([defA, defB], starts, 50)).toBe(defA)
    expect(selectActiveDef([defA, defB], starts, 10)).toBe(defA)
    expect(selectActiveDef([defA, defB], starts, 150)).toBe(defB)
    expect(selectActiveDef([defA, defB], starts, 100)).toBe(defB)
  })

  it('证据缺失/歧义（并列、null 首见、canonical 有而切面无）一律 null（回退 canonical）', () => {
    expect(selectActiveDef([defA, defB], undefined, 50)).toBeNull()
    expect(selectActiveDef([defA, defB], new Map([[7, null], [9, 100]]), 150)).toBeNull()
    expect(selectActiveDef([defA, defB], new Map([[7, 10], [9, 10]]), 50)).toBeNull()
    expect(selectActiveDef([defA, defB], new Map([[7, 10], [99, 100]]), 150)).toBeNull()
  })
})

describe('poseCoveredAt（采样时刻必须落在所选实体的 coverage 证据内）', () => {
  const withCoverage = (coverage: number[]) => gridDef({ coverage })

  it('区间内（含端点 ±容差）为 true；区间外、多区间空洞与畸形数据一律 false', () => {
    expect(poseCoveredAt(withCoverage([10, 20]), 15)).toBe(true)
    expect(poseCoveredAt(withCoverage([10, 20]), 10)).toBe(true)
    expect(poseCoveredAt(withCoverage([10, 20]), 20 + 1e-7)).toBe(true)   // 端点浮点抖动
    expect(poseCoveredAt(withCoverage([10, 20]), 9.9)).toBe(false)
    expect(poseCoveredAt(withCoverage([10, 20]), 20 + 1e-3)).toBe(false)
    expect(poseCoveredAt(withCoverage([10, 20, 30, 40]), 35)).toBe(true)  // 多区间
    expect(poseCoveredAt(withCoverage([10, 20, 30, 40]), 25)).toBe(false)
    expect(poseCoveredAt(withCoverage([]), 15)).toBe(false)
    expect(poseCoveredAt(withCoverage([10]), 15)).toBe(false)
    expect(poseCoveredAt(withCoverage([Number.NaN, 20]), 15)).toBe(false)
    expect(poseCoveredAt(undefined, 15)).toBe(false)
    expect(poseCoveredAt(withCoverage([10, 20]), Number.NaN)).toBe(false)
  })
})
