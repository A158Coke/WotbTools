import { describe, expect, it } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import { normalizeLocale, persistLocale, readLocale } from './locale-preference.js'

const srcRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')

function productionSourceFiles(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const path = resolve(directory, entry.name)
    if (entry.isDirectory()) return productionSourceFiles(path)
    if (!/\.(?:js|ts|vue)$/.test(entry.name) || /\.test\.[^.]+$/.test(entry.name)) return []
    return [path]
  })
}

function hasLocaleStorageAccess(source) {
  return /localStorage\.(?:getItem|setItem)\s*\(\s*(?:['"]wotb-lang['"]|LOCALE_STORAGE_KEY)/.test(source)
}

describe('locale preference', () => {
  it('normalizes supported locales and falls back for missing or unsupported values', () => {
    expect(normalizeLocale('EN-us')).toBe('en')
    expect(normalizeLocale('ru')).toBe('ru')
    expect(normalizeLocale('fr')).toBe('zh')
    expect(normalizeLocale(null)).toBe('zh')
  })

  it('reads and persists only normalized locale values', () => {
    const values = new Map([['wotb-lang', 'ru-RU']])
    const storage = {
      getItem: key => values.get(key) ?? null,
      setItem: (key, value) => values.set(key, value),
    }
    expect(readLocale(storage)).toBe('ru')
    expect(persistLocale('bad', storage)).toBe('zh')
    expect(values.get('wotb-lang')).toBe('zh')
  })

  it('falls back safely when storage access throws', () => {
    expect(readLocale({ getItem: () => { throw new Error('storage disabled') } })).toBe('zh')
    expect(persistLocale('en', { setItem: () => { throw new Error('storage disabled') } })).toBe('en')
  })

  it('keeps production storage access out of main, components, and display helpers', () => {
    const ownerPath = resolve(srcRoot, 'i18n/locale-preference.js')
    for (const path of productionSourceFiles(srcRoot)) {
      if (path === ownerPath) continue
      const source = readFileSync(path, 'utf8')
      expect(hasLocaleStorageAccess(source), path).toBe(false)
    }
    expect(hasLocaleStorageAccess("localStorage.setItem('wotb-lang', 'en')")).toBe(true)
    expect(hasLocaleStorageAccess('localStorage.getItem(LOCALE_STORAGE_KEY)')).toBe(true)
  })
})
