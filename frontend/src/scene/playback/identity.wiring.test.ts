import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, it, expect } from 'vitest'
import { playbackSceneSource } from '../__tests__/sceneSource.ts'

const scene = playbackSceneSource()
const runtime = readFileSync(
  fileURLToPath(new URL('./vehicleRuntime.ts', import.meta.url)),
  'utf8',
)

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
    expect(runtime).toMatch(/v\.lastKnownAt !== T \|\| v\.lastReplaced !== replacedNow/)
    const replacedAt = runtime.indexOf('const replacedNow = deps.replacedAt')
    const memo = runtime.indexOf('v.lastKnownAt !== T || v.lastReplaced !== replacedNow')
    expect(replacedAt).toBeGreaterThanOrEqual(0)
    expect(replacedAt).toBeLessThan(memo)
  })
})
