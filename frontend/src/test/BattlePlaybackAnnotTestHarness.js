import { createI18n } from 'vue-i18n'
import { flushPromises, mount } from '@vue/test-utils'
import zh from '../locales/zh.json'
import en from '../locales/en.json'
import ru from '../locales/ru.json'
import { makeBattlePlaybackDataset } from './playbackV2TestUtil.js'

export function createBattlePlaybackAnnotTestHarness(BattlePlayback) {
  function makeOverview() {
    return {
      mapCode: 'holland',
      displayName: 'Molendijk',
      displayNames: { zh: '莫伦代克', en: 'Molendijk', ru: 'Молендейк' },
      playableBounds: { xMin: -300, xMax: 300, yMin: -300, yMax: 300 },
      friendlyTeam: 1,
      arenaBonusType: 1,
      recorderAccountId: 1001,
      gridCells: [],
      spawnPoints: [],
      routes: [],
    }
  }

  function mountAnnot(lang = 'zh', attachTo) {
    const i18n = createI18n({ locale: lang, fallbackLocale: 'en', messages: { zh, en, ru } })
    return mount(BattlePlayback, {
      attachTo,
      props: { overview: makeOverview(), seekTo: null, playbackV2: makeBattlePlaybackDataset({ vehicles: [], events: [] }) },
      global: { plugins: [i18n] },
    })
  }

  function dispatchPointer(type, props) {
    const ev = new Event(type)
    Object.defineProperty(ev, 'pointerId', { value: props.pointerId })
    Object.defineProperty(ev, 'clientX', { value: props.clientX })
    Object.defineProperty(ev, 'clientY', { value: props.clientY })
    window.dispatchEvent(ev)
  }

  function setMapLayout(wrapper, width, height) {
    const el = wrapper.find('[data-test="pb-map"]').element
    Object.defineProperty(el, 'clientWidth', { value: width, configurable: true })
    Object.defineProperty(el, 'clientHeight', { value: height, configurable: true })
  }

  async function openAnnotations(wrapper) {
    if (!wrapper.find('[data-test="pb-annot-toolbar"]').exists()) {
      await wrapper.get('[data-test="pb-annotation-entry"]').trigger('click')
    }
    await flushPromises()
  }

  return { makeOverview, mountAnnot, dispatchPointer, setMapLayout, openAnnotations }
}
