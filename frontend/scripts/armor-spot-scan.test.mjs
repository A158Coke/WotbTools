// 部位像素扫描（门禁的 findSpotsExpr）选择逻辑单测：用假 window/document + 假射线
// 确定性驱动表达式，锁定「首选主装甲优先于次选」与「首选齐备即早退」两条性质。
// 回归背景（评审 PR #563 P2）：次选（仅间隙甲/外部模块像素）曾会占住部位槽位，
// 使后扫到的主装甲像素写不进去 → 真实车辆上炮塔/炮管落到屏幕上，丢掉主装甲短按覆盖。
import { describe, expect, it } from 'vitest'
import { buildFindSpotsExpr } from './armor-spot-scan.mjs'
import { ArmorSection, isPrimary } from '../src/scene/penetration.js'

const PRIMARY_SECTIONS = [ArmorSection.HULL, ArmorSection.TURRET, ArmorSection.GUN]

/** 命中表：`"x,y"` → { hits: [{name, sec}], cls }；未列出的像素 = 未击中。 */
function fakePage(table, { width = 80, height = 80 } = {}) {
  const calls = []
  const window = {
    __armorRicochet: {
      __raytrace(px, py) {
        calls.push({ px, py })
        return table[`${px},${py}`]?.hits ?? []
      },
      __aimPart(px, py) {
        return table[`${px},${py}`]?.cls ?? null
      },
    },
  }
  const document = {
    querySelector: () => ({ width, height, getBoundingClientRect: () => ({ left: 0, top: 0 }) }),
  }
  return { window, document, calls }
}

const runScan = (expr, page) => {
  const evaluate = new Function('window', 'document', `return (${expr})`)
  return evaluate(page.window, page.document)
}

const hit = (name, sec, cls) => ({ hits: [{ name, sec }], cls })
const spacedOnly = (name, cls) => hit(name, ArmorSection.SPACED, cls)

describe('部位像素扫描（首选主装甲优先）', () => {
  it('次选像素先出现、主装甲像素后出现 → 最终选主装甲（primary:true）', () => {
    const table = {
      '20,28': spacedOnly('turret_01_armor_2', 'turret'),   // 先扫到：悬空间隙甲屏幕板
      '28,28': hit('turret_01_armor_1', ArmorSection.TURRET, 'turret'),
      '20,20': hit('gun_01_armor_1', ArmorSection.GUN, 'gun'),
      '36,20': hit('hull_armor_1', ArmorSection.HULL, null),
    }
    const page = fakePage(table)
    const res = runScan(buildFindSpotsExpr({ need: ['gun', 'turret', 'hull'], primarySections: PRIMARY_SECTIONS }), page)
    expect(res.turret.name).toBe('turret_01_armor_1')
    expect(res.turret.primary).toBe(true)
    expect(res.gun.primary).toBe(true)
    expect(res.hull.primary).toBe(true)
  })

  it('该部位只有次选像素时，返回次选并记 primary:false（调用方按"不构成判定"断言）', () => {
    const table = {
      '20,20': hit('gun_01_armor_1', ArmorSection.GUN, 'gun'),
      '28,20': spacedOnly('turret_01_armor_2', 'turret'),          // 炮塔只有间隙甲像素
      '36,20': hit('hull_armor_1', ArmorSection.HULL, null),
      '20,28': spacedOnly('turret_01_armor_3', 'turret'),          // 细扫也拿不到主装甲像素
    }
    const page = fakePage(table)
    const res = runScan(buildFindSpotsExpr({ need: ['gun', 'turret', 'hull'], primarySections: PRIMARY_SECTIONS }), page)
    expect(res.turret.name).toBe('turret_01_armor_2')
    expect(res.turret.primary).toBe(false)
  })

  it('首选齐备即早退（不做细扫）——整帧双射线在 CI 慢 runner 上是 20s+ 量级', () => {
    const table = {
      '20,20': hit('gun_01_armor_1', ArmorSection.GUN, 'gun'),
      '28,20': hit('turret_01_armor_1', ArmorSection.TURRET, 'turret'),
      '36,20': hit('hull_armor_1', ArmorSection.HULL, null),
    }
    const page = fakePage(table)
    const res = runScan(buildFindSpotsExpr({ need: ['gun', 'turret', 'hull'], primarySections: PRIMARY_SECTIONS }), page)
    expect(res.gun.primary && res.turret.primary && res.hull.primary).toBe(true)
    expect(page.calls.length).toBe(3)     // 第三个像素齐备 → 立即返回，不继续扫
  })

  it('need 裁剪：只要 turret 时，找到即停（触屏视口窄只用得到的部位）', () => {
    const table = {
      '20,20': spacedOnly('turret_01_armor_2', 'turret'),
      '28,20': hit('turret_01_armor_1', ArmorSection.TURRET, 'turret'),
    }
    const page = fakePage(table)
    const res = runScan(buildFindSpotsExpr({ need: ['turret'], primarySections: PRIMARY_SECTIONS }), page)
    expect(res.turret.primary).toBe(true)      // 次选先出现不占位，首选后到即用首选
    expect(res.gun).toBeNull()
    expect(page.calls.length).toBe(2)
  })

  it('传入门禁与产品同源的分类（isPrimary 自检可作为门禁启动断言）', () => {
    expect(PRIMARY_SECTIONS.every(isPrimary)).toBe(true)
    expect(isPrimary(ArmorSection.SPACED)).toBe(false)
  })
})
