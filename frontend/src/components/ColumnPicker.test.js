// @vitest-environment happy-dom

import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import ColumnPicker from './ColumnPicker.vue'

// 固定列（League 模式 nickname/league_rating 语义）+ 三个可移动列。
const ORDER = ['nickname', 'league_rating', 'damage', 'wins', 'kills']
const FIXED = ['nickname', 'league_rating']

function mountPicker(props = {}) {
  return mount(ColumnPicker, {
    props: { scope: 'player', order: ORDER, visible: ORDER, fixedKeys: FIXED, ...props },
    global: { mocks: { $t: key => key } },
  })
}

describe('ColumnPicker 上下移按钮（触屏/键盘重排序）', () => {
  it('下移按钮与 HTML5 drop 产生完全一致的 reorder 数组（同一 move 逻辑）', async () => {
    // 按钮路径：damage(idx 2) 下移一位 → idx 3
    const viaButton = mountPicker()
    const damageDown = viaButton.findAll('.collist li')[2].findAll('.colmove-btn')[1]
    await damageDown.trigger('click')
    const buttonOrder = viaButton.emitted('reorder')?.[0]?.[0]
    expect(buttonOrder).toEqual(['nickname', 'league_rating', 'wins', 'damage', 'kills'])

    // 拖拽路径：从 idx 2 drop 到 idx 3 —— 结果必须逐键相同
    const viaDrop = mountPicker()
    const lis = viaDrop.findAll('.collist li')
    await lis[2].trigger('dragstart')
    await lis[3].trigger('drop')
    const dropOrder = viaDrop.emitted('reorder')?.[0]?.[0]
    expect(dropOrder).toEqual(buttonOrder)
  })

  it('上移按钮把列上移一位', async () => {
    const wrapper = mountPicker()
    const winsUp = wrapper.findAll('.collist li')[3].findAll('.colmove-btn')[0]
    await winsUp.trigger('click')
    expect(wrapper.emitted('reorder')?.[0]?.[0])
      .toEqual(['nickname', 'league_rating', 'wins', 'damage', 'kills'])
  })

  it('fixedKeys 项不渲染上下移按钮；可移动项渲染两个按钮且 aria-label 走 col_picker locale key', () => {
    const wrapper = mountPicker()
    const lis = wrapper.findAll('.collist li')
    expect(lis).toHaveLength(5)
    expect(lis[0].findAll('.colmove-btn')).toHaveLength(0)
    expect(lis[1].findAll('.colmove-btn')).toHaveLength(0)
    const damageButtons = lis[2].findAll('.colmove-btn')
    expect(damageButtons).toHaveLength(2)
    expect(damageButtons[0].attributes('aria-label')).toBe('col_picker.move_up')
    expect(damageButtons[1].attributes('aria-label')).toBe('col_picker.move_down')
  })

  it('边界禁用：首项不可上移、末项不可下移，禁用态点击不产生 reorder', async () => {
    const wrapper = mountPicker({ order: ['a', 'b', 'c'], visible: ['a', 'b', 'c'], fixedKeys: [] })
    const lis = wrapper.findAll('.collist li')
    const [firstUp, firstDown] = lis[0].findAll('.colmove-btn')
    expect(firstUp.attributes('disabled')).toBeDefined()
    expect(firstDown.attributes('disabled')).toBeUndefined()
    const [lastUp, lastDown] = lis[2].findAll('.colmove-btn')
    expect(lastUp.attributes('disabled')).toBeUndefined()
    expect(lastDown.attributes('disabled')).toBeDefined()

    await firstUp.trigger('click')
    await lastDown.trigger('click')
    expect(wrapper.emitted('reorder')).toBeFalsy()
  })
})
