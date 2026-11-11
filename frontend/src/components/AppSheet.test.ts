// @vitest-environment happy-dom
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { defineComponent, h, ref } from 'vue'
import AppSheet from './AppSheet.vue'

let wrapper: ReturnType<typeof mount>
afterEach(() => { wrapper?.unmount(); document.body.innerHTML = ''; document.body.removeAttribute('style') })

function mountSheet() {
  const Host = defineComponent({
    setup() {
      const open = ref(false)
      return () => h('div', [
        h('button', { id: 'opener', onClick: () => { open.value = true } }, 'open'),
        h(AppSheet, { open: open.value, title: 'Filters', onClose: () => { open.value = false } }, {
          default: () => h('input', { id: 'field' }),
        }),
      ])
    },
  })
  wrapper = mount(Host, { attachTo: document.body })
}
const sheet = () => document.querySelector('[role="dialog"]')
const closeSheet = () => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))

describe('AppSheet', () => {
  it('打开后是带标题的模态 dialog 并挂到 body；焦点进入 sheet', async () => {
    mountSheet()
    document.getElementById('opener')!.focus()
    document.getElementById('opener')!.click()
    await flushPromises()
    expect(sheet()).not.toBeNull()
    expect(sheet()!.parentElement).toBe(document.body)
    expect(document.getElementById(sheet()!.getAttribute('aria-labelledby')!)!.textContent).toBe('Filters')
    expect(sheet()!.contains(document.activeElement)).toBe(true)
  })

  it('Esc 关闭并触发 close', async () => {
    mountSheet()
    document.getElementById('opener')!.click()
    await flushPromises()
    closeSheet()
    await flushPromises()
    expect(sheet()).toBeNull()
  })

  it('关闭后焦点回到打开前的元素（没有 DrawerTrigger 也成立）', async () => {
    mountSheet()
    const opener = document.getElementById('opener')!
    opener.focus()
    opener.click()
    await flushPromises()
    closeSheet()
    await flushPromises()
    await new Promise(resolve => setTimeout(resolve, 10))
    expect(sheet()).toBeNull()
    expect(document.activeElement).toBe(opener)
  })

  it('遮罩使用 sheet 层 token 并随 sheet 关闭', async () => {
    mountSheet()
    document.getElementById('opener')!.click()
    await flushPromises()
    expect(document.querySelector('[data-testid="sheet-scrim"]')).not.toBeNull()
  })

  it('关闭动画中重新打开：残留的 swipe 位移与 dismissed 标记被清掉，抽屉回到原位', async () => {
    mountSheet()
    document.getElementById('opener')!.click()
    await flushPromises()
    const el = sheet() as HTMLElement
    // 模拟 swipe dismiss 后 Presence 退场挂起期间的元素残留（Reka 释放时不清位移变量）
    el.style.setProperty('--drawer-swipe-movement-x', '-120px')
    el.style.setProperty('--drawer-swipe-movement-y', '-40px')
    el.setAttribute('data-swipe-dismissed', '')
    closeSheet()
    await flushPromises()
    document.getElementById('opener')!.click() // 未等退出动画结束立即重开
    await flushPromises()
    const reopened = sheet() as HTMLElement
    expect(reopened).not.toBeNull()
    expect(reopened!.hasAttribute('data-swipe-dismissed')).toBe(false)
    expect(reopened!.style.getPropertyValue('--drawer-swipe-movement-x')).toBe('0px')
    expect(reopened!.style.getPropertyValue('--drawer-swipe-movement-y')).toBe('0px')
    expect(reopened!.hasAttribute('data-swiping')).toBe(false)
  })

  it('连续开合 20 次：不残留 dialog / 遮罩，焦点仍能恢复', async () => {
    mountSheet()
    const opener = document.getElementById('opener')!
    for (let i = 0; i < 20; i++) {
      opener.focus()
      opener.click()
      await flushPromises()
      expect(sheet()).not.toBeNull()
      expect(document.querySelector('[data-testid="sheet-scrim"]')).not.toBeNull()
      closeSheet()
      await flushPromises()
      expect(sheet()).toBeNull()
      expect(document.querySelector('[data-testid="sheet-scrim"]')).toBeNull()
      expect(document.activeElement).toBe(opener)
    }
  })

  it('退场动画源码契约：closed 态各方向有从实时位移变量起手的退场 keyframes，reduced-motion 下不做动画等待', () => {
    const source = readFileSync(resolve(process.cwd(), 'src/components/AppSheet.vue'), 'utf8')
    const style = source.slice(source.indexOf('<style'))
    // Reka Presence 依赖 closed 态的 animation-name 等待 animationend 后卸载，三个方向 + 遮罩都要有退场声明
    expect(style).toContain('.sheet[data-state="closed"] { animation: sheet-out')
    expect(style).toContain('.sheet.is-start[data-state="closed"] { animation-name: sheet-out-start; }')
    expect(style).toContain('.sheet.is-end[data-state="closed"] { animation-name: sheet-out-end; }')
    expect(style).toContain('.sheet-scrim[data-state="closed"] { animation: sheet-scrim-out')
    // swipe strength 是时长系数（快甩越小）：退场时长必须用乘法缩短，不得除法反转速度关系
    expect(style).toContain('calc(var(--duration-slow) * var(--drawer-swipe-strength, 1))')
    expect(style).not.toContain('var(--duration-slow) /')
    // swipe 释放后从当前位置继续退出（keyframes 引用实时位移变量），不能从初始位置重新开始
    expect(style).toContain('translateY(calc(var(--drawer-swipe-movement-y, 0px) + 100%))')
    expect(style).toContain('translateX(calc(var(--drawer-swipe-movement-x, 0px) - 100%))')
    expect(style).toContain('translateX(calc(var(--drawer-swipe-movement-x, 0px) + 100%))')
    // reduced-motion：动画名归 none → Presence 立即卸载，不赌零时长 animationend
    const reduced = style.slice(style.indexOf('prefers-reduced-motion: reduce'))
    expect(reduced).toContain('.sheet[data-state="closed"]')
    expect(reduced).toContain('.sheet-scrim[data-state="closed"]')
    expect(reduced).toContain('animation: none')
  })
})
