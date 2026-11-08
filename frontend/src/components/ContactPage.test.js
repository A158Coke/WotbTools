// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import ContactPage from './ContactPage.vue'
import { FEEDBACK_KEY } from '../shared/feedback.js'
import { messages } from '../locales/messages.js'

function mountPage(openFeedback = vi.fn()) {
  return mount(ContactPage, {
    global: { mocks: { $t: key => key }, provide: { [FEEDBACK_KEY]: openFeedback } },
  })
}

describe('ContactPage', () => {
  it('最上面是站内反馈强调卡，点开站内反馈弹窗', async () => {
    const openFeedback = vi.fn()
    const wrapper = mountPage(openFeedback)
    const card = wrapper.get('[data-testid="contact-feedback"]')
    expect(wrapper.element.firstElementChild.nextElementSibling).toBe(card.element)
    await card.trigger('click')
    expect(openFeedback).toHaveBeenCalledTimes(1)
  })

  it('投诉与举报整段保留，位于联系方式下方，文案指向「上方」联系方式', () => {
    const wrapper = mountPage()
    const html = wrapper.html()
    expect(html.indexOf('contact-grid')).toBeLessThan(html.indexOf('data-testid="contact-report"'))
    expect(messages.zh.contact.report_body).toContain('上方联系方式')
    expect(messages.en.contact.report_body).toContain('above')
  })
})
