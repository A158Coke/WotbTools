
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const read = (rel) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8')
const srcRoot = fileURLToPath(new URL('../src', import.meta.url))

function sourceFiles(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) return entry.name === 'generated' ? [] : sourceFiles(path)
    if (!/\.(?:js|ts|vue)$/.test(entry.name) || entry.name.endsWith('.d.ts')) return []
    if (/\.test\./.test(entry.name) || path.includes(`${join('src', 'test')}`)) return []
    return [path]
  })
}

function codeOnly(source) {
  return source.split('\n')
    .filter((line) => !/^\s*(?:\/\/|\*|\/\*)/.test(line))
    .join('\n')
}

describe('data version selector wiring', () => {
  it('all runtime asset origins go through assetBase / assetProvider', () => {
    const offenders = []
    for (const path of sourceFiles(srcRoot)) {
      const rel = path.slice(srcRoot.length + 1).replace(/\\/g, '/')
      const code = codeOnly(readFileSync(path, 'utf8'))
      if (/\bANDROID_ASSET_BASE\b/.test(code) && !['platform/runtime.js', 'scene/assetBase.ts'].includes(rel)) {
        offenders.push(`${rel}: 直接使用 ANDROID_ASSET_BASE`)
      }
      if (/VITE_ASSET_BASE_URL/.test(code) && rel !== 'scene/assetBase.ts') {
        offenders.push(`${rel}: 直接读取 VITE_ASSET_BASE_URL`)
      }
      if (/\bassetBase\(/.test(code) && !['scene/assetBase.ts', 'scene/assetProvider.ts'].includes(rel)) {
        offenders.push(`${rel}: 绕过 assetProvider 直接调用 assetBase()`)
      }
    }
    expect(offenders).toEqual([])
  })
  it('the sidebar places the selector directly below the brand; mobile More keeps its own', () => {
    const sidebar = read('../src/app/AppSidebar.vue')
    expect(sidebar, 'sidebar uses SidebarDataVersion').toContain('<SidebarDataVersion')
    expect(sidebar, 'sidebar forwards rail mode').toContain(':rail="rail"')
    const brandIndex = sidebar.indexOf('class="sidebar-brand"')
    const selectorIndex = sidebar.indexOf('<SidebarDataVersion')
    expect(brandIndex).toBeGreaterThan(-1)
    expect(selectorIndex).toBeGreaterThan(brandIndex)

    const sidebarSelector = read('../src/app/SidebarDataVersion.vue')
    expect(sidebarSelector, 'sidebar selector calls select()').toContain('select(')
    expect(sidebarSelector, 'sidebar selector select handler').toContain('onSelect')
    expect(sidebarSelector, 'sidebar selector default label').toContain("$t('dataVersion.default')")
    expect(sidebarSelector, 'sidebar rail variant').toContain('is-rail')
    expect(sidebarSelector, 'sidebar uses the shared data-version menu').toContain('DataVersionMenu')

    const settingSelector = read('../src/components/DataVersionSelect.vue')
    expect(settingSelector, 'setting selector uses the shared menu').toContain('DataVersionMenu')
    expect(settingSelector, 'setting selector default label').toContain("$t('dataVersion.default')")

    const morePage = read('../src/components/MorePage.vue')
    expect(morePage, 'mobile More selector').toContain('DataVersionSelect')
    expect(morePage, 'mobile More test id').toContain('data-testid="more-data-version"')

    expect(read('../src/app/MorePanel.vue')).not.toContain('DataVersionSelect')
    expect(read('../src/components/ReplayWorkspace.vue')).not.toContain('DataVersionSelect')
  })

  it('all literal asset paths are handed to assetProvider', () => {
    const ASSET_PATH_RE = /["'`]\/(?:glb|tank|tank_images|map|cover|research|data|map2d|tread|suspension)\//
    const allowed = new Set([
      'scene/treadMarks.ts',
      // 版本对比按「被对比的那个 dataset」显式构造 /v/<id>/...；不能走当前选中
      // dataset 的 assetProvider（同一页面要同时取两版图标/底图/封面）。
      'composables/useVersionDiff.ts',
    ])
    const offenders = []
    for (const path of sourceFiles(srcRoot)) {
      const rel = path.slice(srcRoot.length + 1).replace(/\\/g, '/')
      if (allowed.has(rel)) continue
      const lines = codeOnly(readFileSync(path, 'utf8')).split('\n')
      for (let i = 0; i < lines.length; i += 1) {
        const line = lines[i]
        if (ASSET_PATH_RE.test(line) && !line.includes('assetProvider') && !(lines[i - 1] || '').includes('assetProvider')) {
          offenders.push(`${rel}: ${line.trim().slice(0, 120)}`)
        }
      }
    }
    expect(offenders).toEqual([])
  })

  it('assetBase appends /v/<id> and map2d uses the version-aware Android base', () => {
    const assetBase = read('../src/scene/assetBase.ts')
    expect(assetBase).toContain('export function androidAssetBase')
    expect(assetBase).toContain('/v/${id}')
    expect(assetBase).toContain('DATA_VERSION_QUERY')

    const map2d = read('../src/data/map2dOverlay.ts')
    expect(map2d).toContain('androidAssetBase()')
    expect(map2d).toContain('dataVersionId')
    expect(map2d).toContain('LEGACY_STORE_KEY')
    expect(map2d).toContain('storeKey()')
    expect(map2d).not.toContain('ANDROID_ASSET_BASE')
  })
})