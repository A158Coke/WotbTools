// @vitest-environment happy-dom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { ref } from 'vue'
import BoostPage from './BoostPage.vue'

const api = vi.hoisted(() => ({
  listBoosters: vi.fn(),
  updateBooster: vi.fn(),
  searchUsers: vi.fn(),
  createBoosterApplication: vi.fn()
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
    boostCreateBoosterApplication: api.createBoosterApplication,
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

async function setFiles(input, files) {
  Object.defineProperty(input.element, 'files', { value: files, configurable: true })
  await input.trigger('change')
  await flushPromises()
}

function stubDeferredFileReader() {
  const readers = []
  class DeferredFileReader {
    constructor() {
      this.onload = null
      this.onerror = null
      this.result = null
      readers.push(this)
    }

    readAsDataURL() {}
  }
  vi.stubGlobal('FileReader', DeferredFileReader)
  return readers
}

async function openApplication(wrapper) {
  await wrapper.findAll('.boost-tabs button').find(button => button.text() === 'boost.applyBoosterTab').trigger('click')
  await flushPromises()
  return wrapper.find('.boost-apply-card')
}

describe('BoostPage', () => {
  let wrapper

  beforeEach(() => {
    api.listBoosters.mockResolvedValue({ content: [booster], number: 0, size: 20, totalPages: 1 })
    api.updateBooster.mockResolvedValue(booster)
    api.searchUsers.mockResolvedValue([])
    api.createBoosterApplication.mockResolvedValue({ code: 'BOOSTER_APPLICATION_SUBMITTED' })
  })

  afterEach(() => {
    wrapper?.unmount()
    document.body.innerHTML = ''
    vi.unstubAllGlobals()
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

  it.each([
    ['overall', 0, 'late-overall.png'],
    ['vehicle', 1, 'late-vehicle.png'],
  ])('preserves a pending %s screenshot across tab switches', async (_kind, inputIndex, fileName) => {
    const readers = stubDeferredFileReader()
    wrapper = mountPage()
    await flushPromises()
    const application = await openApplication(wrapper)
    await setFiles(
      application.findAll('input[type="file"]')[inputIndex],
      [new File(['proof'], fileName, { type: 'image/png', lastModified: inputIndex + 1 })]
    )
    expect(readers).toHaveLength(1)

    await wrapper.findAll('.boost-tabs button').find(button => button.text() === 'boost.submitTab').trigger('click')
    expect(application.attributes('style')).toContain('display: none')
    readers[0].result = 'data:image/png;base64,AAAA'
    readers[0].onload()
    await flushPromises()

    await openApplication(wrapper)
    expect(wrapper.find('.boost-apply-card').text()).toContain(fileName)
  })

  it('keeps only the latest pending application image selection', async () => {
    const readers = stubDeferredFileReader()
    wrapper = mountPage()
    await flushPromises()
    const application = await openApplication(wrapper)
    const overallInput = application.findAll('input[type="file"]')[0]

    await setFiles(overallInput, [new File(['first'], 'first.png', { type: 'image/png' })])
    await setFiles(overallInput, [new File(['second'], 'second.png', { type: 'image/png' })])
    readers[0].result = 'data:image/png;base64,AAAA'
    readers[0].onload()
    readers[1].result = 'data:image/png;base64,BBBB'
    readers[1].onload()
    await flushPromises()

    expect(application.text()).not.toContain('first.png')
    expect(application.text()).toContain('second.png')
  })

  it('does not restore a pending image after successful application submission resets the draft', async () => {
    const readers = stubDeferredFileReader()
    wrapper = mountPage()
    await flushPromises()
    const application = await openApplication(wrapper)
    const [overallInput, vehicleInput] = application.findAll('input[type="file"]')

    await setFiles(overallInput, [new File(['old-overall'], 'old-overall.png', { type: 'image/png' })])
    readers[0].result = 'data:image/png;base64,AAAA'
    readers[0].onload()
    await setFiles(vehicleInput, [new File(['vehicle'], 'vehicle.png', { type: 'image/png' })])
    readers[1].result = 'data:image/png;base64,BBBB'
    readers[1].onload()
    await vi.waitFor(() => expect(application.text()).toContain('vehicle.png'))

    await setFiles(overallInput, [new File(['late'], 'late-overall.png', { type: 'image/png' })])
    expect(readers).toHaveLength(3)
    const inputs = application.findAll('input')
    await inputs[0].setValue('Player')
    await inputs[1].setValue('123')
    await inputs[4].setValue('123456')
    await inputs[6].setValue('20:00-22:00')
    await application.find('.btn-primary').trigger('click')
    await flushPromises()
    expect(api.createBoosterApplication).toHaveBeenCalledTimes(1)

    readers[2].result = 'data:image/png;base64,CCCC'
    readers[2].onload()
    await flushPromises()

    expect(application.text()).not.toContain('old-overall.png')
    expect(application.text()).not.toContain('late-overall.png')
    expect(application.text()).not.toContain('vehicle.png')
  })
})
