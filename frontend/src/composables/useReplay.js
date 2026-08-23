import { ref, computed, onUnmounted } from 'vue'
import { useI18n } from 'vue-i18n'
import { displayName, mapLabel, fileKey } from '../utils/helpers.js'
import { apiErrorLabel } from '../utils/display.js'
import * as api from '../utils/api.js'

const JOB_TERMINAL = new Set(['READY', 'FAILED', 'CANCELLED'])
const JOB_ACTIVE = new Set(['QUEUED', 'PROCESSING'])
const JOB_POLL_MS = 1500

/**
 * Replay 页状态（plan §43：明确状态模型，避免互相冲突的散落 boolean）：
 * EMPTY（无文件）→ FILES_SELECTED（有文件未解析）→ PROCESSING（解析 Job 进行中）→
 * READY（结果已展示；processingJobId 供 Export 复用）；异常 → FAILED / CANCELLED。
 * 页面状态由 processingJob / resp 派生，不引入 isLoading/isPreviewing 等互斥 flag。
 */
export function useReplay() {
  const { locale, t, te } = useI18n()
  const files = ref([])
  const loading = ref(false)
  const error = ref('')
  const resp = ref(null)
  const activeTab = ref('aggregate')
  const pendingRemove = ref(null)

  // ---- Replay Processing Job（解析预览改为异步 Job：真实进度 + 可取消 + result 复用，plan §5–§21）----
  const processingJob = ref(null)
  const processingError = ref('')
  /** 已完成解析的 Processing Job id（供 Export 复用 result，不重新上传/processFull，plan §28–§30）。 */
  const processingJobId = ref(null)
  let processingPollTimer = null
  let processingPollJobId = null

  // ---- Export Job（长任务 UX：创建即返回 jobId，轮询真实进度，页面不阻塞）----
  const exportJob = ref(null)
  const exportError = ref('')
  let exportPollTimer = null
  let exportPollJobId = null

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

  const processingActive = computed(() => processingJob.value && JOB_ACTIVE.has(processingJob.value.status))
  const exportActive = computed(() => exportJob.value && JOB_ACTIVE.has(exportJob.value.status))

  function buildFormData() {
    const fd = new FormData()
    files.value.forEach(f => fd.append('files', f, displayName(f)))
    return fd
  }

  // ---- Processing Job 流程 ----

  function stopProcessingPolling() {
    if (processingPollTimer) { clearInterval(processingPollTimer); processingPollTimer = null }
    processingPollJobId = null
  }

  async function pollProcessingJob(onColumnsInit) {
    if (!processingPollJobId) return
    try {
      const data = await api.getProcessingJob(processingPollJobId)
      processingJob.value = data
      if (data.status === 'READY') {
        const readyJobId = processingPollJobId
        stopProcessingPolling()
        const result = await api.getProcessingJobResult(readyJobId)
        // result 与 files 是同一批次（READY 后不再变化）；直接替换 resp。
        resp.value = result
        processingJobId.value = readyJobId
        if (onColumnsInit) onColumnsInit(result)
        activeTab.value = result.battles.length > 1 ? 'aggregate' : 'b0'
        loading.value = false
      } else if (data.status === 'FAILED' || data.status === 'CANCELLED') {
        stopProcessingPolling()
        loading.value = false
        if (data.status === 'FAILED') {
          processingError.value = data.errorCode === 'NO_VALID_REPLAYS'
            ? t('replay.processing_job.no_valid_replays')
            : t('replay.processing_job.failed')
        }
      }
    } catch (e) {
      // job 已过期/网络错误：停止轮询，提示重新解析（不阻塞页面）
      stopProcessingPolling()
      processingJob.value = null
      loading.value = false
      processingError.value = apiErrorLabel(t, te, e)
    }
  }

  /**
   * 创建解析任务并开始轮询真实进度。READY 后自动拉取 result 展示（plan §20）。
   * 防重复：已有活跃 job 时忽略再次点击。
   */
  async function startProcessingJob(onColumnsInit) {
    if (!files.value.length) { error.value = t('replay.no_files'); return }
    if (processingActive.value) return
    loading.value = true
    error.value = ''
    processingError.value = ''
    try {
      const created = await api.createProcessingJob(buildFormData())
      processingJob.value = {
        jobId: created.jobId,
        status: created.status || 'QUEUED',
        phase: null,
        total: created.total || 0,
        processed: 0,
        valid: 0,
        duplicates: 0,
        failures: 0,
        errorCode: null,
        currentFile: null
      }
      processingPollJobId = created.jobId
      processingPollTimer = setInterval(() => pollProcessingJob(onColumnsInit), JOB_POLL_MS)
      pollProcessingJob(onColumnsInit)
    } catch (e) {
      loading.value = false
      processingError.value = `${t('replay.preview_failed')}: ${apiErrorLabel(t, te, e)}`
    }
  }

  async function cancelProcessingJob() {
    const job = processingJob.value
    if (!job || !JOB_ACTIVE.has(job.status)) return
    try {
      await api.cancelProcessingJob(job.jobId)
      stopProcessingPolling()
      processingJob.value = { ...job, status: 'CANCELLED' }
      loading.value = false
    } catch (e) {
      processingError.value = apiErrorLabel(t, te, e)
    }
  }

  function dismissProcessingJob() {
    stopProcessingPolling()
    processingJob.value = null
    processingError.value = ''
    // 注意：processingJobId 保留（READY 后供 Export 复用）；重新解析时会覆盖。
  }

  // ---- Export Job 流程 ----

  function stopExportPolling() {
    if (exportPollTimer) { clearInterval(exportPollTimer); exportPollTimer = null }
    exportPollJobId = null
  }

  async function pollExportJob() {
    if (!exportPollJobId) return
    try {
      const data = await api.getExportJob(exportPollJobId)
      exportJob.value = data
      if (JOB_TERMINAL.has(data.status)) stopExportPolling()
    } catch (e) {
      // job 已过期/网络错误：停止轮询，提示重新生成（不阻塞页面）
      stopExportPolling()
      exportJob.value = null
      exportError.value = apiErrorLabel(t, te, e)
    }
  }

  /**
   * 创建导出任务并开始轮询真实进度。Processing READY 后（processingJobId 存在）直接复用
   * 已解析 result，不再重新上传 replay / 重新解析（plan §30/§42）。防重复：已有活跃 job 时忽略。
   */
  async function startExportJob(mode) {
    if (!files.value.length) { error.value = t('replay.no_files'); return }
    if (exportActive.value) return
    error.value = ''
    exportError.value = ''
    try {
      const body = processingJobId.value ? null : buildFormData()
      const created = await api.createExportJob(body, mode, processingJobId.value || undefined)
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
      exportPollJobId = created.jobId
      exportPollTimer = setInterval(pollExportJob, JOB_POLL_MS)
      pollExportJob()
    } catch (e) {
      exportError.value = `${t('replay.export_failed')}: ${apiErrorLabel(t, te, e)}`
    }
  }

  async function cancelExportJob() {
    const job = exportJob.value
    if (!job || !JOB_ACTIVE.has(job.status)) return
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

  onUnmounted(() => {
    stopProcessingPolling()
    stopExportPolling()
  })

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
    if (files.value.length) startProcessingJob(onColumnsInit)
    else { resp.value = null; activeTab.value = 'aggregate'; processingJobId.value = null }
  }

  function confirmRemoveBattle(onColumnsInit) {
    if (pendingRemove.value?.type === 'battle') confirmRemove(onColumnsInit)
    else pendingRemove.value = null
  }

  return {
    files, loading, error, resp, playerCols, aggCols, activeTab, aggStats, pendingRemove,
    processingJob, processingError, processingActive, processingJobId,
    exportJob, exportError, exportActive,
    startProcessingJob, cancelProcessingJob, dismissProcessingJob,
    startExportJob, cancelExportJob, downloadExportResult, dismissExportJob,
    askRemoveBattle, askRemoveFile, cancelRemove, confirmRemove, confirmRemoveBattle,
  }
}
