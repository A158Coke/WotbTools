import { ref, computed } from 'vue'
import { displayName, mapLabel } from '../utils/helpers.js'
import * as api from '../utils/api.js'

export function useReplay() {
  const files = ref([])
  const loading = ref(false)
  const error = ref('')
  const resp = ref(null)
  const activeTab = ref('aggregate')
  const pendingRemove = ref(null)

  const playerCols = computed(() => resp.value?.playerColumns || [])
  const aggCols = computed(() => resp.value?.aggregateColumns || [])

  const aggStats = computed(() => {
    if (!resp.value) return null
    const battles = resp.value.battles || []
    const agg = resp.value.aggregate || []
    let maxRating = 0, maxDmg = 0
    agg.forEach(r => { maxRating = Math.max(maxRating, Number(r.cells.rating_avg) || 0) })
    battles.forEach(b => (b.players || []).forEach(p => { maxDmg = Math.max(maxDmg, Number(p.cells.damage_dealt) || 0) }))
    return { battles: battles.length, players: agg.length, maxRating, maxDmg }
  })

  function buildFormData() {
    const fd = new FormData()
    files.value.forEach(f => fd.append('files', f, displayName(f)))
    return fd
  }

  async function doPreview(onColumnsInit) {
    if (!files.value.length) { error.value = '请先选择回放文件或文件夹'; return }
    loading.value = true; error.value = ''
    try {
      const data = await api.preview(buildFormData())
      resp.value = data
      if (onColumnsInit) onColumnsInit(data)
      activeTab.value = data.battles.length > 1 ? 'aggregate' : 'b0'
    } catch (e) {
      error.value = e.message
    } finally {
      loading.value = false
    }
  }

  async function doExport(mode) {
    if (!files.value.length) { error.value = '请先选择回放文件或文件夹'; return }
    loading.value = true; error.value = ''
    try {
      const { blob, disposition } = await api.downloadBlob(mode, buildFormData())
      const m = disposition.match(/filename\*=UTF-8''([^;]+)/)
      const name = m ? decodeURIComponent(m[1]) : (mode === 'each' ? '逐场导出.zip' : '联赛汇总.xlsx')
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a'); a.href = url; a.download = name; a.click()
      URL.revokeObjectURL(url)
    } catch (e) {
      error.value = e.message
    } finally {
      loading.value = false
    }
  }

  function askRemoveBattle(battle, idx) {
    pendingRemove.value = { battle, label: `${mapLabel(battle.mapName)} #${idx + 1}` }
  }

  function cancelRemove() { pendingRemove.value = null }

  function confirmRemoveBattle(onColumnsInit) {
    const battle = pendingRemove.value?.battle
    pendingRemove.value = null
    if (!battle) return
    files.value = files.value.filter(f => displayName(f) !== battle.sourceName)
    if (files.value.length) doPreview(onColumnsInit)
    else { resp.value = null; activeTab.value = 'aggregate' }
  }

  return {
    files, loading, error, resp, playerCols, aggCols, activeTab, aggStats, pendingRemove,
    doPreview, doExport, askRemoveBattle, cancelRemove, confirmRemoveBattle,
  }
}
