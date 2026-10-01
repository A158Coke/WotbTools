// @vitest-environment happy-dom

import { describe, expect, it, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { ref } from 'vue'
import VehiclePicker from './VehiclePicker.vue'

vi.mock('vue-i18n', () => ({
  useI18n: () => ({ locale: ref('zh'), t: key => key }),
}))

const OPTIONS = [
  { id: 385, label: 'Progetto 65', hint: 'T10 · EUROPE' },
  { id: 6481, label: 'FV4005', hint: 'T10 · UK' },
  { id: 999, label: 'Object 261', hint: 'T10 · USSR', search: '261' },
]

function mountPicker(props = {}) {
  return mount(VehiclePicker, {
    props: { options: OPTIONS, modelValue: null, nullLabel: 'all', ...props },
    attachTo: document.body,
  })
}

const input = wrapper => wrapper.find('input[role="combobox"]')
const optionLabels = wrapper => wrapper.findAll('[role="option"]').map(option => option.find('.vp-label').text())

describe('VehiclePicker', () => {
  it('exposes the ARIA combobox contract and opens the listbox on ArrowDown', async () => {
    const wrapper = mountPicker()
    const box = input(wrapper)
    const listId = box.attributes('aria-controls')
    expect(box.attributes('aria-expanded')).toBe('false')
    expect(wrapper.find(`#${listId}`).attributes('role')).toBe('listbox')

    await box.trigger('keydown', { key: 'ArrowDown' })
    expect(box.attributes('aria-expanded')).toBe('true')
    expect(optionLabels(wrapper)).toEqual(['all', 'Progetto 65', 'FV4005', 'Object 261'])
    // 打开时高亮当前值（null → 「全部」）
    expect(box.attributes('aria-activedescendant')).toBe(wrapper.findAll('[role="option"]')[0].attributes('id'))
    wrapper.unmount()
  })

  it('filters by fuzzy name, moves with arrows and selects with Enter', async () => {
    const wrapper = mountPicker()
    const box = input(wrapper)
    box.element.value = 'fv'
    await box.trigger('input')
    expect(optionLabels(wrapper)).toEqual(['FV4005'])

    box.element.value = 'obj'
    await box.trigger('input')
    expect(optionLabels(wrapper)).toEqual(['Object 261'])
    await box.trigger('keydown', { key: 'Enter' })
    expect(wrapper.emitted('update:modelValue')).toEqual([[999]])
    expect(wrapper.emitted('change')).toEqual([[999]])
    expect(box.attributes('aria-expanded')).toBe('false')
    wrapper.unmount()
  })

  it('wraps around with ArrowUp and shows an empty state when nothing matches', async () => {
    const wrapper = mountPicker({ modelValue: 385 })
    const box = input(wrapper)
    await box.trigger('keydown', { key: 'ArrowDown' })
    const ids = wrapper.findAll('[role="option"]').map(option => option.attributes('id'))
    expect(box.attributes('aria-activedescendant')).toBe(ids[1])
    await box.trigger('keydown', { key: 'ArrowUp' })
    await box.trigger('keydown', { key: 'ArrowUp' })
    expect(box.attributes('aria-activedescendant')).toBe(ids[3])

    box.element.value = 'zzzz'
    await box.trigger('input')
    expect(wrapper.findAll('[role="option"]')).toHaveLength(0)
    expect(wrapper.find('.vp-empty').text()).toBe('vehiclePicker.noResults')
    wrapper.unmount()
  })

  it('Escape closes the list without changing the value and does not bubble to dialogs', async () => {
    const wrapper = mountPicker({ modelValue: 6481 })
    const outer = vi.fn()
    wrapper.element.parentElement.addEventListener('keydown', outer)
    const box = input(wrapper)
    await box.trigger('click')
    box.element.value = 'prog'
    await box.trigger('input')
    await box.trigger('keydown', { key: 'Escape' })
    expect(box.attributes('aria-expanded')).toBe('false')
    expect(box.element.value).toBe('FV4005')
    expect(wrapper.emitted('update:modelValue')).toBeUndefined()
    expect(outer).not.toHaveBeenCalled()
    wrapper.element.parentElement.removeEventListener('keydown', outer)
    wrapper.unmount()
  })

  it('selects with a click and clears back to null', async () => {
    const wrapper = mountPicker({ modelValue: 385 })
    await input(wrapper).trigger('click')
    await wrapper.find('[role="option"][data-id="6481"]').trigger('click')
    expect(wrapper.emitted('update:modelValue')).toEqual([[6481]])

    await wrapper.find('button[aria-label="vehiclePicker.clear"]').trigger('click')
    expect(wrapper.emitted('update:modelValue').at(-1)).toEqual([null])
    wrapper.unmount()
  })

  it('keeps showing a selected id that is not among the options', async () => {
    const withFallback = mountPicker({ modelValue: 4657, fallbackLabel: 'Kranvagn' })
    expect(input(withFallback).element.value).toBe('Kranvagn')
    withFallback.unmount()

    const withoutFallback = mountPicker({ modelValue: 4657 })
    expect(input(withoutFallback).element.value).toBe('#4657')
    expect(input(withoutFallback).attributes('data-value')).toBe('4657')
    withoutFallback.unmount()
  })

  it('has no null option or clear button when nullLabel is not provided', async () => {
    const wrapper = mountPicker({ nullLabel: '', placeholder: 'choose', modelValue: 385 })
    expect(wrapper.find('button[aria-label="vehiclePicker.clear"]').exists()).toBe(false)
    await input(wrapper).trigger('click')
    expect(optionLabels(wrapper)).toEqual(['Progetto 65', 'FV4005', 'Object 261'])
    wrapper.unmount()
  })
})
