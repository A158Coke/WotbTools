import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import { firstIndexAfter } from './seekPointer.js'

const here = dirname(fileURLToPath(import.meta.url))

describe('firstIndexAfter（seek 游标语义）', () => {
  // 评审要求的场景：事件在 10 / 20 / 30s，seek 到 25s
  const events = [{ t: 10 }, { t: 20 }, { t: 30 }]

  it('seek 到 25s：跳过 10/20，指向 30s（不经补播历史 transient）', () => {
    const ptr = firstIndexAfter(events, 25)
    expect(ptr).toBe(2)
    // 被跳过的全部 <= 25；指针处的事件 > 25（跨过时才会触发）
    expect(events.slice(0, ptr).every((e) => e.t <= 25)).toBe(true)
    expect(events[ptr].t).toBe(30)
  })

  it('跨过 30s 后仍会触发该事件（不是被永久丢弃）', () => {
    const ptr = firstIndexAfter(events, 25)
    // 复刻 tick 的消费条件：t <= T 才消费
    let p = ptr
    const fired = []
    for (const T of [26, 28, 30, 31]) {
      while (p < events.length && events[p].t <= T) fired.push(events[p++].t)
    }
    expect(fired).toEqual([30])
  })

  it('边界：早于全部事件 / 晚于全部事件 / 恰好在事件时刻', () => {
    expect(firstIndexAfter(events, 5)).toBe(0)      // 还没到 → 全部待触发
    expect(firstIndexAfter(events, 35)).toBe(3)     // 全过 → 游标到底
    expect(firstIndexAfter(events, 10)).toBe(1)     // 恰好等于：该事件视为已发生（与射击游标同式）
    expect(firstIndexAfter([], 10)).toBe(0)         // 空表不越界
  })

  it('支持自定义取时刻函数（射击用 t_fire）', () => {
    const shots = [{ t_fire: 10 }, { t_fire: 20 }, { t_fire: 30 }]
    expect(firstIndexAfter(shots, 25, (s) => s.t_fire)).toBe(2)
  })
})

describe('playbackScene.seekTo 的游标接线（防回归）', () => {
  // 场景内核依赖 WebGL，无法直接实例化；此仓已有源码级契约测试的先例
  // （见 AgentReplay3D 主题契约测试）。此处断言 seekTo 把**三个**游标都重定——
  // 只重定 shotPtr 是 PR #411 的 P0：transient 游标被 clearEffects 归零后会被
  // 紧随的 tick() 补播全部历史事件。
  const src = readFileSync(resolve(here, 'playbackScene.js'), 'utf8')
  const seekTo = src.slice(src.indexOf('function seekTo'), src.indexOf('function seekTo') + 900)

  it('三个游标（射击/伤害/击毁）都重定到 seek 时刻之后', () => {
    expect(seekTo).toMatch(/shotPtr\s*=\s*firstIndexAfter\(DATA\.shots, T,/)
    expect(seekTo).toMatch(/dmgPtr\s*=\s*firstIndexAfter\(dmgEvents, T\)/)
    expect(seekTo).toMatch(/burstPtr\s*=\s*firstIndexAfter\(burstEvents, T\)/)
  })

  it('clearEffects 会清空 transient 状态与游标（seek 不补播的另一半）', () => {
    expect(src).toMatch(/function clearEffects\(\)[\s\S]{0,1200}?clearTransients\(\)/)
    expect(src).toMatch(/function clearTransients\(\)[\s\S]{0,900}?dmgPtr = 0; burstPtr = 0;/)
  })
})

describe('边界 fail-closed（PR #411 P0-2）', () => {
  const src = readFileSync(resolve(here, 'playbackScene.js'), 'utf8')

  it('buildBoundary 对空边界只清理不绘制', () => {
    expect(src).toMatch(/function buildBoundary\(bounds, thick\) \{\s*clearBoundary\(\);\s*if \(!bounds\) return;/)
  })

  it('调用点一律传权威 playableBoundsFor()，不再有车辆/地形范围兜底', () => {
    const calls = [...src.matchAll(/buildBoundary\(([^;]*?), BOUNDARY_THICK\)/gs)].map((m) => m[1].trim())
    expect(calls.length).toBeGreaterThan(0)
    for (const arg of calls) expect(arg).toBe('playableBoundsFor()')
    // 兜底对象（车辆 ext / terrain span）不得再出现在边界构造里
    expect(src).not.toMatch(/buildBoundary\(\{\s*cx, cz, hx: ext/)
    expect(src).not.toMatch(/hx: \(\(heightMeta && heightMeta\.span\)/)
  })
})

describe('相机距离钳制（PR #411 P1-3）', () => {
  const src = readFileSync(resolve(here, 'playbackScene.js'), 'utf8')

  it('设置 controls.minDistance / maxDistance 且基于 ext', () => {
    expect(src).toMatch(/controls\.minDistance = Math\.max\(20, ext \* 0\.08\)/)
    expect(src).toMatch(/controls\.maxDistance = ext \* 2\.2/)
    expect(src).toMatch(/applyCameraClamp\(\);/)
  })
})

describe('ricochet sparks 定位（PR #411 P1-4）', () => {
  const src = readFileSync(resolve(here, 'playbackScene.js'), 'utf8')

  it('子物体用局部偏移（不再叠加 tr.to），朝向用 yaw 而非 lookAt', () => {
    expect(src).toMatch(/sp\.position\.set\(side\.x \* sgn \* 1\.1, 0, side\.z \* sgn \* 1\.1\)/)
    expect(src).toMatch(/sp\.rotation\.y = Math\.atan2\(side\.x \* sgn, side\.z \* sgn\)/)
    // 组仍在 tr.to；spark 不得再引用世界坐标 tr.to
    expect(src).not.toMatch(/sp\.position\.copy\(tr\.to/)
    expect(src).not.toMatch(/sp\.lookAt\(tr\.to/)
  })
})
