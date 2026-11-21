/**
 * PlayerDetailDrawer —— Radar Metric Selection（拆分自 PlayerDetailDrawer.vue，行为原样）。
 * 默认七维，仅 League 维度；Summary/Battle 共用同一配置（localStorage 持久化）。
 */
import { ref } from 'vue'
import { loadRadarPreference, saveRadarPreference, RADAR_MIN_AXES, RADAR_MAX_AXES } from '../../utils/radarMetrics.js'

/** @param {{ t: (key: string, params?: unknown) => string }} ctx */
export function useRadarMetricSelection({ t }) {
  const radarOrder = ref(loadRadarPreference())
  const showRadarPicker = ref(false)
  const radarHint = ref('')

  function persistRadarOrder() {
    saveRadarPreference(radarOrder.value)
  }

  function toggleRadarMetric(key) {
    const cur = [...radarOrder.value]
    const idx = cur.indexOf(key)
    if (idx >= 0) {
      if (cur.length <= RADAR_MIN_AXES) {
        radarHint.value = t('league.drawer.radar_min_hint', { n: RADAR_MIN_AXES })
        return
      }
      cur.splice(idx, 1)
      radarHint.value = ''
    } else {
      if (cur.length >= RADAR_MAX_AXES) {
        radarHint.value = t('league.drawer.radar_max_hint', { n: RADAR_MAX_AXES })
        return
      }
      cur.push(key)
      radarHint.value = ''
    }
    radarOrder.value = cur
    persistRadarOrder()
  }

  function moveRadarMetric(key, dir) {
    const cur = [...radarOrder.value]
    const idx = cur.indexOf(key)
    const to = idx + dir
    if (idx < 0 || to < 0 || to >= cur.length) return
    const [moved] = cur.splice(idx, 1)
    cur.splice(to, 0, moved)
    radarOrder.value = cur
    persistRadarOrder()
  }

  return { radarOrder, showRadarPicker, radarHint, toggleRadarMetric, moveRadarMetric }
}
