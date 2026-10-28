import { describe, expect, it } from 'vitest'
import { shouldResetShellOnConfigChange } from './armorShellSelection.js'

const base = { side: 'target', configChanged: true, sameTank: true, explicitShooterConfig: false }

describe('shouldResetShellOnConfigChange', () => {
  it('射手换炮时弹表必变，清除 shell', () => {
    expect(shouldResetShellOnConfigChange({ ...base, side: 'shooter', explicitShooterConfig: true })).toBe(true)
  })

  it('普通同车检视未独立选炮时，受击方换配置会同步射手弹表', () => {
    expect(shouldResetShellOnConfigChange(base)).toBe(true)
  })

  it('独立 scfg 下受击方换配置不改变射手弹表，保留 shell', () => {
    expect(shouldResetShellOnConfigChange({ ...base, explicitShooterConfig: true })).toBe(false)
  })

  it('非同车检视的受击方换配置不影响射手弹表', () => {
    expect(shouldResetShellOnConfigChange({ ...base, sameTank: false })).toBe(false)
  })

  it('配置未变化时不清除 shell', () => {
    expect(shouldResetShellOnConfigChange({ ...base, configChanged: false })).toBe(false)
  })
})
