import { beforeEach, describe, expect, it, vi } from 'vitest'

const json = vi.hoisted(() => vi.fn())

vi.mock('../scene/assetProvider.js', () => ({
  assetProvider: { json },
}))

import { loadTankModules } from './researchCatalog.js'

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
