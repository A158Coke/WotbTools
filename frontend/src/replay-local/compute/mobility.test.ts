import { describe, it, expect } from 'vitest'
import cases from './__fixtures__/mobility-wg-11.21.0_1.json'
import { computeCharacteristics, type ComputeInput } from './characteristics'
import { effectivePower, intersections, simulate, terrains, type Mobility } from './mobility'

type Vehicle = typeof cases[number]
function loadout(car: Vehicle, fueled: boolean): ComputeInput {
  const turret = (weight: number, gun: number) => ({ stats: { weight }, guns: [{ stats: { weight: gun } }] })
  const p = car.parts
  const s = car.stock
  return {
    modules: {
      hull: { weight: p[0] }, speedLimits: { forward: car.forward },
      engines: [{ stats: { weight: s[1], power: car.stockEngine } }, { stats: { weight: p[1], power: car.engine } }],
      chassis: [{ stats: { weight: s[2] } }, { stats: { weight: p[2], terrainResistance: car.resistance, rotationSpeed: car.rotation } }],
      turrets: [turret(s[3], s[4]), turret(p[3], p[4])],
      radios: [{ stats: { weight: p[5] } }], fuelTanks: [{ stats: { weight: p[6] } }],
    },
    engineIdx: 1, trackIdx: 1, turretIdx: 1, gunIdx: 0, crewRoles: car.crew,
    provisionStems: fueled ? ['improved_fuel', ...(car.blue ? ['improvedGearOil'] : ['smallFood']), 'bigFood'] : [],
    provisionScripts: {
      bigFood: { params: { bonusValues: { crewLevelIncrease: 10 } } },
      smallFood: { params: { bonusValues: { crewLevelIncrease: 3 } } },
    },
    deviceIds: [], consumableStems: [], consumableScripts: {}, standardShell: null,
    isBurstGun: false, camouflage: false, vehicleClass: car.light ? 'lightTank' : 'mediumTank',
  }
}

describe('BlitzInfo WG 11.21.0_1', () => {
  it.each(cases)('$key matches the source inputs and all terrain segments', car => {
    const base: Mobility = computeCharacteristics(loadout(car, false))._mobility
    expect(base.mass).toBeCloseTo(car.mass, 7)
    expect(base.power).toBe(car.power)
    expect(base.limit).toBe(car.limit)
    const actual: Mobility = computeCharacteristics(loadout(car, true))._mobility
    for (const [i, terrain] of terrains.entries()) {
      expect(base.permeability[terrain]).toBeCloseTo(car.baseC[i], 7)
      expect(base.traverse[terrain]).toBeCloseTo(car.hull * car.resistance[0] / car.resistance[1] * car.baseC[i] / car.baseC[1], 6)
      const run = simulate([{ start: 0, input: actual }], terrain)
      const expected = car.segments[terrain]
      let previous = 0
      for (const [j, threshold] of [20, 40, car.light ? 60 : 50, actual.limit].entries()) {
        const index = run.speeds.findIndex(v => v >= threshold! - 3.6e-9)
        if (expected[j] === null) {
          expect(index).toBe(-1)
          expect(run.status).toBe('unreachable')
        } else {
          expect((index - previous) * 0.02).toBeCloseTo(expected[j]!, 8)
          previous = index
        }
      }
    }
  })
  it('keeps partial terrain data and rejects incomplete mass', () => {
    const input = loadout(cases[0], true)
    delete input.modules.radios[0].stats.weight
    const result = computeCharacteristics(input)
    expect(effectivePower(result._mobility, 'Firm')).toBeNull()
    expect(simulate([{ start: 0, input: result._mobility }], 'Firm').status).toBe('missing')
  })
  it('reports crossings, touches and overlap intervals', () => {
    expect(intersections([0, 2, 2, 4, 5, 5], [0, 1, 3, 4, 5, 5])).toEqual([[0.03, 0.03], [0.06, 0.1]])
  })
})
