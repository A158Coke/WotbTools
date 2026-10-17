// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import { createI18n } from 'vue-i18n'
import { messages } from '../locales/messages.js'
import card from '../../../contracts/http/fixtures/creator-card.json'
import CreatorCard from './CreatorCard.vue'
const creator = { ...card, score: 6 as const }
describe('manual creator recommendation card', () => {
  it('shows whole stars and an external profile link, with management actions only for administrators', async () => {
    const wrapper = mount(CreatorCard, { props: { creator, admin: false, adminDisabled: false }, global: { plugins: [createI18n({ legacy: false, locale: 'zh', messages })] } })
    expect(wrapper.findAll('.creator-stars > svg')).toHaveLength(5); expect(wrapper.findAll('.creator-stars .is-filled')).toHaveLength(3)
    expect(wrapper.get('.creator-rating').text()).toContain('6/10'); expect(wrapper.findAll('button')).toHaveLength(0)
    expect(wrapper.get('a').attributes()).toMatchObject({ href: card.homepageUrl, target: '_blank', rel: 'noopener noreferrer' })
    expect(wrapper.find('.creator-strength').exists()).toBe(false)
    await wrapper.setProps({ admin: true, creator: { ...creator, level: { id: 1, name: 'Expert' } } })
    expect(wrapper.findAll('button')).toHaveLength(2); expect(wrapper.get('.creator-strength').text()).toContain('Expert'); wrapper.unmount()
  })
})
