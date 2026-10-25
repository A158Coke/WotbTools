// @vitest-environment happy-dom

import { describe, expect, it } from 'vitest'
import { createApp, defineComponent, h, inject } from 'vue'
import { createShellChrome } from '../app/shellChrome.js'
import { SHELL_CHROME_KEY } from './shellChrome.js'

describe('shell chrome immersion', () => {
  it('stays immersive until every owner releases', () => {
    const chrome = createShellChrome()
    const a = Symbol('a')
    const b = Symbol('b')
    expect(chrome.immersive.value).toBe(false)
    chrome.request(a, true)
    chrome.request(b, true)
    chrome.request(a, true)
    expect(chrome.immersive.value).toBe(true)
    chrome.request(a, false)
    expect(chrome.immersive.value).toBe(true)
    chrome.request(b, false)
    expect(chrome.immersive.value).toBe(false)
  })

  it('releasing an owner that never requested is a no-op', () => {
    const chrome = createShellChrome()
    chrome.request(Symbol('stranger'), false)
    expect(chrome.immersive.value).toBe(false)
  })

  it('is injectable through the typed key', () => {
    const chrome = createShellChrome()
    let seen: unknown = null
    const Child = defineComponent({ setup() { seen = inject(SHELL_CHROME_KEY, null); return () => h('i') } })
    const app = createApp({ render: () => h(Child) })
    app.provide(SHELL_CHROME_KEY, chrome)
    app.mount(document.createElement('div'))
    expect(seen).toBe(chrome)
  })
})
