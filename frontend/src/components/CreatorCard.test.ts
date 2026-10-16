// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import { createI18n } from 'vue-i18n'
import { messages } from '../locales/messages.js'
import card from '../../../contracts/http/fixtures/creator-card.json'
import CreatorCard from './CreatorCard.vue'

describe('creator recommendation card', () => {
  it('shows half stars and authoritative counts with safe profile links and permission-scoped actions', async () => {
    const wrapper = mount(CreatorCard, { props: { creator: { ...card, score: 7 }, favorite: true, favoriteDisabled: false, pending: false, admin: false, adminDisabled: false },
      global: { plugins: [createI18n({ legacy: false, locale: 'zh', messages })] } })
    expect(wrapper.findAll('.creator-stars > svg')).toHaveLength(5)
    expect(wrapper.findAll('.lucide-star-half')).toHaveLength(1)
    expect(wrapper.get('.creator-rating').text()).toContain('7/10')
    expect(wrapper.get('[data-testid=creator-favorite-count]').text()).toContain(String(card.favoriteCount))
    expect(wrapper.get('a').attributes()).toMatchObject({ href: card.homepageUrl, target: '_blank', rel: 'noopener noreferrer' })
    expect(wrapper.find(`[data-testid=creator-edit-${card.id}]`).exists()).toBe(false)
    await wrapper.setProps({ admin: true, creator: { ...card, level: null } })
    expect(wrapper.find(`[data-testid=creator-edit-${card.id}]`).exists()).toBe(true)
    expect(wrapper.find('.creator-strength').exists()).toBe(false)
    wrapper.unmount()
  })
})
