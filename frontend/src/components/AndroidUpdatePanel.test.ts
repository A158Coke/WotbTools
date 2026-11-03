// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest'
import { computed, ref } from 'vue'
import { mount } from '@vue/test-utils'
import { createI18n } from 'vue-i18n'
import AndroidUpdatePanel from './AndroidUpdatePanel.vue'
import type { AndroidUpdateController, AndroidUpdateSnapshot } from '../shared/androidUpdate.js'
import { messages } from '../locales/messages.js'
import contract from '../../../contracts/android-native-bridge.json'

function controller(state: AndroidUpdateSnapshot['state'] = 'optional'): AndroidUpdateController {
  const snapshot = ref<AndroidUpdateSnapshot>({
    revision: 1, state, checkState: 'succeeded', checkFailureReason: null,
    currentVersionName: '3.27.2', currentVersionCode: 3027002,
    latestVersionName: '3.29.0', latestVersionCode: 3029000, minSupportedVersionCode: 3017007,
    publishedAt: null, releaseNotes: '<img src=x onerror=alert(1)>', optionalPromptSuppressed: false,
    download: { taskToken: 'pinned', state: 'idle', versionName: '3.28.0', versionCode: 3028000,
      progressPercent: null, downloadedBytes: null, totalBytes: null, failureReason: null },
  })
  return { supported: ref(true), snapshot, panelOpen: ref(true), returnFocusTo: ref(null), checking: ref(false), acting: ref(false),
    error: ref(null), showPrompt: computed(() => false), open: vi.fn(), close: vi.fn(), refresh: vi.fn(),
    download: vi.fn(), install: vi.fn(), dismiss: vi.fn() }
}

function render(update: AndroidUpdateController) {
  return mount(AndroidUpdatePanel, { props: { update }, global: {
    plugins: [createI18n({ locale: 'en', messages })],
    stubs: { AppSheet: { props: ['open', 'title'], template: '<div v-if="open"><slot /></div>' } },
  } })
}

describe('Android update panel', () => {
  it('shows names instead of numeric codes and leaves notes as text', () => {
    const wrapper = render(controller())
    expect(wrapper.get('[data-testid="update-current-version"]').text()).toBe('3.27.2')
    expect(wrapper.text()).not.toContain('3027002')
    expect(wrapper.text()).toContain('<img src=x onerror=alert(1)>')
    expect(wrapper.find('img').exists()).toBe(false)
    expect(wrapper.get('[data-testid="update-download-action"]').text()).toBe('Download update')
    expect(wrapper.find('[data-testid="update-install"]').exists()).toBe(false)
    wrapper.unmount()
  })

  it('shows indeterminate progress and the pinned download version', () => {
    const update = controller()
    if (update.snapshot.value) update.snapshot.value.download.state = 'downloading'
    const wrapper = render(update)
    expect(wrapper.text()).toContain('Update package 3.28.0')
    expect(wrapper.text()).toContain('3.29.0')
    expect(wrapper.get('progress').attributes('value')).toBeUndefined()
    expect(wrapper.get('[data-testid="update-progress"]').text()).toContain('Getting download size')
    expect(wrapper.find('[data-testid="update-install"]').exists()).toBe(false)
    wrapper.unmount()
  })

  it('shows incremental progress and a distinct applying phase', async () => {
    const update = controller()
    if (update.snapshot.value) update.snapshot.value.download = { ...update.snapshot.value.download,
      packageType: 'delta', state: 'downloadingDelta', progressPercent: 64, downloadedBytes: 18_000_000, totalBytes: 28_000_000 }
    const wrapper = render(update)
    expect(wrapper.text()).toContain('Downloading incremental update')
    expect(wrapper.get('[data-testid="update-progress"]').text()).toContain('64%')
    if (update.snapshot.value) update.snapshot.value.download.state = 'applyingDelta'
    await wrapper.vm.$nextTick()
    expect(wrapper.text()).toContain('Applying update')
    expect(wrapper.find('progress').exists()).toBe(false)
    wrapper.unmount()
  })

  it('shows package selection and prevents duplicate actions after reopening', () => {
    const update = controller()
    if (update.snapshot.value) update.snapshot.value.download = { ...update.snapshot.value.download,
      state: 'selectingPackage', failureReason: 'unsupportedArtifact' }
    const wrapper = render(update)
    expect(wrapper.text()).toContain(messages.en.androidUpdate.downloadState.selectingPackage)
    expect(wrapper.find('[data-testid="update-download-action"]').exists()).toBe(false)
    expect(wrapper.get('[data-testid="update-later"]').attributes('disabled')).toBeDefined()
    expect(wrapper.get('[data-testid="update-refresh"]').attributes('disabled')).toBeDefined()
    wrapper.unmount()
  })

  it('keeps a permission-denied package installable without offering another download', async () => {
    const update = controller()
    if (update.snapshot.value) update.snapshot.value.download = { ...update.snapshot.value.download,
      state: 'installPermissionRequired', failureReason: 'permissionDenied' }
    const wrapper = render(update)
    expect(wrapper.find('[data-testid="update-download-action"]').exists()).toBe(false)
    await wrapper.get('[data-testid="update-install"]').trigger('click')
    expect(update.install).toHaveBeenCalledTimes(1)
    expect(update.download).not.toHaveBeenCalled()
    wrapper.unmount()
  })

  it('shows an explicit check failure and removes Later for mandatory updates', async () => {
    const update = controller('mandatory')
    if (update.snapshot.value) update.snapshot.value.checkState = 'failed'
    const wrapper = render(update)
    expect(wrapper.get('[data-testid="update-check-status"]').text()).toBe('Unable to check for updates')
    expect(wrapper.text()).toContain('Check your connection and try again.')
    expect(wrapper.find('[data-testid="update-later"]').exists()).toBe(false)
    await wrapper.get('[data-testid="update-refresh"]').trigger('click')
    expect(update.refresh).toHaveBeenCalledTimes(1)
    wrapper.unmount()
  })

  it('offers explicit replacement when Native rejects an old package under a new support floor', async () => {
    const update = controller('mandatory')
    if (update.snapshot.value) update.snapshot.value.download = { ...update.snapshot.value.download,
      state: 'ready', failureReason: 'unsupportedArtifact' }
    const wrapper = render(update)
    expect(wrapper.find('[data-testid="update-install"]').exists()).toBe(false)
    await wrapper.get('[data-testid="update-download-action"]').trigger('click')
    expect(update.download).toHaveBeenCalledTimes(1)
    wrapper.unmount()
  })

  it('does not leave a spinner after an RPC failure with a cached checking snapshot', () => {
    const update = controller()
    if (update.snapshot.value) update.snapshot.value.checkState = 'checking'
    update.error = ref('unavailable')
    const wrapper = render(update)
    expect(wrapper.get('[data-testid="update-check-status"]').text()).toBe('Unable to check for updates')
    expect(wrapper.get('[data-testid="update-refresh"]').attributes('disabled')).toBeUndefined()
    wrapper.unmount()
  })

  it('translates every canonical state and failure category in all three locales', () => {
    const fields = contract.methods.getUpdateStatus.response.fields
    for (const locale of ['zh', 'en', 'ru'] as const) {
      const translation = messages[locale].androidUpdate
      expect(Object.keys(translation.state).sort()).toEqual([...fields.state.enum].sort())
      expect(Object.keys(translation.downloadState).sort()).toEqual([...fields.download.fields.state.enum].sort())
      expect(Object.keys(translation.failure).sort()).toEqual([...fields.download.fields.failureReason.enum].sort())
    }
  })
})
