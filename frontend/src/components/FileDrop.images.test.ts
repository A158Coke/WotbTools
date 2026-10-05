// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import FileDrop from './FileDrop.vue'
vi.mock('vue-i18n', () => ({ useI18n: () => ({ t: (key: string) => key }) }))
function uploader(disabled = false) { return mount(FileDrop, { props: { files: [], purpose: 'image', disabled }, global: { mocks: { $t: (key: string) => key } } }) }
async function pick(wrapper: ReturnType<typeof uploader>, files: File[]) {
  const input = wrapper.get('[data-testid="tournament-image-input"]')
  Object.defineProperty(input.element, 'files', { value: files, configurable: true })
  await input.trigger('change')
}
describe('shared image picker', () => {
  it('allows PNG/JPEG screenshots and provides one keyboard-reachable picker trigger', async () => {
    const wrapper = uploader()
    const png = new File(['x'], 'one.png', { type: 'image/png' })
    const jpeg = new File(['x'], 'two.jpg', { type: 'image/jpeg' })
    await pick(wrapper, [png, jpeg])
    expect(wrapper.emitted('update:files')?.[0][0]).toEqual([png, jpeg])
    expect(wrapper.get('input').attributes('tabindex')).toBe('-1')
    expect(wrapper.findAll('button').some(button => button.text() === 'tournament.selectImages')).toBe(true)
    expect(wrapper.find('[webkitdirectory]').exists()).toBe(false)
  })
  it.each(['image/gif', 'image/webp', 'application/octet-stream'])('rejects %s without mutating selection', async type => {
    const wrapper = uploader()
    await pick(wrapper, [new File(['x'], 'bad', { type })])
    expect(wrapper.emitted('update:files')).toBeUndefined()
    expect(wrapper.text()).toContain('tournament.imageInvalid')
  })
  it('cannot select or drag-upload while rules/group count disable the uploader', async () => {
    const wrapper = uploader(true)
    await wrapper.trigger('drop', { dataTransfer: { files: [new File(['x'], 'one.png', { type: 'image/png' })] } })
    expect(wrapper.emitted('update:files')).toBeUndefined()
    expect(wrapper.get('input').attributes('disabled')).toBeDefined()
  })
})
