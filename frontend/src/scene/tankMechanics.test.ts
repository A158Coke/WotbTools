import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import {
  damageFactorAt,
  mechanicLang,
  mechanicParamValues,
  mechanicTextFor,
  renderMechanicText,
  shellMechanicKind,
  trayShellDamage,
  trayShellFor,
} from './tankMechanics'

const SECTORS = [
  { distance: 50, factor: 1.4 },
  { distance: 120, factor: 1.2 },
  { distance: 200, factor: 1.0 },
  { distance: 720, factor: 0.8 },
]
const TRAY = {
  name: 'TrayShell',
  kinds: ['ARMOR_PIERCING_CR'],
  sectors: SECTORS,
  localizationValues: {
    ParamName1: '50', ParamName2: '140', ParamName3: '50', ParamName4: '120',
    ParamName5: '120', ParamName6: '120', ParamName7: '200', ParamName8: '100',
    ParamName9: '200', ParamName10: '80',
  },
}
const OTHER = { name: 'ImprovedDetection' }

describe('tankMechanics：弹种与机制匹配', () => {
  it('type_id 权威优先；标准/金币 APCR 都是 ARMOR_PIERCING_CR', () => {
    expect(shellMechanicKind({ type: 'ap_cr', type_id: 1 })).toBe('ARMOR_PIERCING_CR')
    expect(shellMechanicKind({ type: 'ap_cr_premium', type_id: 1 })).toBe('ARMOR_PIERCING_CR')
    expect(shellMechanicKind({ type: 'ap' })).toBe('ARMOR_PIERCING')
    expect(shellMechanicKind({ type: 'he' })).toBe('HIGH_EXPLOSIVE')
    // type_id 优先于 icon token（客户端 field9 权威）
    expect(shellMechanicKind({ type: 'ap', type_id: 1 })).toBe('ARMOR_PIERCING_CR')
    expect(shellMechanicKind({ type: 'unknown' })).toBeNull()
  })

  it('TrayShell 只匹配 kinds 内的弹种；HE/AP 不匹配', () => {
    expect(trayShellFor([OTHER, TRAY], { type: 'ap_cr', type_id: 1 })?.name).toBe('TrayShell')
    expect(trayShellFor([TRAY], { type: 'ap', type_id: 0 })).toBeNull()
    expect(trayShellFor([TRAY], { type: 'he', type_id: 3 })).toBeNull()
    expect(trayShellFor([OTHER], { type: 'ap_cr', type_id: 1 })).toBeNull()
    expect(trayShellFor([{ ...TRAY, sectors: [] }], { type: 'ap_cr', type_id: 1 })).toBeNull()
  })
})

describe('tankMechanics：距离倍率', () => {
  it('分段边界按“上界含”取段（50 → 1.4，50.1 → 1.2，200 → 1.0，200.1 → 0.8）', () => {
    expect(damageFactorAt(SECTORS, 0)).toBe(1.4)
    expect(damageFactorAt(SECTORS, 50)).toBe(1.4)
    expect(damageFactorAt(SECTORS, 50.1)).toBe(1.2)
    expect(damageFactorAt(SECTORS, 120)).toBe(1.2)
    expect(damageFactorAt(SECTORS, 120.1)).toBe(1)
    expect(damageFactorAt(SECTORS, 200)).toBe(1)
    expect(damageFactorAt(SECTORS, 200.1)).toBe(0.8)
    expect(damageFactorAt(SECTORS, 720)).toBe(0.8)
    expect(damageFactorAt(SECTORS, 5000)).toBe(0.8)
  })

  it('非法距离/空分段 fail-closed（不猜倍率）', () => {
    for (const value of [null, undefined, NaN, Infinity, -1]) {
      expect(damageFactorAt(SECTORS, value as number | null | undefined)).toBeNull()
    }
    expect(damageFactorAt([], 100)).toBeNull()
    expect(damageFactorAt(null, 100)).toBeNull()
  })

  it('KV-4 KTTS 310 伤害的逐段期望值', () => {
    expect(trayShellDamage(310, SECTORS, 30)).toBe(434)
    expect(trayShellDamage(310, SECTORS, 100)).toBe(372)
    expect(trayShellDamage(310, SECTORS, 150)).toBe(310)
    expect(trayShellDamage(310, SECTORS, 500)).toBe(248)
    // 无分段/非法距离 → 基础伤害，不伪造倍率
    expect(trayShellDamage(310, null, 30)).toBe(310)
    expect(trayShellDamage(310, SECTORS, null)).toBe(310)
    expect(trayShellDamage(null, SECTORS, 30)).toBeNull()
  })
})

describe('tankMechanics：官方文案渲染', () => {
  it('ParamName 值从 localizationValues 原样取，不补默认值', () => {
    expect(mechanicParamValues(TRAY)).toMatchObject({ ParamName1: '50', ParamName10: '80' })
    expect(mechanicParamValues(OTHER)).toEqual({})
    expect(mechanicParamValues(null)).toEqual({})
  })

  it('替换全部占位符；缺任一值返回 null（不显示裸占位符）', () => {
    expect(renderMechanicText('a %(ParamName1) m / x %(ParamName2)%', { ParamName1: '50', ParamName2: '140' }))
      .toBe('a 50 m / x 140%')
    expect(renderMechanicText('a %(ParamName1) m', {})).toBeNull()
    expect(renderMechanicText('plain text', {})).toBe('plain text')
    expect(renderMechanicText('', {})).toBeNull()
    expect(renderMechanicText(null, {})).toBeNull()
  })

  it('客户端富文本 <br/> 还原为换行（ReserveAmmo 原文；不输出裸标签）', () => {
    expect(renderMechanicText('• fast.<br/><br/>• reserve.', {})).toBe('• fast.\n\n• reserve.')
    expect(renderMechanicText('a<br>b', {})).toBe('a\nb')
  })

  it('按语言取标题/说明；zh 走 zh-Hans，ru 走 ru', () => {
    const table = {
      mechanics: {
        TrayShell: {
          title: { en: 'Assault Shells', 'zh-Hans': '突击弹', ru: 'Штурмовые снаряды' },
          description: {
            en: 'x %(ParamName1) m',
            'zh-Hans': 'x %(ParamName1) 米',
            ru: 'x %(ParamName1) м',
          },
        },
      },
    }
    expect(mechanicLang('zh')).toBe('zh-Hans')
    expect(mechanicLang('zh-Hans')).toBe('zh-Hans')
    expect(mechanicLang('ru')).toBe('ru')
    expect(mechanicLang('fr')).toBe('en')
    expect(mechanicTextFor(table, TRAY, 'zh')).toEqual({ title: '突击弹', description: 'x 50 米' })
    expect(mechanicTextFor(table, TRAY, 'en')).toEqual({ title: 'Assault Shells', description: 'x 50 m' })
    expect(mechanicTextFor(table, TRAY, 'ru')).toEqual({ title: 'Штурмовые снаряды', description: 'x 50 м' })
    expect(mechanicTextFor(null, TRAY, 'zh')).toEqual({ title: null, description: null })
  })
})
describe('tankMechanics：判定链接线（source guard）', () => {
  it('judgment 用射手 mechanics（不是受击方 tankData）并按 dist 缩放伤害', () => {
    const source = readFileSync(new URL('./viewer/judgment.ts', import.meta.url), 'utf8')
    expect(source).toContain('trayShellFor(getShooterData()?.mechanics')
    expect(source).toContain('trayShellDamage(')
  })
})
