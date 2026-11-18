import { flushPromises, mount } from '@vue/test-utils'

export function createHoFPageTestHelpers({ HoFPage, DIALOG_INLINE_KEY, vi }) {
  function mountPage() {
    return mount(HoFPage, {
      global: { mocks: { $t: key => key }, provide: { [DIALOG_INLINE_KEY]: true } }
    })
  }

  function makeRow(overrides = {}) {
    return {
      id: 1,
      rank: 1,
      tankId: 6481,
      tankName: 'FV4005',
      nickname: 'Player1',
      damageDealt: 3200,
      battleType: 'RANDOM',
      mapName: 'rockfield',
      version: '11.18.0',
      battleTime: null,
      createdAt: '2024-07-01T00:00:00Z',
      replayAvailable: false,
      ...overrides
    }
  }

  async function setFiles(input, files) {
    Object.defineProperty(input.element, 'files', { value: files, configurable: true })
    await input.trigger('change')
    await flushPromises()
  }

  function stubDeferredFileReader() {
    const readers = []
    class DeferredFileReader {
      constructor() {
        this.onload = null
        this.onerror = null
        this.result = null
        readers.push(this)
      }

      readAsDataURL() {}
    }
    vi.stubGlobal('FileReader', DeferredFileReader)
    return readers
  }

  async function openSingleUpload(wrapper) {
    await wrapper.find('.lb-submit-row button.filebtn').trigger('click')
    await flushPromises()
  }

  async function openHundredSubmit(wrapper) {
    await wrapper.findAll('.tabs button')[1].trigger('click')
    await flushPromises()
    await wrapper.find('.h100-submit-btn').trigger('click')
    await flushPromises()
  }

  /** 通过真实的 combobox 交互选车：点开输入框 → 点击对应选项。 */
  async function pickVehicle(wrapper, selector, id) {
    await wrapper.find(`${selector} input[role="combobox"]`).trigger('click')
    await wrapper.find(`${selector} [role="option"][data-id="${id}"]`).trigger('click')
    await flushPromises()
  }

  function pickerLabels(wrapper, selector) {
    return wrapper.findAll(`${selector} [role="option"] .vp-label`).map(label => label.text())
  }

  function pickerValue(wrapper, selector) {
    return wrapper.find(`${selector} input[role="combobox"]`).attributes('data-value')
  }

  async function openMark3Submit(wrapper) {
    await wrapper.findAll('.tabs button')[2].trigger('click')
    await flushPromises()
    await wrapper.find('.mark3-submit-btn').trigger('click')
    await flushPromises()
  }
  return { mountPage, makeRow, setFiles, stubDeferredFileReader, openSingleUpload, openHundredSubmit, pickVehicle, pickerLabels, pickerValue, openMark3Submit }
}
