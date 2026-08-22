import { describe, expect, it } from 'vitest'
import tankopedia from '../../../common/tankopedia-tier10.json'
import { hasVehiclePortrait, loadVehiclePortrait } from './runtime.js'

describe('Tier X Details Panel vehicle portraits', () => {
  it('覆盖 Tankopedia 中全部 Tier X tankId', () => {
    expect(tankopedia.meta.count).toBe(tankopedia.vehicles.length)
    for (const vehicle of tankopedia.vehicles) {
      expect(hasVehiclePortrait(vehicle.id), `${vehicle.id} ${vehicle.name} 缺车型图`).toBe(true)
    }
  })

  it('非法或非 Tier X tankId 静默返回 null', async () => {
    expect(hasVehiclePortrait(null)).toBe(false)
    expect(hasVehiclePortrait('not-a-tank')).toBe(false)
    await expect(loadVehiclePortrait(-1)).resolves.toBeNull()
    await expect(loadVehiclePortrait(999999999)).resolves.toBeNull()
  })

  it('已收录车型返回 Vite 资产 URL', async () => {
    const url = await loadVehiclePortrait(tankopedia.vehicles[0].id)
    expect(typeof url).toBe('string')
    expect(url).toMatch(/\.webp(?:\?|$)/)
  })
})
