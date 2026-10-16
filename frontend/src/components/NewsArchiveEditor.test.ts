// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ref } from 'vue'
import { flushPromises, mount } from '@vue/test-utils'
import { createI18n } from 'vue-i18n'
import { messages } from '../locales/messages.js'
import { DIALOG_INLINE_KEY } from '../shared/dialog.js'
import NewsArchiveEditor from './NewsArchiveEditor.vue'
import type { NewsArticle, NewsCategory, NewsCreateRequest } from '../api/game-announcements.js'
vi.mock('../composables/useAuth.js', () => ({ useAuth: () => ({ tokenParsed: ref({ sub: 'one' }), isNewsAdmin: ref(true) }) }))
// happy-dom is not a supported DOMPurify security DOM. Actual sanitation is verified in the browser gate.
vi.mock('./NewsContent.vue', () => ({ default: { props: ['html'], template: '<div v-html="html" />' } }))
const source = (key: string): NewsArticle => ({ sourceKey: key, title: key, sourceUrl: 'https://asia.wotblitz.com/en/news/updates/update/', language: 'en', publishedAtRaw: null, coverImageId: null, revision: `revision-${key}`, sync: null,
  blocks: [{ id: `${key}-heading`, html: `<h3>${key} heading</h3>` }, { id: `${key}-list`, html: `<ul><li>${key} list item</li></ul>` }, { id: `${key}-table`, html: `<table><tbody><tr><td>${key} table cell</td></tr></tbody></table>` }] })
const categories: NewsCategory[] = [{ id: 1, name: '版本更新', type: 'GENERAL' }, { id: 2, name: 'Vehicles', type: 'SPECIALIZED' }, { id: 3, name: 'Mechanics', type: 'SPECIALIZED' }]
const wrappers: ReturnType<typeof mount>[] = []
afterEach(() => { wrappers.splice(0).forEach(wrapper => wrapper.unmount()) })
function editor(articles = [source('first'), source('second')]) {
  const wrapper = mount(NewsArchiveEditor, { props: { articles, categories, busy: false, errorText: '' }, global: {
    plugins: [createI18n({ legacy: false, locale: 'en', messages })], provide: { [DIALOG_INLINE_KEY]: true },
  } }); wrappers.push(wrapper); return wrapper
}
const button = (wrapper: ReturnType<typeof editor>, text: string) => wrapper.findAll('button').find(value => value.text() === text)!
describe('news block selection and review submission', () => {
  it('keeps complete selected blocks in original order while reordering articles', async () => {
    const wrapper = editor()
    await wrapper.get('[data-testid=news-merge-version]').setValue('11.21')
    await wrapper.get('[data-testid=news-block-0-0]').setValue(false)
    await wrapper.findAll('button').find(value => value.attributes('aria-label') === 'Move article down: first')!.trigger('click')
    await button(wrapper, 'View final preview').trigger('click'); await flushPromises()
    const preview = wrapper.get('[data-testid=news-final-preview]')
    expect(preview.text()).not.toContain('first heading')
    expect(preview.text()).toContain('first list item'); expect(preview.findAll('table')).toHaveLength(2)
    await wrapper.get('[data-testid=news-submit]').trigger('click')
    const request = wrapper.emitted('save')![0][0] as NewsCreateRequest
    expect(request.archives[0].articles.map(value => value.sourceKey)).toEqual(['second', 'first'])
    expect(request.archives[0].articles[1]).toEqual({ sourceKey: 'first', revision: 'revision-first', blockIds: ['first-list', 'first-table'] })
    expect(request.archives[0].categoryIds).toEqual([1])
  })
  it('blocks empty selections and two specialized categories before final preview', async () => {
    const wrapper = editor([source('first')])
    await wrapper.get('[data-testid=news-merge-version]').setValue('11.21')
    const categories = wrapper.findAll('.news-categories input')
    await categories[1].setValue(true); await categories[2].setValue(true)
    await button(wrapper, 'View final preview').trigger('click')
    expect(wrapper.find('[data-testid=news-final-preview]').exists()).toBe(false)
    await categories[2].setValue(false)
    await button(wrapper, 'Clear selection').trigger('click')
    await button(wrapper, 'View final preview').trigger('click')
    expect(wrapper.find('[data-testid=news-submit]').exists()).toBe(false)
  })
  it('freezes the submitted payload and reuses the UUID when a network attempt fails', async () => {
    const wrapper = editor([source('first')])
    await wrapper.get('[data-testid=news-merge-version]').setValue('11.21')
    await button(wrapper, 'View final preview').trigger('click')
    await wrapper.get('[data-testid=news-submit]').trigger('click')
    const first = JSON.stringify(wrapper.emitted('save')![0][0])
    await wrapper.setProps({ errorText: 'Network error' })
    expect(wrapper.get('fieldset').attributes('disabled')).toBeDefined()
    await wrapper.get('[data-testid=news-submit]').trigger('click')
    expect(JSON.stringify(wrapper.emitted('save')![1][0])).toBe(first)
  })
  it('creates independent metadata and category choices in separate mode', async () => {
    const wrapper = editor()
    await wrapper.get('input[type=radio][value=separate]').setValue(true)
    for (const [index, entry] of wrapper.findAll('.news-entry').entries()) {
      await entry.findAll('input:not([type=checkbox])')[0].setValue(`11.${index}`)
    }
    await wrapper.findAll('.news-entry')[1].findAll('.news-categories input')[1].setValue(true)
    await button(wrapper, 'View final preview').trigger('click')
    await wrapper.get('[data-testid=news-submit]').trigger('click')
    const request = wrapper.emitted('save')![0][0] as NewsCreateRequest
    expect(request.archives).toHaveLength(2)
    expect(request.archives[0]).toMatchObject({ version: '11.0', categoryIds: [1] })
    expect(request.archives[1]).toMatchObject({ version: '11.1', categoryIds: [1, 2] })
  })
})
