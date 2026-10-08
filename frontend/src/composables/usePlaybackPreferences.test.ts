// @vitest-environment happy-dom

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { defineComponent, nextTick } from 'vue'
import { mount } from '@vue/test-utils'
let usePlaybackPreferences: typeof import('./usePlaybackPreferences.js').usePlaybackPreferences

describe('usePlaybackPreferences', () => {
  beforeEach(async () => {
    localStorage.clear()
    vi.resetModules()
    usePlaybackPreferences = (await import('./usePlaybackPreferences.js')).usePlaybackPreferences
  })

  it('uses the existing product defaults', () => {
    const prefs = usePlaybackPreferences()
    expect({ ...prefs.labelPrefs }).toEqual({ showPlayerName: false, showTankName: true, showReload: true })
    expect({ ...prefs.hpPrefs }).toEqual({ showHp: true })
    expect({ ...prefs.trailPrefs }).toEqual({ showTrail: true })
    expect({ ...prefs.markerPrefs }).toEqual({ classIcons: false, showStatus: true })
    expect(prefs.declutterActive.value).toBe(false)
    expect({ ...prefs.uiPrefs }).toEqual({
      showTopbar: true, showRoster: true, showKillfeed: true, showBaseStatus: true,
    })
  })

  it('declutters both consumers and restores the exact custom settings without changing roster visibility', () => {
    const prefs = usePlaybackPreferences()
    const otherRenderer = usePlaybackPreferences()
    prefs.labelPrefs.showPlayerName = true
    prefs.labelPrefs.showTankName = false
    prefs.trailPrefs.showTrail = false
    prefs.markerPrefs.classIcons = true
    prefs.uiPrefs.showRoster = false
    prefs.toggleDeclutter()
    expect(otherRenderer.declutterActive.value).toBe(true)
    expect({ ...prefs.labelPrefs }).toEqual({ showPlayerName: false, showTankName: true, showReload: false })
    expect({ ...prefs.markerPrefs }).toEqual({ classIcons: true, showStatus: false })
    expect(prefs.hpPrefs.showHp).toBe(false)
    expect(prefs.trailPrefs.showTrail).toBe(false)
    expect(prefs.uiPrefs.showRoster).toBe(false)
    // Roster toggles are independent; they must not discard the restoration snapshot.
    prefs.uiPrefs.showRoster = true
    otherRenderer.toggleDeclutter()
    expect({ ...prefs.labelPrefs }).toEqual({ showPlayerName: true, showTankName: false, showReload: true })
    expect({ ...prefs.markerPrefs }).toEqual({ classIcons: true, showStatus: true })
    expect(prefs.hpPrefs.showHp).toBe(true)
    expect(prefs.trailPrefs.showTrail).toBe(false)
    expect(prefs.uiPrefs.showRoster).toBe(true)
  })

  it('manual changes exit the preset and become the next restorable custom view', () => {
    const prefs = usePlaybackPreferences()
    prefs.toggleDeclutter()
    prefs.hpPrefs.showHp = true
    expect(prefs.declutterActive.value).toBe(false)
    expect(prefs.markerPrefs.classIcons).toBe(true)
    expect(prefs.labelPrefs.showReload).toBe(false)
    prefs.toggleDeclutter()
    expect(prefs.hpPrefs.showHp).toBe(false)
    prefs.toggleDeclutter()
    expect(prefs.hpPrefs.showHp).toBe(true)
    expect(prefs.labelPrefs.showReload).toBe(false)
    expect(JSON.parse(localStorage.getItem('wotb.pb.marker-prefs')!)).toEqual({ classIcons: true, showStatus: false })
  })

  it('refreshing while declutter is active hydrates saved settings instead of stranding a preset', async () => {
    const prefs = usePlaybackPreferences()
    prefs.labelPrefs.showPlayerName = true
    prefs.toggleDeclutter()
    vi.resetModules()
    const { usePlaybackPreferences: freshSession } = await import('./usePlaybackPreferences.js')
    const fresh = freshSession()
    expect(fresh.declutterActive.value).toBe(false)
    expect(fresh.labelPrefs.showPlayerName).toBe(true)
    expect(fresh.hpPrefs.showHp).toBe(true)
    expect(fresh.markerPrefs.classIcons).toBe(false)
  })

  it('shares immediate state and merged persistence between two mounted consumers', async () => {
    const consumers: ReturnType<typeof usePlaybackPreferences>[] = []
    const Consumer = defineComponent({
      setup() {
        consumers.push(usePlaybackPreferences())
        return () => null
      },
    })
    const first = mount(Consumer)
    const second = mount(Consumer)
    const [a, b] = consumers
    expect(a).toBe(b)
    expect(a.labelPrefs).toBe(b.labelPrefs)
    expect(a.hpPrefs).toBe(b.hpPrefs)
    expect(a.uiPrefs).toBe(b.uiPrefs)

    a.labelPrefs.showTankName = false
    expect(b.labelPrefs.showTankName).toBe(false)
    b.labelPrefs.showPlayerName = true
    expect(a.labelPrefs.showPlayerName).toBe(true)
    await nextTick()
    expect(JSON.parse(localStorage.getItem('wotb.pb.label-prefs') || '{}')).toEqual({
      showPlayerName: true, showTankName: false, showReload: true,
    })

    // Persistence belongs to the module, not the first mounted caller's scope.
    first.unmount()
    b.labelPrefs.showReload = false
    await nextTick()
    expect(JSON.parse(localStorage.getItem('wotb.pb.label-prefs') || '{}')).toEqual({
      showPlayerName: true, showTankName: false, showReload: false,
    })
    second.unmount()
  })

  it('hydrates a new module session independently of the previous singleton', async () => {
    const old = usePlaybackPreferences()
    old.labelPrefs.showPlayerName = true
    await nextTick()
    localStorage.clear()
    vi.resetModules()
    const { usePlaybackPreferences: freshSession } = await import('./usePlaybackPreferences.js')
    expect(freshSession().labelPrefs).not.toBe(old.labelPrefs)
    expect(freshSession().labelPrefs.showPlayerName).toBe(false)
  })

  it('hydrates and persists all playback presentation preferences through one owner', async () => {
    localStorage.setItem('wotb.pb.label-prefs', JSON.stringify({ showPlayerName: true, showTankName: false, showReload: false }))
    localStorage.setItem('wotb.pb.hp-prefs', JSON.stringify({ showHp: false }))
    localStorage.setItem('wotb.pb.trail-prefs', JSON.stringify({ showTrail: false }))
    localStorage.setItem('wotb.pb.ui-prefs', JSON.stringify({ showTopbar: false, showRoster: true, showKillfeed: false, showBaseStatus: true }))
    // 已移除的 rail / 列宽偏好：残留的旧键不得再被读回，也不得被重写。
    localStorage.setItem('wotb.pb.pane-widths', JSON.stringify({ rail: 240, details: 360 }))
    localStorage.setItem('wotb.pb.rail-collapsed.v2', '1')

    const prefs = usePlaybackPreferences()
    expect({ ...prefs.labelPrefs }).toEqual({ showPlayerName: true, showTankName: false, showReload: false })
    expect({ ...prefs.hpPrefs }).toEqual({ showHp: false })
    expect({ ...prefs.trailPrefs }).toEqual({ showTrail: false })
    expect({ ...prefs.uiPrefs }).toEqual({ showTopbar: false, showRoster: true, showKillfeed: false, showBaseStatus: true })

    prefs.hpPrefs.showHp = true
    prefs.trailPrefs.showTrail = true
    prefs.uiPrefs.showTopbar = true
    await nextTick()

    expect(JSON.parse(localStorage.getItem('wotb.pb.hp-prefs') || '{}')).toEqual({ showHp: true })
    expect(JSON.parse(localStorage.getItem('wotb.pb.trail-prefs') || '{}')).toEqual({ showTrail: true })
    expect(JSON.parse(localStorage.getItem('wotb.pb.ui-prefs') || '{}').showTopbar).toBe(true)
    expect(JSON.parse(localStorage.getItem('wotb.pb.pane-widths') || '{}')).toEqual({ rail: 240, details: 360 })
    expect(localStorage.getItem('wotb.pb.rail-collapsed.v2')).toBe('1')
  })

  it('老持久化值（无 showReload / 无 ui-prefs）不重置用户已有选择：新增项默认开启', () => {
    localStorage.setItem('wotb.pb.label-prefs', JSON.stringify({ showPlayerName: true, showTankName: true }))

    const prefs = usePlaybackPreferences()

    expect(prefs.labelPrefs.showPlayerName).toBe(true)
    expect(prefs.labelPrefs.showTankName).toBe(true)
    expect(prefs.labelPrefs.showReload).toBe(true)
    // ui-prefs 缺失 → 全开（0 键与显式 false 不同：不得把缺省读成"隐藏"）
    expect({ ...prefs.uiPrefs }).toEqual({
      showTopbar: true, showRoster: true, showKillfeed: true, showBaseStatus: true,
    })
  })
})
