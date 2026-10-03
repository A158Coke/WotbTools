import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import {
  DEAD_GRAY, LABEL_DESIGN, LABEL_DESIGN_H, LABEL_DESIGN_W, labelTexHeight, labelVisual,
  minLabelFrac, vehicleLabelRows,
} from './labelStyle.js'

describe('3D 名牌样式 · 存活 vs 阵亡', () => {
  it('存活：保留队色与装填条、无删除线', () => {
    const s = labelVisual(false)
    expect(s.nameColor).toBeNull()          // null = 用队色
    expect(s.namePrefix).toBe('')
    expect(s.showReload).toBe(true)
    expect(s.strike).toBe(false)
    expect(s.flash).toBe(true)
    expect(s.hpTextColor).toBe('#ffffff')
  })

  it('阵亡：去队色（名字/数字转中性灰）', () => {
    const s = labelVisual(true)
    expect(s.nameColor).toBe(DEAD_GRAY)
    expect(s.hpTextColor).toBe(DEAD_GRAY)
    expect(s.hpPctColor).toBe(DEAD_GRAY)
    expect(s.namePrefix).toBe('✝ ')
  })

  it('阵亡：不画装填条、不触发受击闪（阵亡车不会再掉血/装填）', () => {
    const dead = labelVisual(true)
    expect(dead.showReload).toBe(false)
    expect(dead.flash).toBe(false)
    expect(dead.strike).toBe(true)
    expect(dead.strikeW).toBeGreaterThan(0)
  })

  it('两套样式的字段集合一致（调用方无需按分支取字段）', () => {
    expect(Object.keys(labelVisual(true)).sort()).toEqual(Object.keys(labelVisual(false)).sort())
  })
})

/**
 * 2026-02 呈现重做：**不得再把整张卡片铺成不透明黑底**。
 *
 * 旧实现给 512×140 的卡片整体铺 `rgba(0,0,0,.55)`（阵亡 .78），14 车同屏时等于在
 * 战场上盖十几块黑板，遮住地形 / 车模 / 弹道。现在只保留两个小圆角胶囊
 * （血量数字底 + 血条空槽），两者都按内容尺寸绘制。这条回归锁"底层不再有大面积底色"。
 */
describe('3D 名牌样式 · 没有大面积不透明底', () => {
  it('只暴露按内容尺寸绘制的小底色（数字胶囊 / 血条空槽），没有整卡 fill', () => {
    const s = labelVisual(false)
    expect(s).not.toHaveProperty('cardFill')
    expect(s).not.toHaveProperty('cardStroke')
    expect(s).not.toHaveProperty('cardStrokeW')
    expect(s).toHaveProperty('hpPillFill')
    expect(s).toHaveProperty('hpTrackFill')
  })

  it('底色 alpha 保持在"垫一小块"的量级：任何档位都不超过 0.45，阵亡档不得比存活档更黑', () => {
    const alpha = (css) => Number(/rgba?\([^)]*?,\s*([\d.]+)\s*\)/.exec(css)?.[1] ?? 1)
    for (const dead of [false, true]) {
      const s = labelVisual(dead)
      expect(alpha(s.hpPillFill), `dead=${dead} hpPillFill`).toBeLessThanOrEqual(0.45)
      expect(alpha(s.hpTrackFill), `dead=${dead} hpTrackFill`).toBeLessThanOrEqual(0.45)
    }
    expect(alpha(labelVisual(true).hpPillFill)).toBeLessThanOrEqual(alpha(labelVisual(false).hpPillFill))
  })
})

describe('3D 名牌 · 行开关（共享偏好）', () => {
  it('默认：玩家昵称关、坦克名开、血量开、装填开（与 usePlaybackPreferences 默认一致）', () => {
    expect(vehicleLabelRows(undefined, false)).toEqual({
      player: false, tank: true, hp: true, reload: true,
    })
  })

  it('显式偏好逐项生效', () => {
    const prefs = { showPlayerName: true, showTankName: false, showHp: false, showReload: false }
    expect(vehicleLabelRows(prefs, false)).toEqual({
      player: true, tank: false, hp: false, reload: false,
    })
  })

  it('阵亡车永远不画装填条（哪怕偏好开着）', () => {
    expect(vehicleLabelRows({ showReload: true }, true).reload).toBe(false)
  })
})

describe('3D 名牌 · 卡片定标', () => {
  it('设计高/宽与行高自洽（三行 + 血条 + 装填条的合计）', () => {
    const D = LABEL_DESIGN
    const expected = D.padTop + D.padBottom + D.rowName * 2 + D.rowHp + D.gapBar + D.barH
      + D.gapReload + D.reloadH
    expect(LABEL_DESIGN_H).toBe(expected)
    expect(LABEL_DESIGN_W).toBeGreaterThan(0)
  })

  it('贴图高度夹在设计像素与屏幕像素×超采样之间（不超采样到设计高以上）', () => {
    expect(labelTexHeight(26, 1, 1.5)).toBe(Math.min(LABEL_DESIGN_H, 39))
    expect(labelTexHeight(200, 2, 1.5)).toBe(LABEL_DESIGN_H)   // 大屏也不会超过设计高
    expect(labelTexHeight(26, 1, 1.5)).toBeGreaterThan(0)
  })

  it('可读下限：屏上最小高度系数随视口变高而变小，且换算回屏幕像素恒等于下限', () => {
    const frac653 = minLabelFrac(653)
    const frac1300 = minLabelFrac(1300)
    expect(frac653).toBeGreaterThan(frac1300)
    // 653 视口 + 下限系数 → 恰好是下线像素数
    expect(frac653 * 653 * LABEL_DESIGN_H).toBeCloseTo(26, 6)
  })
})

// 场景内核依赖 WebGL，无法实例化；沿用本仓源码级接线守卫先例（labelOcclusion / floatDmg）。
// 纯函数测试锁样式值，这里锁"绘制确实用了这套样式"——否则样式改了也会被静默绕过。
describe('3D 名牌样式 · 接线守卫', () => {
  const here = dirname(fileURLToPath(import.meta.url))
  const src = readFileSync(resolve(here, 'playbackScene.js'), 'utf8').replace(/\/\/[^\n]*/g, '')

  const drawBody = () => {
    // makeLabel 定义在 drawLabel 之前 → 用固定窗口取 drawLabel 函数体
    const at = src.indexOf('function drawLabel')
    expect(at).toBeGreaterThan(-1)
    return src.slice(at, at + 9000)
  }

  it('drawLabel 走 labelVisual(dead) + vehicleLabelRows：卡面/文字/血槽/数字/百分比/装填/闪都取自样式', () => {
    const draw = drawBody()
    expect(draw).toMatch(/const st = labelVisual\(dead\);/)
    expect(draw).toMatch(/const rows = vehicleLabelRows\(labelPrefs, dead\);/)
    expect(draw).toMatch(/ctx\.fillStyle = st\.hpPillFill;/)
    expect(draw).toMatch(/ctx\.fillStyle = st\.hpTrackFill;/)
    expect(draw).toMatch(/st\.nameColor \|\| teamText/)
    expect(draw).toMatch(/st\.hpTextColor/)
    expect(draw).toMatch(/st\.hpPctColor/)
    expect(draw).toMatch(/if \(st\.strike\) \{/)
    expect(draw).toMatch(/rows\.reload && friendly && !!shells && shells\.length > 0/)
    expect(draw).toMatch(/if \(rows\.player\) \{/)
    expect(draw).toMatch(/if \(rows\.tank\) \{/)
    expect(draw).toMatch(/if \(rows\.hp\) \{/)
  })

  it('drawLabel 不得再引用已废弃的整卡底色字段（回归：黑卡不得复活）', () => {
    const draw = drawBody()
    expect(draw).not.toMatch(/cardFill/)
    expect(draw).not.toMatch(/cardStroke/)
  })

  /**
   * 回归：`LABEL_DESIGN_W is not defined`。
   *
   * 场景内核依赖 WebGL，现有测试都只读源码文本，**从不执行 drawLabel**——于是 drawLabel 里
   * 引用一个没进 import 列表的常量时全部单测照绿，只有真实加载回放才炸
   * 「回放加载失败：LABEL_DESIGN_W is not defined」。
   *
   * 真正的检查在 `scripts/check-label-identifiers.mjs`（声明集比对：import 绑定 + 模块级
   * const/let/var/function/class vs 绘制区引用的 CONSTANT_CASE 标识符）。这里只负责让它
   * 进入测试门禁——脚本同样可以在 CI/本地单独跑。
   */
  it('名牌绘制区引用的每个模块级常量都有声明（scripts/check-label-identifiers.mjs）', () => {
    const scriptPath = resolve(here, '../../scripts/check-label-identifiers.mjs')
    const res = spawnSync(
      process.execPath,
      [scriptPath, resolve(here, 'playbackScene.js')],
      { encoding: 'utf8' },
    )
    const out = `${res.stdout || ''}${res.stderr || ''}`.trim()
    expect(res.status, out).toBe(0)
    expect(out).toContain('label identifier check OK')
  })

  it('删除线必须在所有内容之后绘制（否则被不透明的血条/数字盖住）', () => {
    const draw = drawBody()
    const strikeAt = draw.indexOf('if (st.strike) {')
    const needsUpdateAt = draw.indexOf('v.label.material.map.needsUpdate = true;')
    expect(strikeAt).toBeGreaterThan(-1)
    expect(needsUpdateAt).toBeGreaterThan(-1)
    expect(strikeAt).toBeLessThan(needsUpdateAt)   // 线在收尾之前、且在血条/文字之后
    const tail = draw.slice(strikeAt, needsUpdateAt)
    expect(tail).not.toMatch(/(fillText|strokeText|ctx\.fill\(\))/)   // 之后不得再有绘制
  })

  it('偏好变化必须使名牌重绘：setLabelPrefs 置脏并重算贴图尺寸', () => {
    expect(src).toMatch(/function setLabelPrefs\(next\)/)
    expect(src).toMatch(/v\.labelDirty = true; v\.reloadT = null;/)
    expect(src).toMatch(/setLabelPrefs: \(prefs\) => \{/)
  })
})
