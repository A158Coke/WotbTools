import { describe, expect, it } from 'vitest'
import { projectVehicleState } from './playbackVehicleState'

const project = (time, orientationSegments = [{ startSec: 0, endSec: 10, knowledge: 'CURRENT', samples: [
  { timeSec: 0, hullYawDeg: 10, turretRelativeYawDeg: 20 },
] }], pose = null, positionSegments = [{ startSec: 0, endSec: 10, knowledge: 'OBSERVED', samples: [
  { timeSec: 0, x: 0, y: 0 }, { timeSec: 10, x: 100, y: 50 },
] }]) => projectVehicleState({
  vehicle: { accountId: 7, team: 1, playerName: 'Player', tankId: 123, tankName: 'Tank' },
  track: {
    friendly: true,
    positionSegments,
    orientationSegments,
    lifeTransitions: [],
  },
  time,
  pose,
  recorderAccountId: 7,
  friendlyTeam: 1,
  model: null,
  hullImage: 'friendly-hull',
  turretImage: 'friendly-turret',
  markerLeft: (x) => `${x}%`,
  markerTop: (y) => `${y}%`,
  markerTransform: 'translate(-50%, -50%)',
  overlayInverseScale: 'scale(1)',
  overlayInverse: 1,
  translate: (key) => key,
})

describe('projectVehicleState', () => {
  it('projects canonical position/orientation without Vue mounting', () => {
    const state = project(5)
    expect(state.pos).toEqual(expect.objectContaining({ x: 50, y: 25 }))
    expect(state.friendly).toBe(true)
    expect(state.recorder).toBe(true)
    expect(state.hullScreenDeg).toBe(10)
    expect(state.turretScreenDeg).toBe(30)
    expect(state.markerStyle).toEqual(expect.objectContaining({ left: '50%', top: '25%' }))
  })

  it('位姿通道优先：位置/朝向取 pose，可信度仍取 canonical（含最后观测时刻）', () => {
    // canonical 原始观测位于 (100,60) 之间，位姿通道给出 (7,-4)：标记必须落在位姿通道值上
    const state = project(5, undefined, { x: 7, y: -4, yawRad: Math.PI / 2, turretRelRad: 0 })
    expect(state.pos).toEqual(expect.objectContaining({ x: 7, y: -4 }))
    expect(state.hullScreenDeg).toBeCloseTo(90, 9)          // π/2 rad → 90°
    expect(state.turretScreenDeg).toBeCloseTo(90, 9)
    expect(state.covered).toBe(true)                        // canonical 观测窗口内
    expect(state.lastKnown).toBe(false)
  })

  it('位姿通道在场时炮塔恒可画（canonical 缺 prop2 不再导致整层消失）', () => {
    const state = project(5,
      [{ startSec: 0, endSec: 10, knowledge: 'CURRENT', samples: [
        { timeSec: 0, hullYawDeg: 45, turretRelativeYawDeg: null },
      ] }],
      { x: 1, y: 2, yawRad: Math.PI / 4, turretRelRad: -Math.PI / 6 })
    expect(state.hullScreenDeg).toBeCloseTo(45, 9)
    // 45° + (−30°) = 15°：炮塔朝向来自位姿通道（上游保证 turret_yaw 与车体同长）
    expect(state.turretScreenDeg).toBeCloseTo(15, 9)
  })

  it('位姿通道缺该车（def 缺失 → null）时回退 canonical 观测', () => {
    const withPose = project(5, undefined, null)
    const withoutPose = project(5)
    expect(withPose.pos).toEqual(withoutPose.pos)
    expect(withPose.hullScreenDeg).toBe(withoutPose.hullScreenDeg)
    expect(withPose.turretScreenDeg).toBe(withoutPose.turretScreenDeg)
  })

  it('最后已知时段：位置可由位姿通道更新，timeSec 仍是 canonical 的最后观测时刻', () => {
    const state = project(
      9,
      [{ startSec: 0, endSec: 4, knowledge: 'LAST_KNOWN', samples: [
        { timeSec: 0, hullYawDeg: 10, turretRelativeYawDeg: 20 },
      ] }],
      { x: -3, y: 8, yawRad: 0, turretRelRad: 0 },
      [{ startSec: 0, endSec: 4, knowledge: 'LAST_KNOWN', samples: [{ timeSec: 0, x: 5, y: 5 }] }],
    )
    expect(state.lastKnown).toBe(true)   // canonical 观测区间（失察）
    expect(state.pos.timeSec).toBe(0)    // 最后观测时刻（canonical 权威）
    expect(state.pos.x).toBe(-3)         // 位置值来自位姿通道
  })

  it('returns null before the first observed canonical position', () => {
    expect(project(-1)).toBeNull()
  })

  it('keeps nullable turret direction unknown instead of turning it into hull direction', () => {
    const state = project(5, [{ startSec: 0, endSec: 10, knowledge: 'OBSERVED', samples: [
      { timeSec: 0, hullYawDeg: 45, turretRelativeYawDeg: null },
    ] }])
    expect(state.hullScreenDeg).toBe(45)
    expect(state.turretScreenDeg).toBeNull()
  })

  it('keeps unknown hull direction null', () => {
    const state = project(5, [{ startSec: 0, endSec: 10, knowledge: 'OBSERVED', samples: [
      { timeSec: 0, hullYawDeg: null, turretRelativeYawDeg: 20 },
    ] }])
    expect(state.hullScreenDeg).toBeNull()
    expect(state.turretScreenDeg).toBeNull()
  })

  it('does not synthesize a zero direction for a destroyed vehicle without orientation', () => {
    const state = projectVehicleState({
      vehicle: { accountId: 7, team: 1, playerName: 'Player', tankId: 123, tankName: 'Tank' },
      track: {
        friendly: true,
        positionSegments: [{ startSec: 0, endSec: 10, knowledge: 'OBSERVED', samples: [
          { timeSec: 0, x: 0, y: 0 }, { timeSec: 10, x: 100, y: 50 },
        ] }],
        orientationSegments: [],
        lifeTransitions: [{ timeSec: 0, lifeState: 'DESTROYED', destroyedKnownAtSec: 0 }],
      },
      time: 5,
      recorderAccountId: 7,
      model: null,
      hullImage: 'friendly-hull',
      turretImage: 'friendly-turret',
      markerLeft: (x) => `${x}%`,
      markerTop: (y) => `${y}%`,
      markerTransform: 'translate(-50%, -50%)',
      overlayInverseScale: 'scale(1)',
      overlayInverse: 1,
      translate: (key) => key,
    })
    expect(state.hullScreenDeg).toBeNull()
    expect(state.turretScreenDeg).toBeNull()
  })

  it('uses canonical track.friendly even when team differs from the perspective team', () => {
    const state = projectVehicleState({
      vehicle: { accountId: 7, team: 2, playerName: 'Player', tankId: 123, tankName: 'Tank' },
      track: {
        friendly: true,
        positionSegments: [{ startSec: 0, endSec: 10, knowledge: 'OBSERVED', samples: [
          { timeSec: 0, x: 0, y: 0 }, { timeSec: 10, x: 100, y: 50 },
        ] }],
        orientationSegments: [],
        lifeTransitions: [],
      },
      time: 5,
      recorderAccountId: null,
      friendlyTeam: 1,
      model: null,
      hullImage: 'friendly-hull',
      turretImage: 'friendly-turret',
      markerLeft: (x) => `${x}%`,
      markerTop: (y) => `${y}%`,
      markerTransform: 'translate(-50%, -50%)',
      overlayInverseScale: 'scale(1)',
      overlayInverse: 1,
      translate: (key) => key,
    })
    expect(state.friendly).toBe(true)
  })
})
