/**
 * 3D 伤害数字覆盖层的浏览器门禁夹具：挂**真实组件 + 真实 CSS**（Vite dev server 编译 SFC），
 * 不用 WebGL、不加载资产——被验收的是 DOM 几何与 CSS 动画（跟随 anchor / 出屏隐藏 / 镜像侧 /
 * 漂移方向 / fit 边界 / 0×0 兜底 / rerender 不重算 delay）。
 *
 * 3D 场景本身的画面观感仍归用户人工验收（见 .agents/AGENTS.md「视觉验证归属」）。
 */
import { createApp, h, nextTick, onMounted, reactive, ref } from 'vue'
import { createI18n } from 'vue-i18n'
import PlaybackVehicleLabels3D from '../../src/components/PlaybackVehicleLabels3D.vue'
import '../../src/styles/tokens/scale.css'
import '../../src/styles/tokens/color.css'

const i18n = createI18n({ legacy: false, locale: 'en', missingWarn: false, fallbackWarn: false, messages: { en: {} } })

const labelPrefs = reactive({ showPlayerName: true, showTankName: true, showReload: false })
const hpPrefs = reactive({ showHp: true })
const markerPrefs = reactive({ classIcons: false, showStatus: true })

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
      ref: overlayRef, labelPrefs, hpPrefs, markerPrefs, hidden: false,
    })
  },
}
createApp(Root).use(i18n).mount('#stage')

// 门禁探针只用这个入口：真实组件实例的 exposed API + 真实响应式偏好
window.__damageOverlay = {
  ready: () => !!overlay,
  async setLabels(rows) { overlay.setLabels(rows); await settle() },
  async setAnchor(eid, anchor) { overlay.setAnchor(eid, anchor); await settle() },
  async spawn(eid, hpLoss, durationMs) { overlay.spawnDamage(eid, hpLoss, durationMs); await settle() },
  clearDamages() { overlay.clearDamages() },
  async prefs(patch) {
    Object.assign(labelPrefs, patch.labelPrefs || {})
    Object.assign(hpPrefs, patch.hpPrefs || {})
    Object.assign(markerPrefs, patch.markerPrefs || {})
    await settle()
  },
  async remount() {
    markerPrefs.showStatus = false
    await settle()
    markerPrefs.showStatus = true
    await settle()
  },
}
