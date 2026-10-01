import { describe, expect, it } from 'vitest'
import { isPlaceholderVehicleName, resolveVehicleName, vehicleNameIndex } from './hofVehicles.js'

describe('hofVehicles', () => {
  it('treats backend "#id" fallbacks and empty names as placeholders', () => {
    expect(isPlaceholderVehicleName('#4657')).toBe(true)
    expect(isPlaceholderVehicleName(' ')).toBe(true)
    expect(isPlaceholderVehicleName(null)).toBe(true)
    expect(isPlaceholderVehicleName('T-34 #2')).toBe(false)
    expect(isPlaceholderVehicleName('Progetto 65')).toBe(false)
  })

  it('resolves the first real name among the candidates', () => {
    expect(resolveVehicleName('#4657', undefined, 'Kranvagn')).toBe('Kranvagn')
    expect(resolveVehicleName('FV4005', 'Other')).toBe('FV4005')
    expect(resolveVehicleName('#4657', '')).toBe('')
  })

  it('indexes only real names and keeps the first occurrence', () => {
    const index = vehicleNameIndex([
      { tankId: 1, tankName: '#1' },
      { tankId: 2, tankName: 'Maus' },
      { tankId: 2, tankName: 'Other' },
    ], 'tankId', 'tankName')
    expect(index.has(1)).toBe(false)
    expect(index.get(2)).toBe('Maus')
  })
})
