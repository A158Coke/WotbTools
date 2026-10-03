import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import { DMG_ASPECT, DMG_FRAC, dmgWorldHeight, floatDmgAnim } from './floatDmg.js'

describe('伤害飘字 · 动画与尺寸', () => {
  it('出生弹出：0.72 起，18% 生命周期内升到 1.0 并此后保持（单调不回退）', () => {
    expect(floatDmgAnim(0).pop).toBeCloseTo(0.72, 6)
    expect(floatDmgAnim(0.09).pop).toBeGreaterThan(0.72)
    expect(floatDmgAnim(0.09).pop).toBeLessThan(1)
    expect(floatDmgAnim(0.18).pop).toBeCloseTo(1, 6)
    expect(floatDmgAnim(0.6).pop).toBeCloseTo(1, 6)
    let prev = -1
    for (let k = 0; k <= 1.0001; k += 0.02) {
      const pop = floatDmgAnim(k).pop
      expect(pop).toBeGreaterThanOrEqual(prev)
      prev = pop
    }
  })

  it('不透明度：前 50% 全不透明，其后线性淡出到 0（中途比全程线性更不透明）', () => {
    expect(floatDmgAnim(0).opacity).toBe(1)
    expect(floatDmgAnim(0.5).opacity).toBe(1)
    expect(floatDmgAnim(0.5).opacity).toBeGreaterThan(0.5)
    expect(floatDmgAnim(0.75).opacity).toBeCloseTo(0.5, 6)
    expect(floatDmgAnim(1).opacity).toBe(0)
  })

  it('越界 k 被钳到 [0,1]，不产生 NaN', () => {
    expect(floatDmgAnim(-1).opacity).toBe(1)
    expect(floatDmgAnim(2).opacity).toBe(0)
    expect(Number.isFinite(floatDmgAnim(0).pop)).toBe(true)
    expect(Number.isFinite(floatDmgAnim(1).pop)).toBe(true)
  })

  it('屏幕占比恒定：世界高度与距离成正比 → 任意距离的屏上像素一致', () => {
    const fov = 55
    const halfTan = Math.tan((fov * Math.PI) / 360)
    for (const d of [10, 50, 200, 800]) {
      expect(dmgWorldHeight(d, fov) / (2 * halfTan * d)).toBeCloseTo(DMG_FRAC, 9)
    }
    expect(dmgWorldHeight(0, fov)).toBeCloseTo(0.05, 9)
  })

  it('贴图保持 2:1（精灵不被拉伸）', () => {
    expect(DMG_ASPECT).toBe(2)
  })
})

// 场景内核依赖 WebGL，无法直接实例化；与 labelOcclusion.test.js 同例，对"飘字层级"
// 这一无法用纯函数覆盖的接线做源码级守卫——本 PR 修的正是这条接线（数字曾被名牌挡住）。
describe('伤害飘字 · 覆盖层层级（回归守卫）', () => {
  const here = dirname(fileURLToPath(import.meta.url))
  const src = readFileSync(resolve(here, 'playbackScene.js'), 'utf8')
  // 出生规格（renderOrder/renderOrder 载体）在 makeFloatDmgFx（池工厂）里，一并纳入切片
  const spawn = src.slice(src.indexOf('function makeFloatDmgFx'), src.indexOf('// 同源触发 HP 条反馈'))

  it('飘字挂在标签覆盖画布（labelScene）：主场景内 renderOrder 压不过独立画布', () => {
    expect(spawn).toMatch(/labelScene\.add\(sp\);/)
    expect(spawn).not.toMatch(/scene\.add\(sp\);/)
  })

  it('renderOrder 高于标签（999），同层内压在名牌之上', () => {
    const m = spawn.match(/sp\.renderOrder = (\d+);/)
    expect(m).toBeTruthy()
    expect(Number(m[1])).toBeGreaterThan(999)
  })

  it('移除路径与挂载路径同一层（updateTransients / clearTransients 不得留 scene.remove）', () => {
    // 池化后：移除路径只 scene/labelScene.remove + 归还池，dispose 统一在 disposeFxPool
    expect(src).toMatch(/labelScene\.remove\(f\.sp\);/)
    expect(src).toMatch(/fxGive\('floatDmg'/)
    expect(src).not.toMatch(/scene\.remove\(f\.sp\)/)
  })

  it('标签开关只切名牌精灵，不整层隐藏（否则关名牌会连坐飘字）', () => {
    expect(src).toMatch(/setLabels: \(on\) => \{/)
    expect(src).not.toMatch(/labelScene\.visible = on/)
  })

  it('逐帧尺寸走屏幕占比恒定式，并套用弹出曲线', () => {
    expect(src).toMatch(/dmgWorldHeight\(camera\.position\.distanceTo\(f\.sp\.position\), camera\.fov\) \* pop/)
    expect(src).toMatch(/const \{ pop, opacity \} = floatDmgAnim\(k\);/)
  })
})
