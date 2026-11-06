import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fetchShells, fetchTankData } from './agentData.js'
import { assetProvider } from './assetProvider.js'

const upgrades = vi.hoisted(() => ({ project: vi.fn(), modules: vi.fn() }))
vi.mock('./assetProvider.js', () => ({ assetProvider: { json: vi.fn() } }))
vi.mock('../utils/researchCatalog.js', () => ({ loadTankModules: upgrades.modules }))
vi.mock('../replay-local/compute/tankSetup', () => ({
  findTankModules: (nation, id) => nation.tanks[id] || null,
}))
vi.mock('../replay-local/compute/tankUpgrades', () => ({ projectTankUpgrades: upgrades.project }))

const raw = {
  tank_id: 15153, tier: 11, nation: 'china',
  configs: [{ caliber: 130, pitch_limits: { min: -7, max: 15 }, hull_plates: { 1: 100 }, shells: [{ type: 'ap', penetration: 250, damage: 460 }] }],
}
const projected = {
  ...raw,
  configs: [{ ...raw.configs[0], pitch_limits: { min: -9, max: 16 }, hull_plates: { 1: 110 }, shells: [{ type: 'ap', penetration: 280, damage: 480 }] }],
}
const moduleData = { upgradeProgression: {} }

beforeEach(() => {
  assetProvider.json.mockReset().mockResolvedValue(raw)
  upgrades.modules.mockReset().mockResolvedValue({ tanks: { 15153: moduleData } })
  upgrades.project.mockReset().mockReturnValue({ detail: projected, modules: moduleData, selection: { available: true, supported: true, unsupported: [] } })
})

describe('explicit XI armor data selection', () => {
  it('keeps old links and ordinary vehicles on their original request path', async () => {
    expect(await fetchTankData(15153)).toBe(raw)
    const ordinary = { ...raw, tier: 10 }
    assetProvider.json.mockResolvedValueOnce(ordinary)
    expect(await fetchTankData(15153, { upgrade: 'top' })).toBe(ordinary)
    expect(upgrades.modules).not.toHaveBeenCalled()
    expect(upgrades.project).not.toHaveBeenCalled()
  })

  it('shares only raw in-flight data while projecting one side independently', async () => {
    const stockRequest = fetchTankData(15153)
    const topRequest = fetchTankData(15153, { upgrade: 'top', abilities: '101,201' })
    const [stock, top] = await Promise.all([stockRequest, topRequest])
    expect(assetProvider.json).toHaveBeenCalledExactlyOnceWith('/tank/15153.json')
    expect(upgrades.modules).toHaveBeenCalledExactlyOnceWith('china')
    expect(upgrades.project).toHaveBeenCalledWith(raw, moduleData, 'top', '101,201')
    expect(stock).toBe(raw)
    expect(top).toBe(projected)
    expect(stock.configs[0].pitch_limits.min).toBe(-7)
    expect(top.configs[0].pitch_limits.min).toBe(-9)
    expect(await fetchTankData(15153)).toBe(raw)
    expect(assetProvider.json).toHaveBeenCalledTimes(2)
  })

  it('uses upgraded ammunition in the shell fallback too', async () => {
    const result = await fetchShells(15153, { upgrade: 'top', abilities: [101] })
    expect(upgrades.project).toHaveBeenCalledWith(raw, moduleData, 'top', [101])
    expect(result.caliber).toBe(130)
    expect(result.shells[0]).toMatchObject({ penetration: 280, damage: 480 })
  })

  it('keeps raw data when the legacy pack has no module catalog at all', async () => {
    upgrades.modules.mockRejectedValueOnce(new Error('HTTP 404 /research/modules/china.json'))
    await expect(fetchTankData(15153, { upgrade: 'top' })).resolves.toBe(raw)
  })

  it('keeps raw data when the asset pack has no upgradeProgression', async () => {
    upgrades.project.mockReturnValueOnce({
      detail: raw, modules: moduleData,
      selection: { available: false, supported: true, unsupported: [] },
    })
    await expect(fetchTankData(15153, { upgrade: 'top' })).resolves.toBe(raw)
  })

  it('rejects unsupported max data rather than labeling stock as max', async () => {
    upgrades.project.mockReturnValueOnce({
      detail: raw, modules: moduleData,
      selection: { available: true, supported: false, unsupported: ['UnknownUpgradeScript'] },
    })
    await expect(fetchTankData(15153, { upgrade: 'top' })).rejects.toThrow('XI upgrade data unavailable')
  })
})
