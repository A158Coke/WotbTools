import { describe, expect, it } from 'vitest'
import { shouldResetShellOnConfigChange } from './armorShellSelection.js'

describe('shouldResetShellOnConfigChange', () => {
  it('射手换炮时弹表必变，清除 shell', () => {
    expect(shouldResetShellOnConfigChange({ side: 'shooter', configChanged: true })).toBe(true)
  })

  it('受击方换炮保留射击方 shell（同车型检视也不得清除）', () => {
    expect(shouldResetShellOnConfigChange({ side: 'target', configChanged: true })).toBe(false)
  })

  it('受击方只换发动机/履带（configChanged=false）不清除 shell', () => {
    expect(shouldResetShellOnConfigChange({ side: 'target', configChanged: false })).toBe(false)
    expect(shouldResetShellOnConfigChange({ side: 'shooter', configChanged: false })).toBe(false)
  })
})
