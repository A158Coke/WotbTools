import { describe, expect, it } from 'vitest'
import { matchesSnapshot, mobilityVehicle, moduleIdentity, readSeed, selectionQuery, vehicleColor } from './tankMobility'
import { simulate, speedAt } from '../replay-local/compute/mobility'
import research from '../replay-local/compute/__fixtures__/research/consumables.json'
import ussr from '../replay-local/compute/__fixtures__/modules/ussr.json'

const modules = ussr.tanks['T-34']
const selection = {
  canConfigure: true, config: 0, engine: 0, track: 0, turret: 0, gun: 0, shell: 0,
  devices: Array(9).fill(null), consumables: ['afterburning'], provisions: [], skills: {},
  conditionalSkills: false, camouflage: false,
}
const input = {
  modules, engineIdx: 0, trackIdx: 0, turretIdx: 0, gunIdx: 0,
  deviceIds: [], provisionStems: [], provisionScripts: {}, skillLevels: {}, crewRoles: modules.crewRoles,
  consumableStems: selection.consumables,
  consumableScripts: Object.fromEntries(research.items.map(item => [item.stem, item.script])),
}
const catalog = { consumables: research.items, devices: [] }
describe('mobility loadout handoff and boost timing', () => {
  it('retains module identities and rejects stale modules, silently clamped indices and invalid seeds', () => {
    const entry = { id: 'one', tank: 1, dataset: 'fixture', stems: moduleIdentity(modules, selection), config: selectionQuery(selection) }
    expect(matchesSnapshot(readSeed(JSON.stringify({ v: 1, vehicle: entry })), modules, selection)).toBe(true)
    expect(matchesSnapshot({ ...entry, stems: ['obsolete'] }, modules, selection)).toBe(false)
    expect(matchesSnapshot({ ...entry, config: { ...entry.config, engine: 99 } }, modules, selection)).toBe(false)
    expect(readSeed(JSON.stringify({ v: 1, vehicle: { ...entry, config: { cons: 'invalid' } } }))).toBeNull()
  })
  it('uses distinct light and dark strokes for an extra vehicle with a yellow hue', () => {
    const id = '1d66edf1-48d0-494e-ac52-de65e780ee28'
    const stroke = vehicleColor(id, 4)
    expect(stroke).toBe('light-dark(hsl(60 65% 30%), hsl(60 75% 72%))')
    expect(vehicleColor(id, 12)).toBe(stroke)
  })
  it('separates a carried boost from a delayed activation and carries speed through expiry', () => {
    const passive = mobilityVehicle({ input, catalog })
    const timed = mobilityVehicle({ input, catalog, activations: { afterburning: 2.015 } })
    expect(passive.carried).toMatchObject([{ stem: 'afterburning', window: undefined }])
    expect(timed.carried).toMatchObject([{ stem: 'afterburning', window: { start: 2.015, end: 14.015 } }])
    expect(passive.phases).toHaveLength(1)
    expect(timed.phases.map(p => p.start)).toEqual([0, 2.015, 14.015])
    expect(timed.phases[0].input.power).toBe(passive.mobility.power)
    expect(timed.phases[1].input.power).toBeCloseTo(passive.mobility.power * 1.2, 10)
    expect(timed.phases[2].input.power).toBe(passive.mobility.power)
    const base = simulate(passive.phases, 'Firm'), boost = simulate(timed.phases, 'Firm')
    expect(speedAt(boost.speeds, 2)).toBe(speedAt(base.speeds, 2))
    expect(speedAt(boost.speeds, 5)).toBeGreaterThan(speedAt(base.speeds, 5))
    expect(speedAt(boost.speeds, 14.04)).toBeGreaterThan(0)
  })
  it('ends the modeled interval when an expired higher speed cap would require unknown deceleration', () => {
    const { mobility } = mobilityVehicle({ input, catalog })
    const at = simulate([{ start: 0, input: { ...mobility, limit: 40 } }, { start: 15, input: { ...mobility, limit: 5 } }], 'Firm')
    expect(at.status).toBe('unsupported')
    expect(speedAt(at.speeds, 16)).toBeNull()
  })
})
