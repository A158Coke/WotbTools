import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import {
  DMG_ASPECT, DMG_FRAC, DMG_INK_RATIO, dmgWorldHeight, floatDmgAnim, worldPerScreenPx,
} from './floatDmg.js'

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

  it('墨迹占比 < 1：盒高含透明留白，贴名牌摆位要按数字真实高度算', () => {
    expect(DMG_INK_RATIO).toBeGreaterThan(0)
    expect(DMG_INK_RATIO).toBeLessThan(1)
  })
})

describe('伤害飘字 · 屏幕像素 → 世界长度', () => {
  const fov = 55
  const viewportH = 900

  it('与 dmgWorldHeight 同一投影关系：perPx × 视口高 × DMG_FRAC = 飘字世界高', () => {
    for (const d of [10, 50, 200, 800]) {
      expect(worldPerScreenPx(d, fov, viewportH) * viewportH * DMG_FRAC).toBeCloseTo(dmgWorldHeight(d, fov), 9)
    }
  })

  it('与距离成正比：同一像素偏移在任何距离都落成同样的屏上位移', () => {
    const near = worldPerScreenPx(50, fov, viewportH)
    expect(worldPerScreenPx(200, fov, viewportH)).toBeCloseTo(near * 4, 9)
    expect(worldPerScreenPx(800, fov, viewportH)).toBeCloseTo(near * 16, 9)
  })

  it('视口高缺失 / 距离非法 → 0，不把 NaN 写进 sprite 位置', () => {
    expect(worldPerScreenPx(100, fov, 0)).toBe(0)
    expect(worldPerScreenPx(100, fov, undefined)).toBe(0)
    expect(worldPerScreenPx(100, fov, NaN)).toBe(0)
    expect(worldPerScreenPx(-5, fov, viewportH)).toBe(0)
    expect(worldPerScreenPx(NaN, fov, viewportH)).toBe(0)
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

  /**
   * 名牌与飘字共用同一个覆盖场景（`labelScene`），所以"关名牌"必须有明确边界：
   * 只把它自己的呈现层关掉，**绝不** `labelScene.visible = false`——否则飘字
   * （renderOrder 1001，战斗反馈）会被连坐隐藏。
   *
   * 3D 名牌改为 HTML 覆盖层后，场景侧只剩两件事：`store.labelsOn` 门控 anchor 发布，
   * 以及 overlay 的 `hidden`；两者都不触碰 labelScene 的整层可见性。
   */
  it('标签开关不得整层隐藏覆盖场景（否则关名牌会连坐飘字）', () => {
    expect(src).toMatch(/store\.labelsOn = enabled;/)
    // anchor 发布被 labelsOn 门控（关名牌 = 不发 anchor = overlay 全隐藏）
    expect(src).toMatch(/const visible = v\.group\.visible && store\.labelsOn && w > 0/)
    // 飘字仍挂在覆盖场景上，且 renderOrder 高于名牌
    expect(src).toMatch(/labelScene\.add\(sp\);/)
    // 任何情况下都不得整层隐藏该场景
    expect(src).not.toMatch(/labelScene\.visible = /)
    expect(src).not.toMatch(/setLabels:/)
  })

  it('逐帧尺寸走屏幕占比恒定式，并套用弹出曲线', () => {
    expect(src).toMatch(/const worldH = dmgWorldHeight\(d, camera\.fov\) \* pop;/)
    expect(src).toMatch(/const \{ pop, opacity \} = floatDmgAnim\(k\);/)
    expect(src).toMatch(/placeFloatDmg\(f, k, pop\);/)
  })
})

/**
 * 名牌迁到 HTML 覆盖层之后，canvas 里的 renderOrder 再也压不住它——飘字只能靠几何
 * 避让：落在该车名牌块顶边之上。这组守卫锁的就是这条无法用纯函数覆盖的接线
 *（线上表现：伤害数字被名牌盖掉上半截，只露出下沿）。
 */
describe('伤害飘字 · 避开名牌块（回归守卫）', () => {
  const here = dirname(fileURLToPath(import.meta.url))
  const src = readFileSync(resolve(here, 'playbackScene.js'), 'utf8')
  const place = src.slice(src.indexOf('function placeFloatDmg'), src.indexOf('// 同源触发 HP 条反馈'))

  it('出生时量一次名牌块高（每帧读 offsetHeight 会把同步布局拖进渲染循环）', () => {
    expect(place).toMatch(/labelOverlay\?\.labelHeight\?\.\(eid\) \|\| 0/)
    expect(place).toMatch(/labelPx/)
  })

  it('起跳点 = 名牌块高 + 间隙，上浮量是屏幕像素而非世界单位', () => {
    expect(place).toMatch(/f\.labelPx \+ DMG_LABEL_GAP_PX \+ k \* DMG_RISE_PX/)
    expect(place).toMatch(/worldPerScreenPx\(d, camera\.fov, container\.clientHeight\)/)
  })

  it('沿相机 up 偏移：俯视镜头下世界 y 近乎指向相机，沿它抬高不产生屏上位移', () => {
    expect(place).toMatch(/dmgUpScratch\.set\(0, 1, 0\)\.applyQuaternion\(camera\.quaternion\)/)
    expect(place).not.toMatch(/baseY/)   // 世界空间锚点已退役
  })

  it('与名牌共用同一个抬升事实源（labelLiftWorld），两者不各算各的', () => {
    expect(place).toMatch(/labelLiftWorld\(d\)/)
    const labels = src.slice(src.indexOf('function updateLabels'), src.indexOf('function buildVehicles'))
    expect(labels).toMatch(/v\.labelAnchor\.y \+= labelLiftWorld\(d\);/)
  })
})
