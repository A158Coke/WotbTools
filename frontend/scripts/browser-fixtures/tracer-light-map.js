import { createApp, h, nextTick } from 'vue'
import { createI18n } from 'vue-i18n'
import BattleMap from '../../src/components/BattleMap.vue'
import { PLAYBACK_ON_NEUTRAL, playbackTracerColor, teamCssVars } from '../../src/data/mapTeamColors.js'
import { messages } from '../../src/locales/messages.js'

const i18n = createI18n({ locale: 'zh', fallbackLocale: 'en', messages })
const MAP_WIDTH = 1000
const MAP_HEIGHT = 300
const mapView = {
  W: MAP_WIDTH,
  H: MAP_HEIGHT,
  toX: (x) => x,
  toY: (y) => y,
}
const tracerColor = (accountId) => playbackTracerColor(
  accountId === 1 ? true : (accountId === 2 ? false : null),
)
const noop = () => {}

const App = {
  name: 'TracerLightMapFixture',
  setup() {
    const tracer = (accountId, y) => ({
      timeSec: 0,
      hasLine: true,
      x1: 120,
      y1: y,
      x2: 880,
      y2: y,
      attackerAccountId: accountId,
      opacity: 1,
      flashProgress: 1,
      flashOpacity: 0,
    })
    return () => h('div', {
      class: 'tracer-fixture',
      style: { ...teamCssVars(''), background: '#fff', width: `${MAP_WIDTH}px`, height: `${MAP_HEIGHT}px` },
    }, [
      h(BattleMap, {
        image: { src: 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7' },
        mapView,
        pbOverview: { mapCode: 'tracer-light-map', spawnPoints: [] },
        friendlyTeam: 1,
        terrainRelief: false,
        viewScale: 1,
        visibleTracers: [tracer(1, 70), tracer(2, 150), tracer(3, 230)],
        tracerColor,
        markerLabel: noop,
        hpFor: noop,
        hpPrefs: { showHp: false, mode: 'bar' },
        translate: (key) => key,
        ghostFor: noop,
        flashFor: noop,
        floatTeamClass: noop,
      }),
    ])
  },
}

createApp(App).use(i18n).mount('#app')
nextTick(() => {
  window.__tracerFixture = {
    ready: true,
    onNeutral: PLAYBACK_ON_NEUTRAL,
    colors: [playbackTracerColor(true), playbackTracerColor(false), playbackTracerColor(null)],
  }
})
