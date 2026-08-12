// @vitest-environment happy-dom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { ref } from 'vue'
import BoostPage from './BoostPage.vue'

const api = vi.hoisted(() => ({
  listBoosters: vi.fn(),
  updateBooster: vi.fn(),
  searchUsers: vi.fn()
}))

vi.mock('../composables/useAuth.js', () => ({
  useAuth: () => ({
    initPromise: Promise.resolve(true),
    login: vi.fn(),
    isAuthenticated: () => true,
    userName: () => 'admin',
    tokenParsed: ref({ realm_access: { roles: ['wotbtools-admin'] } })
  })
}))

vi.mock('../utils/api-boost.js', async () => {
  const actual = await vi.importActual('../utils/api-boost.js')
  return {
    ...actual,
    boostOptions: () => Promise.resolve({ regions: [], requestTypes: [], contactTypes: [], warningCode: '' }),
    boostListMyRequests: () => Promise.resolve([]),
    getUserProfile: () => Promise.resolve({ wotbServer: 'CN' }),
    getMyBoosterProfile: () => Promise.reject(new Error('not-a-booster')),
    boostListMyBoosterApplications: () => Promise.resolve([]),
    adminBoostBoosterList: api.listBoosters,
    adminBoostBoosterUpdate: api.updateBooster,
    adminSearchUsers: api.searchUsers
  }
})

vi.mock('../utils/display.js', () => ({
  apiCodeLabel: (_t, _te, code) => code || '',
  apiErrorLabel: () => 'api-error',
  enumLabel: (_t, _te, group, value, fallback = '--') => value || fallback
}))

vi.mock('vue-i18n', () => ({
  useI18n: () => ({
    t: key => key,
    te: () => true
  })
}))

const booster = {
  id: 7,
  nickname: 'EU Booster',
  level: 'MASTER',
  keycloakUserId: 'internal-user-id',
  wotbServer: 'EU',
  available: true,
  status: 'ACTIVE',
  contactType: 'QQ',
  contactValue: '123456',
  specialties: 'medium tanks',
  description: null,
  activeAssignmentCount: 0
}

function mountPage() {
  return mount(BoostPage, {
    global: { mocks: { $t: key => key } }
  })
}

describe('BoostPage booster editor', () => {
  let wrapper

  beforeEach(() => {
    api.listBoosters.mockResolvedValue({ content: [booster], number: 0, size: 20, totalPages: 1 })
    api.updateBooster.mockResolvedValue(booster)
    api.searchUsers.mockResolvedValue([])
  })

  afterEach(() => {
    wrapper?.unmount()
    document.body.innerHTML = ''
    vi.clearAllMocks()
  })

  it('opens editing in a modal and exposes Average God only to admin editing', async () => {
    wrapper = mountPage()
    await flushPromises()
    await wrapper.findAll('.boost-tabs button').find(button => button.text() === 'boost.boostersTab').trigger('click')
    await flushPromises()
    await wrapper.find('.booster-actions button').trigger('click')
    await flushPromises()

    const dialog = document.body.querySelector('.booster-editor-overlay[role="dialog"][aria-modal="true"]')
    expect(dialog).not.toBeNull()
    expect(wrapper.find('.booster-editor').exists()).toBe(false)
    expect(dialog.textContent).toContain('EU Booster')
    expect(dialog.textContent).not.toContain('internal-user-id')
    expect([...dialog.querySelectorAll('option')].map(option => option.value)).toContain('AVERAGE_GOD')
  })

  it('submits only editable profile fields', async () => {
    wrapper = mountPage()
    await flushPromises()
    await wrapper.findAll('.boost-tabs button').find(button => button.text() === 'boost.boostersTab').trigger('click')
    await flushPromises()
    await wrapper.find('.booster-actions button').trigger('click')
    await flushPromises()

    const dialog = document.body.querySelector('.booster-editor-overlay')
    const levelSelect = dialog.querySelector('select')
    levelSelect.value = 'AVERAGE_GOD'
    levelSelect.dispatchEvent(new Event('change'))
    dialog.querySelector('.form-actions .btn-primary').click()
    await flushPromises()

    expect(api.updateBooster).toHaveBeenCalledWith(7, {
      level: 'AVERAGE_GOD',
      available: true,
      status: 'ACTIVE',
      contactType: 'QQ',
      contactValue: '123456',
      specialties: 'medium tanks'
    })
    expect(api.updateBooster.mock.calls[0][1]).not.toHaveProperty('keycloakUserId')
    expect(api.updateBooster.mock.calls[0][1]).not.toHaveProperty('nickname')
  })

  it('does not resubmit an untouched legacy note', async () => {
    api.listBoosters.mockResolvedValue({
      content: [{ ...booster, description: 'application_id=22\nwotb_account_id=2043138182' }],
      number: 0,
      size: 20,
      totalPages: 1
    })
    wrapper = mountPage()
    await flushPromises()
    await wrapper.findAll('.boost-tabs button').find(button => button.text() === 'boost.boostersTab').trigger('click')
    await flushPromises()
    await wrapper.find('.booster-actions button').trigger('click')
    await flushPromises()

    document.body.querySelector('.booster-editor-overlay .form-actions .btn-primary').click()
    await flushPromises()

    expect(api.updateBooster.mock.calls[0][1]).not.toHaveProperty('description')
  })

  it('keeps Average God out of the new-booster choices', async () => {
    wrapper = mountPage()
    await flushPromises()
    await wrapper.findAll('.boost-tabs button').find(button => button.text() === 'boost.boostersTab').trigger('click')
    await flushPromises()
    await wrapper.find('.flex-between .btn-primary').trigger('click')
    await flushPromises()

    const dialog = document.body.querySelector('.booster-editor-overlay')
    const levels = [...dialog.querySelectorAll('.form-row select')[0].options].map(option => option.value)
    expect(levels).toEqual(['CASUAL', 'SKILLED', 'ELITE', 'PRO', 'MASTER'])
    expect(levels).not.toContain('AVERAGE_GOD')
  })

  it('keeps Average God out of the player application choices', async () => {
    wrapper = mountPage()
    await flushPromises()
    await wrapper.findAll('.boost-tabs button').find(button => button.text() === 'boost.applyBoosterTab').trigger('click')
    await flushPromises()

    const levels = wrapper.findAll('select')
      .map(select => select.findAll('option').map(option => option.element.value))
      .find(values => values.includes('MASTER'))
    expect(levels).toEqual(['CASUAL', 'SKILLED', 'ELITE', 'PRO', 'MASTER'])
    expect(levels).not.toContain('AVERAGE_GOD')
  })
})
