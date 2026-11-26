export function createMapPreviewPageTestHelpers({ MapPreviewPage, createRouter, createMemoryHistory, mount, DIALOG_INLINE_KEY, flushPromises }) {
  const ROUTER = createRouter({
    history: createMemoryHistory(),
    routes: [{ path: '/', component: { template: '<div />' } }],
  })

  function mountPage() {
    return mount(MapPreviewPage, {
      global: {
        plugins: [ROUTER],
        mocks: {
          $t: (key, params) => (params ? `${key}:${JSON.stringify(params)}` : key),
        },
      },
    })
  }

  const IDX = {
    maps: {
      3: { key: 'erlenberg', display: 'Middleburg' },
      54: { key: 'erlenberg', display: 'Middleburg - Town' },
      8: { key: 'canyon', display: 'Canyon' },
      31: { key: 'grossberg', display: "Dynasty's Pearl" },
      70: { key: 'moon', display: 'Sea of Tranquility' },
      72: { key: 'iceworld', display: 'Everfrost' },
      83: { key: 'erlenberg_old', display: 'Middleburg mod. 2014' },
      89: { key: 'savanna_old', display: 'Oasis Palms mod. 2014' },
      56: { key: 'canal_01', display: 'Canal - Factory' },
      60: { key: 'rudniki_01', display: 'Mines - Hill' },
      62: { key: 'rudniki_03', display: 'Mines - Center' },
    },
  }

  const ALL_KEYS = [
    'canal_01', 'canyon', 'erlenberg', 'erlenberg_old', 'grossberg',
    'iceworld', 'moon', 'rudniki_01', 'rudniki_03', 'savanna_old',
  ]
  const ZH_KEYS = [
    'canyon', 'erlenberg', 'erlenberg_old', 'grossberg', 'iceworld', 'moon', 'savanna_old',
  ]
  const HIDDEN_KEYS = ['canal_01', 'rudniki_01', 'rudniki_03']

  function cardKeys(wrapper) {
    return wrapper.findAll('.map-card')
      .map((card) => (card.attributes('data-testid') || '').replace('map-card-', ''))
      .sort()
  }

  async function toggleShowAll(wrapper) {
    await wrapper.find('[data-testid="map-show-all"]').trigger('click')
    await flushPromises()
  }

  async function openAt(query = {}) {
    await ROUTER.push({ path: '/', query: { view: 'map-preview', ...query } })
    const wrapper = mountPage()
    await flushPromises()
    return wrapper
  }
  return { ROUTER, IDX, ALL_KEYS, ZH_KEYS, HIDDEN_KEYS, cardKeys, toggleShowAll, openAt, mountPage }
}
