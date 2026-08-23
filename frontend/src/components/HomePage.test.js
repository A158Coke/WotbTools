// @vitest-environment happy-dom

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import HomePage from './HomePage.vue'

const api = vi.hoisted(() => ({
  hofList: vi.fn(() => Promise.resolve({ items: [] }))
}))

vi.mock('../utils/api.js', () => api)

function mountPage() {
  return mount(HomePage, {
    global: { mocks: { $t: key => key } }
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
