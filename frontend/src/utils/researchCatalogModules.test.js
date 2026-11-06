import { beforeEach, describe, expect, it, vi } from 'vitest'

const json = vi.hoisted(() => vi.fn())

vi.mock('../scene/assetProvider.js', () => ({
  assetProvider: { json },
}))

import { loadResearchCatalog, loadTankModules } from './researchCatalog.js'

describe('loadTankModules：逐车模块来自资产包', () => {
  beforeEach(() => {
    json.mockReset()
  })

  it('按国别请求资产包 /research/modules/{nation}.json，并缓存 Promise', async () => {
    const data = { tanks: { 'T-34': { tankId: 1 } } }
    json.mockResolvedValue(data)
    const first = loadTankModules('ussr')
    const second = loadTankModules('ussr')
    expect(second).toBe(first)
    await expect(first).resolves.toEqual(data)
    expect(json).toHaveBeenCalledTimes(1)
    expect(json).toHaveBeenCalledWith('/research/modules/ussr.json')
  })

  it('请求失败后清除缓存，下一次可重试', async () => {
    json.mockRejectedValueOnce(new Error('HTTP 404'))
    await expect(loadTankModules('germany')).rejects.toThrow('HTTP 404')
    json.mockResolvedValueOnce({ tanks: {} })
    await expect(loadTankModules('germany')).resolves.toEqual({ tanks: {} })
    expect(json).toHaveBeenCalledTimes(2)
  })
})

it('分别保留物品目录版本，不能把旧设备目录版本当成 XI 机制的来源', async () => {
  json.mockImplementation(async path => {
    if (path.endsWith('devices.json')) return { meta: { gameVersion: 'live' }, devices: [], presets: {} }
    if (path.endsWith('consumables.json')) return { meta: { gameVersion: 'preview-consumables' }, items: [] }
    if (path.endsWith('provisions.json')) return { meta: { gameVersion: 'preview-provisions' }, items: [] }
    if (path.endsWith('camouflage.json')) return { categories: {} }
    if (path.endsWith('skills.json')) return { items: {}, classes: {} }
    return {}
  })
  const catalog = await loadResearchCatalog()
  expect(catalog.gameVersion).toBe('live')
  expect(catalog.consumablesGameVersion).toBe('preview-consumables')
  expect(catalog.provisionsGameVersion).toBe('preview-provisions')
})
