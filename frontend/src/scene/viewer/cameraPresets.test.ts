import { describe, expect, it } from 'vitest'
import { armorCameraPreset } from './cameraPresets'

describe('armor camera presets', () => {
  it('faces the gun level from the front at the reference distance', () => {
    expect(armorCameraPreset('front', 2, 15, { down: -10, up: 20 })).toEqual({
      pitch: 0, position: [0, 2, -15], target: [0, 2, 0],
    })
  })
  it.each([-5, -10, -13])('uses the active depression %s without changing distance', down => {
    const preset = armorCameraPreset('hull_down', 2, 15, { down, up: 20 })
    expect(preset.pitch).toBe(down)
    const [, y, z] = preset.position
    expect(Math.hypot(y - 2, z)).toBeCloseTo(15)
    expect(Math.atan2(y - 2, -z) * 180 / Math.PI).toBeCloseTo(down)
  })
  it('keeps vehicles without depression level', () => {
    expect(armorCameraPreset('hull_down', 2, 15, { down: 0, up: 20 }).pitch).toBe(0)
  })
})
