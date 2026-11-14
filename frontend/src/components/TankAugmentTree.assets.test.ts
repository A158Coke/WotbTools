/**
 * XI 强化树的“资源完整性”门禁：数据面引用的每个属性名/图标/机制，前端必须都有。
 *
 * 事实来源 = 资产包 t11r3（11.4.0.138）9 辆 XI 的 upgradeProgression ——
 * `__fixtures__/augment-assets.json` 由该包导出（attributeNames / iconBasenames /
 * mechanicStems）。新增 XI 或客户端重导后刷新该 fixture：缺三语标签或缺图标，
 * 这里直接失败，而不是运行时渲染出原始 i18n 键或空图。
 */
import { readFileSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import en from '../locales/en.json'
import zh from '../locales/zh.json'
import ru from '../locales/ru.json'

const here = dirname(fileURLToPath(import.meta.url))
const fixture = JSON.parse(readFileSync(resolve(here, './__fixtures__/augment-assets.json'), 'utf-8')) as {
  attributeNames: string[]
  iconBasenames: string[]
  mechanicStems: string[]
}
const ICON_DIR = resolve(here, '../../../common/research/icons/upgrades')
const LOCALES = { en, zh, ru } as Record<string, any>

function configurator(locale: unknown) {
  return (locale as any).agentTanks.configurator
}

describe('XI 强化树资源完整性（t11r3 资产包引用面）', () => {
  it('每个属性名在三语表里都有标签（不回落原始键）', () => {
    const missing: string[] = []
    for (const lang of Object.keys(LOCALES)) {
      const labels = configurator(LOCALES[lang]).upgrade_attributes
      for (const name of fixture.attributeNames) {
        if (typeof labels[name] !== 'string' || !labels[name]) missing.push(`${lang}:${name}`)
      }
    }
    expect(missing).toEqual([])
  })

  it('每个机制 stem 在三语表里都有名称/描述，且有 mech_<stem> 图标', () => {
    const missing: string[] = []
    for (const lang of Object.keys(LOCALES)) {
      const mechanics = configurator(LOCALES[lang]).augment_mechanics
      for (const stem of fixture.mechanicStems) {
        const entry = mechanics[stem]
        if (!entry || typeof entry.name !== 'string' || !entry.name
          || typeof entry.description !== 'string' || !entry.description) {
          missing.push(`${lang}:${stem}`)
        }
      }
    }
    for (const stem of fixture.mechanicStems) {
      if (!existsSync(resolve(ICON_DIR, `mech_${stem}.webp`))) missing.push(`icon:mech_${stem}`)
    }
    expect(missing).toEqual([])
  })

  it('数据面引用的每个强化图标都有 webp（缺图 = 树上一格空白）', () => {
    const missing = fixture.iconBasenames.filter(name => !existsSync(resolve(ICON_DIR, `${name}.webp`)))
    expect(missing).toEqual([])
  })
})
