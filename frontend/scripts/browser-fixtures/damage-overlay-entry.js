import { createApp, h, nextTick, onMounted, reactive, ref } from 'vue'
import { createI18n } from 'vue-i18n'
import PlaybackVehicleLabels3D from '../../src/components/PlaybackVehicleLabels3D.vue'
import '../../src/styles/tokens/scale.css'
import '../../src/styles/tokens/color.css'

const i18n = createI18n({ legacy: false, locale: 'en', missingWarn: false, fallbackWarn: false, messages: { en: {} } })

const labelPrefs = reactive({ showPlayerName: true, showTankName: true, showReload: false })
const hpPrefs = reactive({ showHp: true })
const markerPrefs = reactive({ classIcons: false, showStatus: true })

const hidden = ref(false)
let overlay = null
const settle = async () => {
  await nextTick()
  await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))
}

const Root = {
  setup() {
    const overlayRef = ref(null)
    onMounted(() => { overlay = overlayRef.value })
    return () => h(PlaybackVehicleLabels3D, {
      ref: overlayRef, labelPrefs, hpPrefs, markerPrefs, hidden: hidden.value,
    })
  },
}
createApp(Root).use(i18n).mount('#stage')

const stageSize = () => {
  const rect = document.getElementById('stage').getBoundingClientRect()
  return { x: rect.width, y: rect.height }
}
window.__damageOverlay = {
  ready: () => !!overlay,
  async setHidden(value) { hidden.value = value; await settle() },
  async setLabels(rows) { overlay.setLabels(rows); await settle() },
  async setAnchor(eid, anchor) {
    overlay.beginAnchors(stageSize())
    overlay.setAnchor(eid, anchor)
    overlay.endAnchors()
    await settle()
  },
  async spawn(eid, hpLoss, durationMs) { overlay.spawnDamage(eid, hpLoss, durationMs); await settle() },
  clearDamages() { overlay.clearDamages() },
  async prefs(patch) {
    Object.assign(labelPrefs, patch.labelPrefs || {})
    Object.assign(hpPrefs, patch.hpPrefs || {})
    Object.assign(markerPrefs, patch.markerPrefs || {})
    await settle()
  },
}
