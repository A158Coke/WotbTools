// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ref } from 'vue'
import { mount, flushPromises } from '@vue/test-utils'
import NewsContent from './NewsContent.vue'
const state = vi.hoisted(() => ({ auth: null as any, image: vi.fn() }))
vi.mock('../composables/useAuth.js', () => ({ useAuth: () => state.auth }))
vi.mock('../api/game-announcements.js', async original => ({ ...await original<object>(), getManagedNewsImage: state.image }))
// Test our URL/identity owner against an inert fragment. DOMPurify itself requires a real browser DOM.
vi.mock('dompurify', () => ({ default: { sanitize(html: string) { const template = document.createElement('template'); template.innerHTML = html; return template.content } } }))
const wrappers: ReturnType<typeof mount>[] = []
beforeEach(() => {
  state.auth = { tokenParsed: ref({ sub: 'one' }), isNewsAdmin: ref(true) }; state.image.mockReset()
  state.image.mockResolvedValue(new Blob(['png'], { type: 'image/png' }))
  vi.stubGlobal('URL', class extends URL { static createObjectURL = vi.fn(() => 'blob:review-image'); static revokeObjectURL = vi.fn() })
})
afterEach(() => { wrappers.splice(0).forEach(wrapper => wrapper.unmount()); vi.unstubAllGlobals(); vi.unstubAllEnvs() })
function content(html: string, managed = false) {
  const wrapper = mount(NewsContent, { props: { html, managed }, global: { mocks: { $t: (key: string) => key } } }); wrappers.push(wrapper); return wrapper
}
describe('news HTML rendering boundary', () => {
  it('only renders owned image URLs and preserves complete sanitized tables', async () => {
    vi.stubEnv('MODE', 'android')
    const wrapper = content('<p>Text</p><img src="https://bad.example/track"><img src="/api/news/source-images/hash"><table><tr><td>Cell</td></tr></table><a href="javascript:alert(1)">Bad</a>')
    await flushPromises()
    expect(wrapper.get('p').text()).toBe('Text'); expect(wrapper.findAll('img')).toHaveLength(1)
    expect(wrapper.get('img').attributes('src')).toBe('https://wotbtools.com/api/news/source-images/hash')
    expect(wrapper.get('td').text()).toBe('Cell'); expect(wrapper.get('a').attributes('href')).toBeUndefined()
  })
  it('uses bearer-loaded blobs for managed snapshots and revokes them on role loss', async () => {
    const wrapper = content('<img src="/api/news/images/id">', true); await flushPromises()
    expect(wrapper.get('img').attributes('src')).toBe('blob:review-image')
    state.auth.isNewsAdmin.value = false; await flushPromises()
    expect(wrapper.find('img').exists()).toBe(false); expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:review-image')
  })
  it('does not publish a late private image after another account takes ownership', async () => {
    let finish!: (value: Blob) => void
    state.image.mockImplementationOnce(() => new Promise(resolve => { finish = resolve }))
    const wrapper = content('<img src="/api/news/images/id">', true)
    state.auth.tokenParsed.value = { sub: 'two' }; state.auth.isNewsAdmin.value = false; await flushPromises()
    finish(new Blob(['png'], { type: 'image/png' })); await flushPromises()
    expect(wrapper.find('img').exists()).toBe(false); expect(URL.createObjectURL).not.toHaveBeenCalled()
  })
  it('uses the frozen archive source endpoint for failed preparation previews', async () => {
    const wrapper = mount(NewsContent, { props: { html: '<img src="/api/news/source-images/sourcehash">', managed: true, archiveId: 7 }, global: { mocks: { $t: (key: string) => key } } })
    wrappers.push(wrapper); await flushPromises()
    expect(state.image).toHaveBeenCalledWith('sourcehash', expect.any(AbortSignal), 7)
    expect(wrapper.get('img').attributes('src')).toBe('blob:review-image')
  })
})
