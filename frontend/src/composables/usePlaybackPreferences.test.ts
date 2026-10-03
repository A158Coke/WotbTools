// @vitest-environment happy-dom

import { beforeEach, describe, expect, it } from 'vitest'
import { nextTick } from 'vue'
import { usePlaybackPreferences } from './usePlaybackPreferences.js'

describe('usePlaybackPreferences', () => {
  beforeEach(() => localStorage.clear())

  it('uses the existing product defaults', () => {
    const prefs = usePlaybackPreferences()
    expect({ ...prefs.labelPrefs }).toEqual({ showPlayerName: false, showTankName: true, showReload: true })
    expect({ ...prefs.hpPrefs }).toEqual({ showHp: true })
    expect({ ...prefs.trailPrefs }).toEqual({ showTrail: true })
    expect({ ...prefs.uiPrefs }).toEqual({
      showTopbar: true, showRoster: true, showKillfeed: true, showBaseStatus: true,
    })
    expect({ ...prefs.paneWidths }).toEqual({ rail: null, details: null })
    expect(prefs.railCollapsed.value).toBe(false)
  })

  it('hydrates and persists all playback presentation preferences through one owner', async () => {
    localStorage.setItem('wotb.pb.label-prefs', JSON.stringify({ showPlayerName: true, showTankName: false, showReload: false }))
    localStorage.setItem('wotb.pb.hp-prefs', JSON.stringify({ showHp: false }))
    localStorage.setItem('wotb.pb.trail-prefs', JSON.stringify({ showTrail: false }))
    localStorage.setItem('wotb.pb.ui-prefs', JSON.stringify({ showTopbar: false, showRoster: true, showKillfeed: false, showBaseStatus: true }))
    localStorage.setItem('wotb.pb.pane-widths', JSON.stringify({ rail: 240, details: 360 }))
    localStorage.setItem('wotb.pb.rail-collapsed.v2', '1')

    const prefs = usePlaybackPreferences()
    expect({ ...prefs.labelPrefs }).toEqual({ showPlayerName: true, showTankName: false, showReload: false })
    expect({ ...prefs.hpPrefs }).toEqual({ showHp: false })
    expect({ ...prefs.trailPrefs }).toEqual({ showTrail: false })
    expect({ ...prefs.uiPrefs }).toEqual({ showTopbar: false, showRoster: true, showKillfeed: false, showBaseStatus: true })
    expect({ ...prefs.paneWidths }).toEqual({ rail: 240, details: 360 })
    expect(prefs.railCollapsed.value).toBe(true)

    prefs.hpPrefs.showHp = true
    prefs.trailPrefs.showTrail = true
    prefs.uiPrefs.showTopbar = true
    prefs.paneWidths.details = 420
    prefs.railCollapsed.value = false
    await nextTick()

    expect(JSON.parse(localStorage.getItem('wotb.pb.hp-prefs') || '{}')).toEqual({ showHp: true })
    expect(JSON.parse(localStorage.getItem('wotb.pb.trail-prefs') || '{}')).toEqual({ showTrail: true })
    expect(JSON.parse(localStorage.getItem('wotb.pb.ui-prefs') || '{}').showTopbar).toBe(true)
    expect(JSON.parse(localStorage.getItem('wotb.pb.pane-widths') || '{}').details).toBe(420)
    expect(localStorage.getItem('wotb.pb.rail-collapsed.v2')).toBe('0')
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

  it('does not hydrate the stale pre-desktop-rail collapsed preference', () => {
    localStorage.setItem('wotb.pb.rail-collapsed', '1')

    const prefs = usePlaybackPreferences()

    expect(prefs.railCollapsed.value).toBe(false)
  })
})