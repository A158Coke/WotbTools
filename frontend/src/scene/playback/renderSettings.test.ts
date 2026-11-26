import { describe, expect, it } from 'vitest'
import {
  buildRenderSettingsReloadUrl,
  replaySettingsDiff,
  type Replay3DSettings,
} from './renderSettings.js'

const current: Replay3DSettings = {
  qualityKey: 'high',
  logdepth: false,
  dynres: true,
  armorHighlight: false,
  contactShadows: false,
  battleSound: true,
}

describe('replaySettingsDiff', () => {
  it('无实际修改时不产生任何调用', () => {
    const diff = replaySettingsDiff({ ...current }, current)
    expect(diff.changed).toBe(false)
    expect(diff.render).toBeNull()
    expect(diff.live).toEqual({})
  })

  it('只改 live 项时不重建渲染上下文', () => {
    const diff = replaySettingsDiff({ ...current, armorHighlight: true, battleSound: false }, current)
    expect(diff.changed).toBe(true)
    expect(diff.render).toBeNull()
    expect(diff.live).toEqual({ armorHighlight: true, battleSound: false })
  })

  it('接地阴影走 render patch，重载后由渲染器重新装配 stencil', () => {
    const diff = replaySettingsDiff({ ...current, contactShadows: true }, current)
    expect(diff.changed).toBe(true)
    expect(diff.render).toEqual({ contactShadows: true })
    expect(diff.live).toEqual({})
  })

  it('多个渲染项一次 Save 合并成一个 patch（最多一次重载）', () => {
    const diff = replaySettingsDiff({ ...current, qualityKey: 'ultra', logdepth: true, dynres: false }, current)
    expect(diff.render).toEqual({ qualityKey: 'ultra', logdepth: true, dynres: false })
  })

  it('只改动态分辨率也走 render patch，不混入未变化的画质', () => {
    const diff = replaySettingsDiff({ ...current, dynres: false }, current)
    expect(diff.render).toEqual({ dynres: false })
  })
})

describe('buildRenderSettingsReloadUrl', () => {
  it('画质变化才写 q，并保留其他查询参数', () => {
    const url = buildRenderSettingsReloadUrl('https://x.test/replay?foo=1&q=high#h', { qualityKey: 'ultra' })
    expect(url.searchParams.get('foo')).toBe('1')
    expect(url.searchParams.get('q')).toBe('ultra')
    expect(url.hash).toBe('#h')
  })

  it('URL 已显式携带的渲染开关同步改写', () => {
    const url = buildRenderSettingsReloadUrl('https://x.test/replay?logdepth=1&dynres=0', { logdepth: false, dynres: true })
    expect(url.searchParams.get('logdepth')).toBe('0')
    expect(url.searchParams.get('dynres')).toBe('1')
  })

  it('URL 未携带的开关不写入（localStorage 仍是唯一来源）', () => {
    const url = buildRenderSettingsReloadUrl('https://x.test/replay', { logdepth: true, dynres: false })
    expect(url.searchParams.has('logdepth')).toBe(false)
    expect(url.searchParams.has('dynres')).toBe(false)
    expect(url.searchParams.has('q')).toBe(false)
  })

  it('接地阴影总是显式写入 ?shadows=（没有 localStorage 可依赖）', () => {
    expect(buildRenderSettingsReloadUrl('https://x.test/replay', { contactShadows: true }).searchParams.get('shadows')).toBe('1')
    expect(buildRenderSettingsReloadUrl('https://x.test/replay?shadows=1', { contactShadows: false }).searchParams.get('shadows')).toBe('0')
  })
})
