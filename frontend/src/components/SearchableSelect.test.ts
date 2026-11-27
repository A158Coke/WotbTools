// @vitest-environment happy-dom
import { mount } from '@vue/test-utils'
import { describe, expect, it, vi } from 'vitest'
import SearchableSelect from './SearchableSelect.vue'

vi.mock('vue-i18n', () => ({ useI18n: () => ({ t: (key: string) => key, locale: { value: 'en' } }) }))
const options = [{ value: 'erlenberg', label: 'Middleburg' }, { value: 'karieri', label: 'Copperfield' }]
function picker() {
  return mount(SearchableSelect, {
    attachTo: document.body,
    props: { modelValue: 'erlenberg', options, inputId: 'test-picker', label: 'Map', emptyLabel: 'All' },
  })
}
describe('SearchableSelect', () => {
  it('separates selection, keyboard highlight and local search, including unmatched text', async () => {
    const view = picker()
    const input = view.get<HTMLInputElement>('[role=combobox]')
    input.element.focus()
    await input.trigger('keydown', { key: 'ArrowDown' })
    const active = () => document.getElementById(input.attributes('aria-activedescendant')!)
    expect(active()?.textContent?.trim()).toBe('Middleburg')
    await input.trigger('keydown', { key: 'ArrowDown' })
    expect(active()?.getAttribute('aria-selected')).toBe('false')
    expect(view.get('[aria-selected=true]').text()).toBe('Middleburg')
    await input.setValue('UNMATCHED')
    expect(input.attributes('aria-activedescendant')).toBeUndefined()
    expect(view.get('[role=status]').text()).toBe('searchableSelect.noResults')
    await input.trigger('keydown', { key: 'Enter' })
    expect(view.emitted('update:modelValue')).toBeUndefined()
    await input.setValue('KARIERI')
    await input.trigger('keydown', { key: 'Enter', isComposing: true })
    expect(view.emitted('update:modelValue')).toBeUndefined()
    expect(input.attributes('aria-expanded')).toBe('true')
    await input.trigger('keydown', { key: 'Enter' })
    expect(view.emitted('update:modelValue')).toEqual([['karieri']])
    expect(document.activeElement).toBe(input.element)
    view.unmount()
  })
  it('consumes only the first Escape, lets Tab leave and clears explicitly when allowed', async () => {
    const view = picker()
    const input = view.get<HTMLInputElement>('[role=combobox]')
    input.element.focus()
    await input.trigger('click')
    await input.setValue('cop')
    const first = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })
    input.element.dispatchEvent(first)
    await view.vm.$nextTick()
    expect(first.defaultPrevented).toBe(true)
    expect(input.element.value).toBe('Middleburg')
    const second = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })
    input.element.dispatchEvent(second)
    expect(second.defaultPrevented).toBe(false)
    await input.trigger('click')
    await input.trigger('keydown', { key: 'Tab' })
    expect(input.attributes('aria-expanded')).toBe('false')
    await view.get('button[aria-label="searchableSelect.clear"]').trigger('click')
    expect(view.emitted('update:modelValue')).toEqual([['']])
    expect(document.activeElement).toBe(input.element)
    await view.setProps({ emptyLabel: undefined })
    expect(view.find('button[aria-label="searchableSelect.clear"]').exists()).toBe(false)
    view.unmount()
  })
  it('keeps active descendant valid when the domain changes or becomes empty', async () => {
    const view = picker()
    const input = view.get('[role=combobox]')
    await input.trigger('click')
    await view.setProps({ options: [options[1]], emptyLabel: undefined })
    expect(document.getElementById(input.attributes('aria-activedescendant')!)?.textContent?.trim()).toBe('Copperfield')
    await view.setProps({ options: [] })
    expect(input.attributes('aria-activedescendant')).toBeUndefined()
    await view.setProps({ disabled: true })
    expect(input.attributes('aria-expanded')).toBe('false')
    view.unmount()
  })
})
