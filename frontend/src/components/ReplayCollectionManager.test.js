// @vitest-environment happy-dom

import { describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { ref } from 'vue'
import ReplayCollectionManager from './ReplayCollectionManager.vue'
import { DIALOG_INLINE_KEY } from '../shared/dialog.js'

const breakpoint = vi.hoisted(() => ({ compact: null }))
vi.mock('../composables/useBreakpoint.js', () => ({ useBreakpoint: () => ({ isCompact: breakpoint.compact }) }))
vi.mock('vue-i18n', () => ({
  useI18n: () => ({ t: (key, values) => (values ? `${key}:${Object.values(values).join(',')}` : key) }),
}))

const row = (index, extra = {}) => ({
  key: `k${index}`, file: new File(['x'], `f${index}.wotbreplay`), fileName: `f${index}.wotbreplay`,
  title: `第 ${index + 1} 场 · 绝望堡垒`, meta: 'RFOUR 胜 · 10/02 15:47', status: 'ready', current: false,
  search: `第 ${index + 1} 场 绝望堡垒 f${index}.wotbreplay`, ...extra,
})

async function open(props = {}, { compact = false } = {}) {
  breakpoint.compact = ref(compact)
  const wrapper = mount(ReplayCollectionManager, {
    props: { rows: [row(0, { current: true }), row(1)], folderAvailable: true, ...props },
    attachTo: document.body,
    global: { provide: { [DIALOG_INLINE_KEY]: true }, mocks: { $t: key => key } },
  })
  await wrapper.get('[data-testid="collection-trigger"]').trigger('click')
  await flushPromises()
  return wrapper
}

describe('ReplayCollectionManager', () => {
  it('leads with battle information and keeps the file name as a tooltip', async () => {
    const wrapper = await open()
    const first = wrapper.findAll('[data-testid="collection-row"]')[0]
    expect(first.text()).toContain('第 1 场 · 绝望堡垒')
    expect(first.text()).toContain('RFOUR 胜 · 10/02 15:47')
    expect(first.text()).not.toContain('.wotbreplay')
    expect(first.attributes('title')).toBe('f0.wotbreplay')
    expect(first.find('[data-testid="collection-current"]').exists()).toBe(true)
    wrapper.unmount()
  })

  it('manages the collection but never switches battle: rows only offer removal', async () => {
    const wrapper = await open()
    const rows = wrapper.findAll('[data-testid="collection-row"]')
    expect(rows[1].findAll('button')).toHaveLength(1)
    await rows[1].trigger('click')
    expect(wrapper.emitted('remove')).toBeUndefined()
    await rows[1].get('[data-testid="collection-remove"]').trigger('click')
    expect(wrapper.emitted('remove')[0][0].name).toBe('f1.wotbreplay')
    await flushPromises()
    expect(wrapper.find('[data-testid="collection-row"]').exists()).toBe(false)
    wrapper.unmount()
  })

  it('keeps add file, add folder and sample entries; folder follows availability', async () => {
    const wrapper = await open()
    await wrapper.get('[data-testid="collection-add-files"]').trigger('click')
    await wrapper.get('[data-testid="collection-add-folder"]').trigger('click')
    expect(wrapper.emitted('add-files')).toHaveLength(1)
    expect(wrapper.emitted('add-folder')).toHaveLength(1)
    await wrapper.setProps({ folderAvailable: false })
    expect(wrapper.find('[data-testid="collection-add-folder"]').exists()).toBe(false)
    wrapper.unmount()
  })

  it('clear all needs a second step and cancelling keeps the list', async () => {
    const wrapper = await open()
    await wrapper.get('[data-testid="collection-clear"]').trigger('click')
    expect(wrapper.emitted('clear')).toBeUndefined()
    await wrapper.get('[data-testid="collection-clear-cancel"]').trigger('click')
    expect(wrapper.emitted('clear')).toBeUndefined()
    await wrapper.get('[data-testid="collection-clear"]').trigger('click')
    await wrapper.get('[data-testid="collection-clear-confirm"]').trigger('click')
    expect(wrapper.emitted('clear')).toHaveLength(1)
    wrapper.unmount()
  })

  it('searches from seven rows by file name, map and winner', async () => {
    const wrapper = await open({ rows: Array.from({ length: 7 }, (_, i) => row(i)) })
    await wrapper.get('[data-testid="collection-search"]').setValue('f3.wotbreplay')
    expect(wrapper.findAll('[data-testid="collection-row"]')).toHaveLength(1)
    wrapper.unmount()
  })

  it('shows row problems as words and counts failures on the trigger', async () => {
    const wrapper = await open({ rows: [row(0), row(1, { status: 'failed', title: 'f1.wotbreplay', meta: '' }), row(2, { status: 'loading' })] })
    expect(wrapper.findAll('[data-testid="collection-row"]')[1].text()).toContain('upload.row_failed')
    expect(wrapper.findAll('[data-testid="collection-row"]')[2].text()).toContain('upload.row_loading')
    expect(wrapper.get('[data-testid="collection-trigger"]').text()).toBe('upload.manage_failed:3,1')
    wrapper.unmount()
  })

  it('reports background loading next to the trigger', async () => {
    const wrapper = await open({ progress: { done: 1, total: 3 } })
    expect(wrapper.get('[data-testid="collection-progress"]').text()).toBe('upload.adding_progress:1,3')
    expect(wrapper.get('[data-testid="collection-trigger"]').attributes('aria-busy')).toBe('true')
    wrapper.unmount()
  })

  it('uses a bottom sheet on phones', async () => {
    const wrapper = await open({}, { compact: true })
    expect(document.querySelector('[data-testid="replay-collection"]')).not.toBeNull()
    wrapper.unmount()
  })
})
