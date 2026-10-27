import { beforeEach, describe, expect, it, vi } from 'vitest'
import DEVICES from '../replay-local/compute/__fixtures__/research/devices.json'
import CONSUMABLES from '../replay-local/compute/__fixtures__/research/consumables.json'
import PROVISIONS from '../replay-local/compute/__fixtures__/research/provisions.json'
import SKILLS from '../replay-local/compute/__fixtures__/research/skills.json'
import CAMOUFLAGE from '../replay-local/compute/__fixtures__/research/camouflage.json'
import FORMAT from '../replay-local/compute/__fixtures__/research/params/format.json'
import STRUCTURE from '../replay-local/compute/__fixtures__/research/params/structure.json'

const json = vi.hoisted(() => vi.fn())
vi.mock('../scene/assetProvider.js', () => ({ assetProvider: { json } }))

import { loadResearchCatalog } from './researchCatalog.js'

const FILES = {
  '/research/devices.json': DEVICES,
  '/research/consumables.json': CONSUMABLES,
  '/research/provisions.json': PROVISIONS,
  '/research/params/format.json': FORMAT,
  '/research/params/structure.json': STRUCTURE,
  '/research/camouflage.json': CAMOUFLAGE,
  '/research/skills.json': SKILLS,
}

describe('loadResearchCatalog：全局配置器目录来自资产包', () => {
  beforeEach(() => {
    json.mockReset()
    json.mockImplementation(async path => FILES[path])
  })

  it('从资产包 research/*.json 组装目录，不在 common 内静态 import', async () => {
    const catalog = await loadResearchCatalog()
    expect(json).toHaveBeenCalledTimes(7)
    for (const path of Object.keys(FILES)) expect(json).toHaveBeenCalledWith(path)
    expect(catalog.devices).toHaveLength(DEVICES.devices.length)
    expect(catalog.devicePresets.defaultPreset).toBeTruthy()
    expect(catalog.consumables).toHaveLength(CONSUMABLES.items.length)
    expect(catalog.skills.desperado.effects.vehicleHealthFraction).toBe(0.15)
    expect(catalog.paramsFormat.turretRotationSpeed.units).toBe('DEGREE_PER_SECOND')
  })
})
