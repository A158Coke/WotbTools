import { describe, expect, it } from 'vitest'
import { previewBatch } from './mobilityBatch'
import { availableItems } from '../utils/researchCatalog'
import devices from '../replay-local/compute/__fixtures__/research/devices.json'
import food from '../replay-local/compute/__fixtures__/research/provisions.json'
import consumables from '../replay-local/compute/__fixtures__/research/consumables.json'

const entry = { id: 'target', tank: 7, dataset: 'wg', alias: 'my build', activations: { afterburning: 4 } }
function vehicle(nation, stem, preset = 'defaultPreset') {
  const ref = { nation, stem, tier: 10, tankId: 7, tags: ['mediumTank'] }
  return {
    modules: { turrets: [{ stem: 'T', guns: [{ stem: 'G' }] }], chassis: [{ stem: 'C' }], engines: [{ stem: 'E' }] },
    slots: devices.presets[preset], devices: devices.devices, provisionSlots: 3, consumableSlots: 3,
    provisions: availableItems(food.items, ref), consumables: availableItems(consumables.items, ref),
    selection: { canConfigure: true, config: 0, engine: 0, track: 0, turret: 0, gun: 0, shell: 2,
      devices: Array(9).fill(null), provisions: [], consumables: ['afterburning'], skills: { virtuoso: 3 }, camouflage: true },
  }
}
describe('cross-vehicle loadout mapping', () => {
  it('maps both food grades to the unique legal Polish or Czech item', () => {
    const source = vehicle('ussr', 'Object_140')
    source.selection.provisions = ['ration','condensed_milk','improved_fuel']
    for (const [stem, grade] of [['Pl21_CS_63', 'polish'], ['Cz04_T50_51','czech']]) {
      const target = vehicle('european', stem)
      const { next, differences } = previewBatch('provisions','wg',source,entry,target)
      expect(next, JSON.stringify(differences)).toBeDefined()
      expect(next.config.prov).toEqual(['ration_' + grade + '_hq','ration_' + grade + '_regular','improved_fuel'])
      expect(next).toMatchObject({ id: 'target', tank: 7, alias: 'my build', activations: entry.activations,
        config: { shell: 2, skills: { virtuoso: 3 }, cons: ['afterburning'], dev: '' } })
    }
  })
  it('skips the complete group for special oil, ambiguous food, capacity and dataset failures', () => {
    const source = vehicle('european','Pl21_CS_63'), target = vehicle('ussr','Object_140')
    source.selection.provisions = ['improved_fuel','improvedGearOil']
    target.selection.provisions = ['condensed_milk']
    const batch = () => previewBatch('provisions','wg',source,entry,target)
    expect(batch().next).toBeUndefined()
    expect(batch().differences).toContainEqual(expect.objectContaining({reason:'unsupportedItem'}))
    source.selection.provisions = ['ration_polish_hq']
    target.provisions.push({ ...target.provisions.find(i => i.stem === 'ration'), stem:'duplicate' })
    expect(batch().differences).toContainEqual(expect.objectContaining({reason:'ambiguous'}))
    source.selection.provisions = ['improved_fuel']
    target.provisionSlots = 0
    expect(batch().differences).toContainEqual(expect.objectContaining({reason:'capacity'}))
    expect(previewBatch('devices','other',source,entry,target).next).toBeUndefined()
    expect(target.selection.provisions).toEqual(['condensed_milk'])
  })
  it('uses slot identity and item stems, preserving special suspension but clearing a supported slot', () => {
    const source = vehicle('ussr','Object_140'), target = vehicle('european','Pl21_CS_63','AlternatePitchGrouserPreset')
    source.selection.devices[0] = 0
    target.selection.devices[1] = 0
    target.selection.devices[2] = 1
    const [first, second] = target.slots
    target.slots = [second, { ...first, left:first.right, right:first.left }, ...target.slots.slice(2)]
    target.selection.devices = [0, null, 1, null, null, null, null, null, null]
    const apply = () => previewBatch('devices','wg',source,entry,target)
    expect(apply().next.config.dev).toBe('-11')
    expect(apply().differences).toContainEqual(expect.objectContaining({reason:'unsupportedSlot'}))
    source.selection.devices[2] = 0
    expect(apply().differences).toContainEqual(expect.objectContaining({reason:'unsupportedSlot'}))
    expect(target.selection.devices[0]).toBe(0)
  })
  it('only copies carried consumables and keeps activation times of retained items', () => {
    const source = vehicle('ussr','Object_140'), target = vehicle('ussr','Object_140')
    source.selection.consumables = ['afterburning','largeRepairkit']
    expect(previewBatch('consumables','wg',source,entry,target).next.activations).toEqual({afterburning:4})
    source.selection.consumables = ['largeRepairkit']
    expect(previewBatch('consumables','wg',source,entry,target).next.activations).toEqual({})
    source.selection.consumables = ['nonexistent']
    expect(previewBatch('consumables','wg',source,entry,target).next).toBeUndefined()
  })
})
