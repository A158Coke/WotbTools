// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { ref } from 'vue'
import { createI18n } from 'vue-i18n'
import { messages } from '../locales/messages.js'
import CreatorsConfigPage from './CreatorsConfigPage.vue'

const state = vi.hoisted(() => ({ auth: null as any, epoch: 1 }))
vi.mock('../composables/useAuth.js', async original => ({ ...await original<typeof import('../composables/useAuth.js')>(), useAuth: () => state.auth }))
vi.mock('../composables/useFeatureGate.js', () => ({ useFeatureGate: () => ({ availability: () => ({ available: true }) }) }))
vi.mock('../api/creators.js', async original => ({ ...await original<typeof import('../api/creators.js')>(),
  getCreatorMetadata: vi.fn(async () => ({ categories: [{ id: 1, name: 'category' }], levels: [{ id: 1, name: 'level' }], avatarUploadsAvailable: false })), saveCreator: vi.fn(async () => ({ id: 1 })),
}))
let wrapper: ReturnType<typeof mount> | undefined
beforeEach(() => {
  state.epoch = 1
  state.auth = { authenticated: ref(true), authInitState: ref('authenticated'), tokenParsed: ref({ sub: 'a', realm_access: { roles: ['tournament-admin'] } }), authEpoch: () => state.epoch }
})
afterEach(() => { wrapper?.unmount(); wrapper = undefined })
describe('creator configuration drafts', () => {
  it('clears dictionary drafts when switching between equally privileged administrators', async () => {
    wrapper = mount(CreatorsConfigPage, { global: { plugins: [createI18n({ legacy: false, locale: 'zh', messages })], stubs: { CreatorForm: { template: '<div />' } } } })
    await flushPromises()
    await wrapper.get('[data-testid=creator-new-category]').setValue('Account A private category')
    await wrapper.get('[data-testid=creator-new-level]').setValue('Account A private level')
    state.epoch++; state.auth.tokenParsed.value = { sub: 'b', realm_access: { roles: ['tournament-admin'] } }
    await flushPromises()
    expect((wrapper.get('[data-testid=creator-new-category]').element as HTMLInputElement).value).toBe('')
    expect((wrapper.get('[data-testid=creator-new-level]').element as HTMLInputElement).value).toBe('')
  })
})
