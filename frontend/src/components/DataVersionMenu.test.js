// @vitest-environment happy-dom

import { afterEach, describe, expect, it } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { createI18n } from 'vue-i18n'
import DataVersionMenu from './DataVersionMenu.vue'
import { messages } from '../locales/messages.js'

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
    title: 'release/11.21.0 · t11p2 · t11p2-20261106',
  },
  {
    value: '11.20.0',
    label: '11.20.0',
    tankCount: 730,
    preview: false,
    status: 'deprecated',
    title: 'release/11.20.0 · initial-20260901',
  },
]

let wrapper
function mountMenu(props = {}) {
  wrapper = mount(DataVersionMenu, {
    props: {
      modelValue: '',
      options: OPTIONS,
      defaultId: '11.21.0',
      label: '数据版本',
      ...props,
    },
    slots: {
      trigger: '<button type="button" class="dv-trigger">打开</button>',
    },
    global: { plugins: [i18n] },
    attachTo: document.body,
  })
  return wrapper
}

const trigger = () => wrapper.get('.dv-trigger')
const options = () => [...document.querySelectorAll('[role="option"]')]
const optionByText = (text) => options().find((element) => element.textContent.includes(text))
const key = (target, name) => target.dispatchEvent(new KeyboardEvent('keydown', { key: name, bubbles: true, cancelable: true }))
async function openByKeyboard() {
  key(trigger().element, 'ArrowDown')
  await flushPromises()
}

afterEach(() => {
  wrapper?.unmount()
  document.body.innerHTML = ''
})

describe('DataVersionMenu', () => {
  it('触发器带 aria-label；键盘打开后列出默认项与全部通道', async () => {
    mountMenu()
    expect(trigger().attributes('aria-label')).toBe('数据版本')
    expect(options()).toHaveLength(0)

    await openByKeyboard()
    expect(options()).toHaveLength(4)
    expect(options()[0].textContent).toContain('默认（跟随服务器）')
    expect(options()[0].textContent).toContain('服务器默认：11.21.0')
  })

  it('通道行展示版本来源、车辆数与预览徽标；弃用通道置灰不可选', async () => {
    mountMenu()
    await openByKeyboard()

    const supertest = optionByText('超测服')
    expect(supertest.textContent).toContain('release/11.21.0 · t11p2 · t11p2-20261106')
    expect(supertest.textContent).toContain('743 辆')
    expect(supertest.textContent).toContain('预览')

    const deprecated = optionByText('11.20.0')
    expect(deprecated.getAttribute('aria-disabled')).toBe('true')
    expect(deprecated.textContent).toContain('已弃用')
  })

  it('选择通道发出 dataset id；选择默认项发出空字符串', async () => {
    mountMenu({ modelValue: '11.21.0' })
    await openByKeyboard()

    const supertest = optionByText('超测服')
    supertest.focus()
    key(supertest, 'Enter')
    await flushPromises()
    expect(wrapper.emitted('select')).toEqual([['supertest']])

    mountMenu({ modelValue: 'supertest' })
    await openByKeyboard()
    const fallback = options()[0]
    fallback.focus()
    key(fallback, 'Enter')
    await flushPromises()
    expect(wrapper.emitted('select')).toEqual([['']])
  })

  it('禁用项不发出选择；Esc 关闭并把焦点还给触发器', async () => {
    mountMenu()
    await openByKeyboard()

    const deprecated = optionByText('11.20.0')
    deprecated.focus()
    key(deprecated, 'Enter')
    await flushPromises()
    expect(wrapper.emitted('select')).toBeUndefined()

    key(document.querySelector('[role="listbox"]'), 'Escape')
    await flushPromises()
    expect(document.querySelector('[role="listbox"]')).toBeNull()
    expect(document.activeElement).toBe(trigger().element)
  })
})