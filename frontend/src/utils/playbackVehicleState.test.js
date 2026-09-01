import { describe, expect, it } from 'vitest'
import { projectVehicleState } from './playbackVehicleState'

const project = (time) => projectVehicleState({
  vehicle: { accountId: 7, team: 1, playerName: 'Player', tankId: 123, tankName: 'Tank' },
  track: {
    friendly: true,
    positionSegments: [{ startSec: 0, endSec: 10, knowledge: 'OBSERVED', samples: [
      { timeSec: 0, x: 0, y: 0 }, { timeSec: 10, x: 100, y: 50 },
    ] }],
    orientationSegments: [{ startSec: 0, endSec: 10, knowledge: 'OBSERVED', samples: [
      { timeSec: 0, hullYawDeg: 10, turretRelativeYawDeg: 20 },
    ] }],
    lifeTransitions: [],
  },
  time,
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

  it('returns null before the first observed canonical position', () => {
    expect(project(-1)).toBeNull()
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
