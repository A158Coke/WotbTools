// @vitest-environment happy-dom

import { beforeEach, describe, expect, it } from 'vitest'
import { nextTick } from 'vue'
import { usePlaybackPreferences } from './usePlaybackPreferences.js'

describe('usePlaybackPreferences', () => {
  beforeEach(() => localStorage.clear())

  it('uses the existing product defaults', () => {
    const prefs = usePlaybackPreferences()
    expect({ ...prefs.labelPrefs }).toEqual({ showPlayerName: false, showTankName: true })
    expect({ ...prefs.hpPrefs }).toEqual({ showHp: true })
    expect({ ...prefs.trailPrefs }).toEqual({ showTrail: true })
    expect({ ...prefs.paneWidths }).toEqual({ rail: null, details: null })
    expect(prefs.railCollapsed.value).toBe(false)
  })

  it('hydrates and persists all playback presentation preferences through one owner', async () => {
    localStorage.setItem('wotb.pb.label-prefs', JSON.stringify({ showPlayerName: true, showTankName: false }))
    localStorage.setItem('wotb.pb.hp-prefs', JSON.stringify({ showHp: false }))
    localStorage.setItem('wotb.pb.trail-prefs', JSON.stringify({ showTrail: false }))
    localStorage.setItem('wotb.pb.pane-widths', JSON.stringify({ rail: 240, details: 360 }))
    localStorage.setItem('wotb.pb.rail-collapsed', '1')

    const prefs = usePlaybackPreferences()
    expect({ ...prefs.labelPrefs }).toEqual({ showPlayerName: true, showTankName: false })
    expect({ ...prefs.hpPrefs }).toEqual({ showHp: false })
    expect({ ...prefs.trailPrefs }).toEqual({ showTrail: false })
    expect({ ...prefs.paneWidths }).toEqual({ rail: 240, details: 360 })
    expect(prefs.railCollapsed.value).toBe(true)

    prefs.hpPrefs.showHp = true
    prefs.trailPrefs.showTrail = true
    prefs.paneWidths.details = 420
    prefs.railCollapsed.value = false
    await nextTick()

    expect(JSON.parse(localStorage.getItem('wotb.pb.hp-prefs') || '{}')).toEqual({ showHp: true })
    expect(JSON.parse(localStorage.getItem('wotb.pb.trail-prefs') || '{}')).toEqual({ showTrail: true })
    expect(JSON.parse(localStorage.getItem('wotb.pb.pane-widths') || '{}').details).toBe(420)
    expect(localStorage.getItem('wotb.pb.rail-collapsed')).toBe('0')
  })
})
