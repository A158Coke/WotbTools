import { flushPromises, mount } from '@vue/test-utils'
import MapPreview2DPane from '../components/MapPreview2DPane.vue'
import { mapImages } from '../data/mapImages.js'

export function mountPane(basemap = { kind: 'bundled', image: mapImages.erlenberg }, overrides = {}) {
  return mount(MapPreview2DPane, {
    props: { mapKey: 'erlenberg', basemap, ...overrides },
    global: { mocks: { $t: (key, params) => (params ? `${key}:${JSON.stringify(params)}` : key) } },
  })
}

export async function importJson(wrapper, payload) {
  const file = new File([JSON.stringify(payload)], 'annotations.json', { type: 'application/json' })
  const input = wrapper.find('input[type="file"]')
  Object.defineProperty(input.element, 'files', { value: [file], configurable: true })
  await input.trigger('change')
  await flushPromises()
}
