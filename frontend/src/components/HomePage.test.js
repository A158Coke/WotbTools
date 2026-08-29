// @vitest-environment happy-dom

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import HomePage from './HomePage.vue'

const api = vi.hoisted(() => ({
  hofList: vi.fn(() => Promise.resolve({ items: [] }))
}))

vi.mock('../utils/api.js', () => api)

function mountPage(opts = {}) {
  return mount(HomePage, {
    global: {
      mocks: { $t: key => key },
      provide: { isAdmin: opts.isAdmin ?? false }
    }
  })
}

describe('HomePage highest damage record', () => {
  beforeEach(() => {
    api.hofList.mockReset()
  })

  it('formats the top damage record with thousands separators (regression: formatDamage regex)', async () => {
    api.hofList.mockResolvedValue({ items: [{ damageDealt: 10483 }] })
    const wrapper = mountPage()
    await flushPromises()
    expect(wrapper.find('.record-card strong').text()).toBe('10 483')
    wrapper.unmount()
  })

  it('formats 123456 as 123 456', async () => {
    api.hofList.mockResolvedValue({ items: [{ damageDealt: 123456 }] })
    const wrapper = mountPage()
    await flushPromises()
    expect(wrapper.find('.record-card strong').text()).toBe('123 456')
    wrapper.unmount()
  })

  it('shows -- when the leaderboard fails or is empty', async () => {
    api.hofList.mockRejectedValue(new Error('down'))
    const wrapper = mountPage()
    await flushPromises()
    expect(wrapper.find('.record-card strong').text()).toBe('--')
    wrapper.unmount()
  })
})

describe('HomePage information architecture — single replay entry point', () => {
  beforeEach(() => {
    api.hofList.mockReset()
    api.hofList.mockResolvedValue({ items: [] })
  })

  it('hero primary CTA is Upload Replay → replay view', () => {
    const wrapper = mountPage()
    const primary = wrapper.find('.hero-btn.primary')
    expect(primary.text()).toBe('home.replayParse')
    expect(primary.attributes('href')).toBe('/?view=replay')
    wrapper.unmount()
  })

  it('hero secondary CTA opens the standalone AI Review view', () => {
    const wrapper = mountPage()
    const secondary = wrapper.find('.hero-btn.secondary')
    expect(secondary.text()).toBe('home.aiReview')
    expect(secondary.attributes('href')).toBe('/?view=ai-review')
    wrapper.unmount()
  })

  it('hero exposes a standalone Battle Playback entry', () => {
    const wrapper = mountPage()
    const actions = wrapper.findAll('.hero-btn')
    expect(actions[2].text()).toBe('home.battlePlayback')
    expect(actions[2].attributes('href')).toBe('/?view=battle-playback')
    wrapper.unmount()
  })

  it('feature card 01 CTA is Explore Battle Analysis, not Upload Replay', () => {
    const wrapper = mountPage()
    const action = wrapper.find('.feature-primary .feature-action')
    expect(action.text()).toBe('home.replayParse →')
    expect(wrapper.find('.feature-primary').attributes('href')).toBe('/?view=replay')
    wrapper.unmount()
  })

  it('bottom replay upload panel is removed (no third upload entry point)', () => {
    const wrapper = mountPage()
    expect(wrapper.find('.replay-panel').exists()).toBe(false)
    expect(wrapper.text()).not.toContain('upload.select_files')
    expect(wrapper.text()).not.toContain('upload.select_folder')
    wrapper.unmount()
  })

  it('shows Recent Analysis empty state with a contextual upload CTA', () => {
    const wrapper = mountPage()
    const panel = wrapper.find('.recent-panel')
    expect(panel.exists()).toBe(true)
    expect(panel.find('.recent-title').text()).toBe('home.recentAnalysis')
    expect(panel.find('.recent-empty-title').text()).toBe('home.recentAnalysisEmptyTitle')
    expect(panel.find('.recent-empty-desc').text()).toBe('home.recentAnalysisEmptyDesc')
    const cta = panel.find('.mini-action.primary')
    expect(cta.text()).toBe('home.uploadReplay')
    expect(cta.attributes('href')).toBe('/?view=replay')
    wrapper.unmount()
  })

  it('quick links panel is preserved (non-admin hides the Android download link)', () => {
    const wrapper = mountPage()
    const quick = wrapper.find('.quick-panel')
    expect(quick.exists()).toBe(true)
    expect(quick.findAll('a')).toHaveLength(4)
    expect(quick.findAll('a').some(a => a.attributes('href') === '/download/android')).toBe(false)
    wrapper.unmount()
  })

  it('Android download entries are admin-only (feature flag)', () => {
    const admin = mountPage({ isAdmin: true })
    expect(admin.find('.hero-btn[href="/download/android"]').exists()).toBe(true)
    const quickAdmin = admin.find('.quick-panel')
    expect(quickAdmin.findAll('a')).toHaveLength(5)
    expect(quickAdmin.findAll('a').some(a => a.attributes('href') === '/download/android')).toBe(true)
    admin.unmount()

    const guest = mountPage({ isAdmin: false })
    expect(guest.find('.hero-btn[href="/download/android"]').exists()).toBe(false)
    const quickGuest = guest.find('.quick-panel')
    expect(quickGuest.findAll('a')).toHaveLength(4)
    expect(quickGuest.findAll('a').some(a => a.attributes('href') === '/download/android')).toBe(false)
    guest.unmount()
  })
})
