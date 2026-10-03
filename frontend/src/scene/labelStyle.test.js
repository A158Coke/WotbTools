import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import { DEAD_GRAY, labelVisual } from './labelStyle.js'

describe('3D 名牌样式 · 存活 vs 阵亡', () => {
  it('存活：保留队色与装填条、无删除线', () => {
    const s = labelVisual(false)
    expect(s.nameColor).toBeNull()          // null = 用队色
    expect(s.namePrefix).toBe('')
    expect(s.showReload).toBe(true)
    expect(s.strike).toBe(false)
    expect(s.flash).toBe(true)
    expect(s.hpTextColor).toBe('#fff')
  })

  it('阵亡：去队色（名字/数字转中性灰）', () => {
    const s = labelVisual(true)
    expect(s.nameColor).toBe(DEAD_GRAY)
    expect(s.hpTextColor).toBe(DEAD_GRAY)
    expect(s.namePrefix).toBe('✝ ')
  })

  it('阵亡：卡片删除线在场，且卡面/描边与存活不同', () => {
    const dead = labelVisual(true), alive = labelVisual(false)
    expect(dead.strike).toBe(true)
    expect(dead.strikeW).toBeGreaterThan(0)
    expect(dead.cardFill).not.toBe(alive.cardFill)
    expect(dead.cardStroke).not.toBe(alive.cardStroke)
    expect(dead.cardStrokeW).not.toBe(alive.cardStrokeW)
  })

  it('阵亡：不画装填条、不触发受击闪（阵亡车不会再掉血/装填）', () => {
    const dead = labelVisual(true)
    expect(dead.showReload).toBe(false)
    expect(dead.flash).toBe(false)
  })

  it('两套样式的字段集合一致（调用方无需按分支取字段）', () => {
    expect(Object.keys(labelVisual(true)).sort()).toEqual(Object.keys(labelVisual(false)).sort())
  })
})

// 场景内核依赖 WebGL，无法实例化；沿用本仓源码级接线守卫先例（labelOcclusion / floatDmg）。
// 纯函数测试锁样式值，这里锁"绘制确实用了这套样式"——否则样式改了也会被静默绕过。
describe('3D 名牌样式 · 接线守卫', () => {
  const here = dirname(fileURLToPath(import.meta.url))
  const src = readFileSync(resolve(here, 'playbackScene.js'), 'utf8').replace(/\/\/[^\n]*/g, '')

  it('drawLabel 走 labelVisual(dead)：卡面/描边/删除线/名字色/血槽/数字/装填条/闪都取自样式', () => {
    // makeLabel 定义在 drawLabel 之前 → 用固定窗口取 drawLabel 函数体
    const at = src.indexOf('function drawLabel')
    const draw = src.slice(at, at + 6000)
    expect(draw).toMatch(/const st = labelVisual\(dead\);/)
    expect(draw).toMatch(/ctx\.fillStyle = st\.cardFill;/)
    expect(draw).toMatch(/ctx\.strokeStyle = flashing \? 'rgba\(255,255,255,\.5\)' : st\.cardStroke;/)
    expect(draw).toMatch(/if \(st\.strike\) \{/)
    expect(draw).toMatch(/const name = st\.namePrefix \+ /)
    expect(draw).toMatch(/ctx\.fillStyle = st\.nameColor \|\| teamText;/)
    expect(draw).toMatch(/ctx\.fillStyle = st\.hpTrackFill;/)
    expect(draw).toMatch(/ctx\.fillStyle = st\.hpTextColor;/)
    expect(draw).toMatch(/if \(st\.showReload && friendly && shells && shells\.length\)/)
    expect(draw).toMatch(/const flashing = st\.flash && /)
  })

  it('删除线必须在所有内容之后绘制（否则被不透明的血条/数字盖住）', () => {
    const at = src.indexOf('function drawLabel')
    const draw = src.slice(at, at + 6000)
    const strikeAt = draw.indexOf('if (st.strike) {')
    const needsUpdateAt = draw.indexOf('v.label.material.map.needsUpdate = true;')
    expect(strikeAt).toBeGreaterThan(-1)
    expect(needsUpdateAt).toBeGreaterThan(-1)
    expect(strikeAt).toBeLessThan(needsUpdateAt)   // 线在收尾之前、且在血条/文字之后
    const tail = draw.slice(strikeAt, needsUpdateAt)
    expect(tail).not.toMatch(/(fillText|strokeText|ctx\.fill\(\))/)   // 之后不得再有绘制
  })
})
