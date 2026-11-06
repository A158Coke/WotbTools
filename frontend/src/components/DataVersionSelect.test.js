// @vitest-environment happy-dom

import { ref } from 'vue'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { createI18n } from 'vue-i18n'
import { messages } from '../locales/messages.js'

const fake = vi.hoisted(() => ({ current: null }))

vi.mock('../composables/useDataVersion.js', () => ({
  useDataVersion: () => fake.current,
}))

const i18n = createI18n({ legacy: false, locale: 'zh', fallbackLocale: 'en', messages })

const OPTIONS = [
  {
    value: '11.21.0',
    label: '11.21.0',
    tankCount: 738,
    preview: false,
    status: 'active',
    title: 'release/11.21.0 · initial-20261019',
  },
  {
    value: 'supertest',
    label: '超测服',
    tankCount: 743,
    preview: true,
    status: 'active',
    title: 'release/11.21.0 · t11p2',
  },
]

function makeState(overrides = {}) {
  return {
    status: 'ready',
    datasets: [],
    defaultId: '11.21.0',
    error: null,
    ...overrides,
  }
}

async function mountSelect({ variant = 'setting', selected = '', state = makeState() } = {}) {
  fake.current = {
    state: ref(state),
    selected: ref(selected),
    options: ref(OPTIONS),
    select: vi.fn(),
  }
  const DataVersionSelect = (await import('./DataVersionSelect.vue')).default
  return mount(DataVersionSelect, {
    props: { id: 'data-version', variant },
    global: { plugins: [i18n] },
    attachTo: document.body,
  })
}

let wrapper
afterEach(() => {
  wrapper?.unmount()
  document.body.innerHTML = ''
})

describe('DataVersionSelect', () => {
  beforeEach(() => { fake.current = null })

  it('未选择时显示服务器默认文案，并保留提示行', async () => {
    wrapper = await mountSelect()
    expect(wrapper.get('#data-version').text()).toContain('默认（跟随服务器）')
    expect(wrapper.get('#data-version-hint').text()).toContain('切换后页面将重新加载')
  })

  it('已选择通道时显示通道 label', async () => {
    wrapper = await mountSelect({ selected: 'supertest' })
    expect(wrapper.get('#data-version').text()).toContain('超测服')
  })

  it('加载失败时 setting 变体显示错误文案，compact 变体隐藏', async () => {
    wrapper = await mountSelect({ state: makeState({ status: 'error', error: 'boom' }) })
    expect(wrapper.get('#data-version').text()).toContain('版本列表加载失败')
    wrapper.unmount()

    wrapper = await mountSelect({ variant: 'compact', state: makeState({ status: 'error', error: 'boom' }) })
    expect(wrapper.find('.data-version').exists()).toBe(false)
  })

  it('资产源未配置时完全隐藏', async () => {
    wrapper = await mountSelect({ state: makeState({ status: 'unavailable' }) })
    expect(wrapper.find('.data-version').exists()).toBe(false)
  })
})