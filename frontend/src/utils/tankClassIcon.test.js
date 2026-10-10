import { describe, expect, it } from 'vitest'
import { tankClassIcon } from './tankClassIcon.js'

describe('shared tactical tank classes', () => {
  it.each([
    ['LT', 'lightTank', 'LIGHT_TANK', 'Light tank'],
    ['MT', 'mediumTank', 'MEDIUM_TANK', 'Medium tank'],
    ['HT', 'heavyTank', 'HEAVY_TANK', 'Heavy tank'],
    ['TD', 'AT-SPG', 'TANK_DESTROYER', 'Tank destroyer'],
  ])('presents annotation %s and decoded vehicle types identically', (key, ...types) => {
    const icon = tankClassIcon(key)
    expect(icon?.key).toBe(key)
    for (const type of types) expect(tankClassIcon(type)).toBe(icon)
  })

  it('never guesses a class from a tank name, ID or missing data', () => {
    for (const value of [undefined, null, '', 19217, 'E 100', 'unknown', 'toString']) {
      expect(tankClassIcon(value)).toBeNull()
    }
  })
})
