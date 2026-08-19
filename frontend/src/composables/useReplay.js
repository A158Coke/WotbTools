import { ref, computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { displayName, mapLabel, fileKey } from '../utils/helpers.js'
import { apiErrorLabel } from '../utils/display.js'
import * as api from '../utils/api.js'

export function useReplay() {
  const { locale, t, te } = useI18n()
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
    if (!files.value.length) { error.value = t('replay.no_files'); return }
    loading.value = true; error.value = ''
    try {
      const data = await api.preview(buildFormData())
      resp.value = data
      if (onColumnsInit) onColumnsInit(data)
      activeTab.value = data.battles.length > 1 ? 'aggregate' : 'b0'
    } catch (e) {
      error.value = `${t('replay.preview_failed')}: ${apiErrorLabel(t, te, e)}`
    } finally {
      loading.value = false
    }
  }

  async function doExport(mode) {
    if (!files.value.length) { error.value = t('replay.no_files'); return }
    loading.value = true; error.value = ''
    try {
      const { blob, disposition } = await api.downloadBlob(mode, buildFormData())
      const m = disposition.match(/filename\*=UTF-8''([^;]+)/)
      const name = m ? decodeURIComponent(m[1]) : (mode === 'each' ? 'battle-export.zip' : 'league-summary.xlsx')
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a'); a.href = url; a.download = name; a.click()
      URL.revokeObjectURL(url)
    } catch (e) {
      error.value = `${t('replay.export_failed')}: ${apiErrorLabel(t, te, e)}`
    } finally {
      loading.value = false
    }
  }

  function askRemoveBattle(battle, idx) {
    pendingRemove.value = { type: 'battle', battle, label: `${mapLabel(battle.mapName, locale.value)} #${idx + 1}` }
  }

  function askRemoveFile(file) {
    pendingRemove.value = { type: 'file', file, label: displayName(file) }
  }

  function cancelRemove() { pendingRemove.value = null }

  function confirmRemove(onColumnsInit) {
    const p = pendingRemove.value
    pendingRemove.value = null
    if (!p) return
    if (p.type === 'battle') {
      files.value = files.value.filter(f => displayName(f) !== p.battle.sourceName)
    } else if (p.type === 'file') {
      files.value = files.value.filter(f => fileKey(f) !== fileKey(p.file))
    }
    if (files.value.length) doPreview(onColumnsInit)
    else { resp.value = null; activeTab.value = 'aggregate' }
  }

  function confirmRemoveBattle(onColumnsInit) {
    if (pendingRemove.value?.type === 'battle') confirmRemove(onColumnsInit)
    else pendingRemove.value = null
  }

  return {
    files, loading, error, resp, playerCols, aggCols, activeTab, aggStats, pendingRemove,
    doPreview, doExport, askRemoveBattle, askRemoveFile, cancelRemove, confirmRemove, confirmRemoveBattle,
  }
}