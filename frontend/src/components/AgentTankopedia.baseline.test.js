import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const source = readFileSync(fileURLToPath(new URL('./AgentTankopedia.vue', import.meta.url)), 'utf8')

describe('AgentTankopedia comparison baseline', () => {
  it('加载/换车过渡清空上一辆车的 delta 基线', () => {
    expect(source).toMatch(/let lastTankId = null/)
    expect(source).toMatch(/if \(!value \|\| tankId !== lastTankId\)/)
    expect(source).toMatch(/previousCharacteristics\.value = null/)
  })
})
