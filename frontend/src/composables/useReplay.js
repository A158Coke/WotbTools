import { ref, computed, onUnmounted } from 'vue'
import { useI18n } from 'vue-i18n'
import { displayName, mapLabel, fileKey } from '../utils/helpers.js'
import { apiErrorLabel } from '../utils/display.js'
import * as api from '../utils/api.js'

const EXPORT_TERMINAL = new Set(['READY', 'FAILED', 'CANCELLED'])
const EXPORT_ACTIVE = new Set(['QUEUED', 'PROCESSING'])
const EXPORT_POLL_MS = 1500

export function useReplay() {
  const { locale, t, te } = useI18n()
  const files = ref([])
  const loading = ref(false)
  const error = ref('')
  const resp = ref(null)
  const activeTab = ref('aggregate')
  const pendingRemove = ref(null)
  // ---- Export Job（长任务 UX：创建即返回 jobId，轮询真实进度，页面不阻塞） ----
  const exportJob = ref(null)
  const exportError = ref('')
  let pollTimer = null
  let pollJobId = null

  const playerCols = computed(() => resp.value?.playerColumns || [])
  const aggCols = computed(() => resp.value?.aggregateColumns || [])

  const aggStats = computed(() => {
    if (!resp.value) return null
    const battles = resp.value.battles || []
    const agg = resp.value.aggregate || []
    let maxDmg = 0
    battles.forEach(b => (b.players || []).forEach(p => { maxDmg = Math.max(maxDmg, Number(p.cells.damage_dealt) || 0) }))
    return { battles: battles.length, players: agg.length, maxDmg }
  })

  const exportActive = computed(() => exportJob.value && EXPORT_ACTIVE.has(exportJob.value.status))

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

  function stopExportPolling() {
    if (pollTimer) { clearInterval(pollTimer); pollTimer = null }
    pollJobId = null
  }

  async function pollExportJob() {
    if (!pollJobId) return
    try {
      const data = await api.getExportJob(pollJobId)
      exportJob.value = data
      if (EXPORT_TERMINAL.has(data.status)) stopExportPolling()
    } catch (e) {
      // job 已过期/网络错误：停止轮询，提示重新生成（不阻塞页面）
      stopExportPolling()
      exportJob.value = null
      exportError.value = apiErrorLabel(t, te, e)
    }
  }

  /**
   * 创建导出任务并开始轮询真实进度。防重复：已有活跃 job 时忽略再次点击。
   * 页面卸载只停止轮询，不取消 backend job（§24）。
   */
  async function startExportJob(mode) {
    if (!files.value.length) { error.value = t('replay.no_files'); return }
    if (exportActive.value) return
    error.value = ''
    exportError.value = ''
    try {
      const created = await api.createExportJob(buildFormData(), mode)
      exportJob.value = {
        jobId: created.jobId,
        status: created.status || 'QUEUED',
        phase: null,
        total: created.total || 0,
        processed: 0,
        duplicates: 0,
        failures: 0,
        errorCode: null,
        filename: null,
        contentType: null
      }
      pollJobId = created.jobId
      pollTimer = setInterval(pollExportJob, EXPORT_POLL_MS)
      pollExportJob()
    } catch (e) {
      exportError.value = `${t('replay.export_failed')}: ${apiErrorLabel(t, te, e)}`
    }
  }

  async function cancelExportJob() {
    const job = exportJob.value
    if (!job || !EXPORT_ACTIVE.has(job.status)) return
    try {
      await api.cancelExportJob(job.jobId)
      stopExportPolling()
      exportJob.value = { ...job, status: 'CANCELLED' }
    } catch (e) {
      exportError.value = apiErrorLabel(t, te, e)
    }
  }

  async function downloadExportResult() {
    const job = exportJob.value
    if (!job || job.status !== 'READY') return
    try {
      const fallback = job.contentType && job.contentType.includes('zip') ? 'each-export.zip' : 'export.xlsx'
      await api.downloadExportJob(job.jobId, job.filename || fallback)
    } catch (e) {
      exportError.value = apiErrorLabel(t, te, e)
    }
  }

  function dismissExportJob() {
    stopExportPolling()
    exportJob.value = null
    exportError.value = ''
  }

  onUnmounted(stopExportPolling)

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
    exportJob, exportError, exportActive,
    doPreview, startExportJob, cancelExportJob, downloadExportResult, dismissExportJob,
    askRemoveBattle, askRemoveFile, cancelRemove, confirmRemove, confirmRemoveBattle,
  }
}
