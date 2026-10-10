// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import FileDrop from './FileDrop.vue'
import { MAX_REPLAY_FILES, MAX_REPLAY_FILE_BYTES, MAX_REPLAY_TOTAL_BYTES } from '../utils/replayUpload.js'
const native = vi.hoisted(() => ({ android: true, supports: vi.fn(), pick: vi.fn() }))
vi.mock('../composables/usePlatformBridge.js', () => ({ isAndroidApp: () => native.android }))
vi.mock('../platform/replayFolderPicker.js', () => ({
  supportsNativeReplayFolder: native.supports, pickNativeReplayFolder: native.pick,
}))
vi.mock('vue-i18n', () => ({ useI18n: () => ({ t: key => key, locale: { value: 'zh' } }) }))
const wrappers = []
const realFile = (name, path = name) => {
  const file = new File([Uint8Array.from([1])], name, { lastModified: 1234 })
  Object.defineProperty(file, 'webkitRelativePath', { value: path })
  return file
}
const dto = (name, extra = {}) => ({ name, webkitRelativePath: name, size: 1, lastModified: 1234, ...extra })
async function render(files = [], extra = {}) {
  const wrapper = mount(FileDrop, { props: { files, ...extra }, global: { mocks: { $t: key => key } } })
  wrappers.push(wrapper)
  await flushPromises()
  return wrapper
}
const button = (wrapper, key) => wrapper.findAll('button').find(candidate => candidate.text().includes(key))
beforeEach(() => {
  native.android = true
  native.supports.mockReset().mockResolvedValue(true)
  native.pick.mockReset().mockResolvedValue(null)
})
afterEach(() => { wrappers.splice(0).forEach(wrapper => wrapper.unmount()) })
describe('FileDrop Android directory behavior', () => {
  it('old APK hides only directory selection while keeping file multiselect', async () => {
    native.supports.mockResolvedValue(false)
    const wrapper = await render()
    expect(button(wrapper, 'upload.select_folder')).toBeUndefined()
    expect(wrapper.find('[webkitdirectory]').exists()).toBe(false)
    expect(wrapper.get('[data-testid="select-files-input"]').attributes('multiple')).toBeDefined()
    expect(wrapper.text()).toContain('upload.files_only_hint')
  })
  it('Web retains webkitdirectory and does not call the native picker', async () => {
    native.android = false
    const wrapper = await render()
    const input = wrapper.get('[data-testid="select-folder-input"]').element
    const click = vi.spyOn(input, 'click').mockImplementation(() => {})
    await button(wrapper, 'upload.select_folder').trigger('click')
    expect(click).toHaveBeenCalledOnce()
    expect(native.supports).not.toHaveBeenCalled()
    expect(native.pick).not.toHaveBeenCalled()
    click.mockRestore()
  })
  it('native directory button bypasses the HTML chooser and merges mixed nested replays', async () => {
    const old = realFile('old.wotbreplay')
    const a = realFile('same.wotbreplay', 'a/same.wotbreplay')
    const b = realFile('same.wotbreplay', 'b/same.wotbreplay')
    native.pick.mockImplementation(async ({ prepareFiles }) => {
      const accepted = prepareFiles([a, b, dto('readme.txt')])
      expect(accepted).toEqual([a, b])
      return accepted
    })
    const wrapper = await render([old])
    expect(wrapper.find('[webkitdirectory]').exists()).toBe(false)
    await button(wrapper, 'upload.folder').trigger('click')
    await flushPromises()
    expect(wrapper.emitted('update:files')[0][0]).toEqual([a, b, old])
    expect(wrapper.emitted('preview')).toBeUndefined()
  })
  it('cancellation leaves previous files and parsed results untouched', async () => {
    const old = realFile('old.wotbreplay')
    const wrapper = await render([old])
    await button(wrapper, 'upload.folder').trigger('click')
    await flushPromises()
    expect(wrapper.emitted('update:files')).toBeUndefined()
    expect(wrapper.find('[data-testid="folder-read-error"]').exists()).toBe(false)
  })
  it.each([
    [[], 'upload.reject_no_replay'],
    [[dto('readme.txt')], 'upload.reject_no_replay'],
    [Array.from({ length: MAX_REPLAY_FILES }, (_, i) => dto(`${i}.wotbreplay`)), 'upload.reject_count'],
    [[dto('large.wotbreplay', { size: MAX_REPLAY_FILE_BYTES + 1 })], 'upload.reject_offending_title'],
    [Array.from({ length: 11 }, (_, i) => dto(`${i}.wotbreplay`, { size: MAX_REPLAY_TOTAL_BYTES / 10 })), 'upload.reject_total'],
  ])('preflight rejection preserves old selection before any file read: %s', async (metadata, error) => {
    native.pick.mockImplementation(async ({ prepareFiles }) => {
      expect(prepareFiles(metadata)).toEqual([])
      return null
    })
    const wrapper = await render([realFile('old.wotbreplay')])
    await button(wrapper, 'upload.folder').trigger('click')
    await flushPromises()
    expect(wrapper.emitted('update:files')).toBeUndefined()
    expect(wrapper.get('[data-testid="upload-validation-error"]').text()).toContain(error)
  })
  it('read failure is localized, retryable and does not expose a provider path', async () => {
    native.pick.mockRejectedValueOnce(new Error('content://private/provider/path'))
    const wrapper = await render([realFile('old.wotbreplay')])
    await button(wrapper, 'upload.folder').trigger('click')
    await flushPromises()
    expect(wrapper.get('[data-testid="folder-read-error"]').text()).toBe('upload.folder_read_error')
    expect(wrapper.text()).not.toContain('content://')
    expect(wrapper.emitted('update:files')).toBeUndefined()
    native.pick.mockResolvedValueOnce(null)
    await button(wrapper, 'upload.folder').trigger('click')
    await flushPromises()
    expect(native.pick).toHaveBeenCalledTimes(2)
    expect(wrapper.find('[data-testid="folder-read-error"]').exists()).toBe(false)
  })
  it('preserves selection and gives a specific message for ambiguous replay paths', async () => {
    native.pick.mockRejectedValueOnce(Object.assign(new Error('duplicate'), { code: 'ambiguous-paths' }))
    const wrapper = await render([realFile('old.wotbreplay')])
    await button(wrapper, 'upload.folder').trigger('click')
    await flushPromises()
    expect(wrapper.get('[data-testid="folder-read-error"]').text()).toBe('upload.folder_ambiguous_paths')
    expect(wrapper.emitted('update:files')).toBeUndefined()
  })
  it('a newer canonical selection aborts the old folder request and is not overwritten', async () => {
    let resolve, signal
    native.pick.mockImplementation(options => {
      signal = options.signal
      return new Promise(done => { resolve = done })
    })
    const wrapper = await render([realFile('old.wotbreplay')])
    await button(wrapper, 'upload.folder').trigger('click')
    const newer = realFile('newer.wotbreplay')
    await wrapper.setProps({ files: [newer] })
    expect(signal.aborted).toBe(true)
    resolve([realFile('late.wotbreplay')])
    await flushPromises()
    expect(wrapper.props('files')).toEqual([newer])
    expect(wrapper.emitted('update:files')).toBeUndefined()
    expect(wrapper.find('[data-testid="folder-read-error"]').exists()).toBe(false)
  })
  it('locks conflicting actions while reading and aborts late results on unmount', async () => {
    let resolve, signal
    native.pick.mockImplementation(options => {
      signal = options.signal
      return new Promise(done => { resolve = done })
    })
    const wrapper = await render([realFile('old.wotbreplay')])
    await button(wrapper, 'upload.folder').trigger('click')
    expect(button(wrapper, 'upload.clear').element.disabled).toBe(true)
    expect(button(wrapper, 'upload.add').element.disabled).toBe(true)
    wrapper.unmount()
    expect(signal.aborted).toBe(true)
    resolve([realFile('late.wotbreplay')])
    await flushPromises()
    expect(wrapper.emitted('update:files')).toBeUndefined()
  })
  it('single-file capabilities keep their single-file semantics', async () => {
    const wrapper = await render([], { allowFolder: false })
    expect(button(wrapper, 'upload.select_folder')).toBeUndefined()
    expect(wrapper.get('[data-testid="select-files-input"]').attributes('multiple')).toBeUndefined()
  })
})
