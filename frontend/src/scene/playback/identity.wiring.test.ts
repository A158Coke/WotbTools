// 宿主接线守卫（评审 4594363745）：`replacedAt` 身份判据必须注入 **createVehicleRuntime**
// （唯一消费方），不得落在 createTreadRuntime（不读取该字段 → 生产走回退、单测绿而无效果）。
//
// 仓库既有先例：源文本断言（cameraPreset.test.js / supremacyPoints.test.js）用于锁定
// 「哪个工厂/模块消费哪个依赖」这类不可从纯函数单测观察的接线事实。
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, it, expect } from 'vitest'
import { playbackSceneSource } from '../__tests__/sceneSource.ts'

const scene = playbackSceneSource()
const runtime = readFileSync(
  fileURLToPath(new URL('./vehicleRuntime.ts', import.meta.url)),
  'utf8',
)

/** 截取 `factoryName({` 起、按括号配平到 `})` 的实参块。 */
function callBlock(source: string, factoryName: string): string {
  const start = source.indexOf(`${factoryName}({`)
  expect(start, `${factoryName} call not found`).toBeGreaterThanOrEqual(0)
  let i = source.indexOf('{', start)
  let depth = 0
  for (; i < source.length; i++) {
    if (source[i] === '{') depth++
    else if (source[i] === '}') {
      depth--
      if (depth === 0) return source.slice(start, i + 1)
    }
  }
  throw new Error(`unbalanced braces after ${factoryName}`)
}

describe('replacedAt 注入车辆运行时（评审 4594363745）', () => {
  it('createVehicleRuntime 的依赖显式携带 replacedAt', () => {
    const block = callBlock(scene, 'createVehicleRuntime')
    expect(block).toMatch(/replacedAt:\s*\(eid,\s*t\)\s*=>\s*replacedAt\(eid,\s*t\)/)
  })

  it('createTreadRuntime 不得携带 replacedAt（它不消费该字段）', () => {
    const block = callBlock(scene, 'createTreadRuntime')
    expect(block).not.toMatch(/replacedAt:/)
  })
})

describe('最后已知幽灵的身份证据刷新（评审 4594553219）', () => {
  it('memo 条件包含身份结果，同一 T 的证据晚到也会重算', () => {
    // 只按 T 记忆会把「同一时刻 canonical 身份稍后就绪」挡在门外（旧反例）
    expect(runtime).toMatch(/v\.lastKnownAt !== T \|\| v\.lastReplaced !== replacedNow/)
    // 身份结果必须在 memo 之前计算（先算后判，而不是只在分支内使用）
    const replacedAt = runtime.indexOf('const replacedNow = deps.replacedAt')
    const memo = runtime.indexOf('v.lastKnownAt !== T || v.lastReplaced !== replacedNow')
    expect(replacedAt).toBeGreaterThanOrEqual(0)
    expect(replacedAt).toBeLessThan(memo)
  })
})
