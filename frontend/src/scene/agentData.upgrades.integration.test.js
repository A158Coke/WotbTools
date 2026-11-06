import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fetchTankData } from './agentData.js'
import { assetProvider } from './assetProvider.js'
import fixtures from '../replay-local/compute/__fixtures__/upgrades/tanks.json'

const research = vi.hoisted(() => ({ modules: vi.fn() }))
vi.mock('./assetProvider.js', () => ({ assetProvider: { json: vi.fn() } }))
vi.mock('../utils/researchCatalog.js', async original => ({
  ...(await original()), loadTankModules: research.modules,
}))

beforeEach(() => { assetProvider.json.mockReset(); research.modules.mockReset() })

describe('armor asset loader with official XI upgrade modules', () => {
  // Module/upgrade nodes are exact client exports. Detail armor/shell values are
  // controlled mapping inputs, as stated by this fixture's manifest.
  it('projects Object 432U armor, pitch and shell data without mutating its initial data', async () => {
    const { detail, modules } = fixtures.find(item => item.modules.tankId === 27905)
    const before = JSON.stringify(detail)
    assetProvider.json.mockResolvedValue(detail)
    research.modules.mockResolvedValue({ tanks: { [modules.stem]: modules } })
    const [initial, max] = await Promise.all([
      fetchTankData(27905), fetchTankData(27905, { upgrade: 'top' }),
    ])
    expect(initial).toBe(detail)
    // Client COMMON nodes: armor +3% +5%; upper pitch +5°, lower pitch +1°.
    expect(max.armor_model.hull.plates['1']).toBeCloseTo(108)
    expect(max.configs[0].turret_plates['1']).toBeCloseTo(216)
    expect(max.configs[0].pitch_limits).toMatchObject({ min: -20, max: 8 })
    expect(max.configs[0].shells[0]).toMatchObject({ damage: 410, velocity: 950 })
    expect(max.model).toBe(initial.model)
    expect(JSON.stringify(detail)).toBe(before)
  })
})
