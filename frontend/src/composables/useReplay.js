import { ref, computed, onUnmounted } from 'vue'
import { useI18n } from 'vue-i18n'
import { displayName, mapLabel, fileKey } from '../utils/helpers.js'
import { apiErrorLabel } from '../utils/display.js'
import * as api from '../utils/api.js'

const JOB_TERMINAL = new Set(['READY', 'FAILED', 'CANCELLED'])
const JOB_ACTIVE = new Set(['QUEUED', 'PROCESSING'])
const JOB_POLL_MS = 1500

/**
 * 初始结果 tab 决策（P0 修复：activeTab 必须始终指向真实存在、可渲染的结果 panel）。
 * 不能再按 battle 数量猜测 aggregate——aggregate tab/panel 的真实存在条件是
 * `resp.aggregate.length > 0 || resp.leagueMode === true`，而 battle panel 是 `battles[i]`。
 *
 * 语义（与 ReplayPage.vue 的 tab/panel 渲染条件一一对应）：
 * - CW（League）模式（resp.leagueMode=true）→ aggregate（渲染 CW 统一玩家表）
 * - 普通 aggregate 有数据 → aggregate（渲染 AggregateTable）
 * - 无任何汇总但至少有 battle → b0（第一场 BattleTable）
 * - 什么都没有 → aggregate（页面显示空态提示，不产生 JS error / 空白）
 */
export function chooseInitialResultTab(result) {
  const isLeagueMode = result?.leagueMode === true
  const hasAggregate = Array.isArray(result?.aggregate) && result.aggregate.length > 0
  const hasBattles = Array.isArray(result?.battles) && result.battles.length > 0
  if (isLeagueMode || hasAggregate) return 'aggregate'
  if (hasBattles) return 'b0'
  return 'aggregate'
}

/**
 * Replay 页状态（明确状态模型，避免互相冲突的散落 boolean）：
 * EMPTY（无文件）→ FILES_SELECTED（有文件未解析）→ PROCESSING（解析 Job 进行中）→
 * READY（结果已展示；processingJobId 供 Export 复用）；异常 → FAILED / CANCELLED。
 * 页面状态由 processingJob / resp 派生，不引入 isLoading/isPreviewing 等互斥 flag。
 */
export function useReplay() {
  const { locale, t, te } = useI18n()
  const files = ref([])
  /**
   * 文件选择版本号：任何 files 集合变化（add / folder-add / remove /
   * clear / replace）都会经 updateFiles 自增并失效旧 processingJobId / resp，防止旧 dataset
   * 被当前 selection 复用；迟到的 READY 轮询响应经 processingPollJobId token 丢弃。
   */
  const selectionRevision = ref(0)
  const loading = ref(false)
  const error = ref('')
  const resp = ref(null)
  const activeTab = ref('aggregate')
  const pendingRemove = ref(null)

  // ---- Replay Processing Job（异步 Job：真实进度 + 可取消 + result 复用）----
  const processingJob = ref(null)
  const processingError = ref('')
  /** 已完成解析的 Processing Job id（供 Export 复用 result，不重新上传/processFull）。 */
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
  /**
   * 当前展示的 result 是否与当前 files selection 一致（export eligibility）：
   * processingJobId 与 resp 只会在「READY 自动加载」时成对设置、在 updateFiles 时成对清除，
   * 因此非 null 即代表「当前结果 = 当前文件选择」，可安全复用该 dataset 导出；
   * 否则 Export 必须走 multipart 上传当前 files 路径，绝不静默导出旧 dataset。
   */
  const resultMatchesSelection = computed(() => !!processingJobId.value && !!resp.value)

  function buildFormData() {
    const fd = new FormData()
    files.value.forEach(f => fd.append('files', f, displayName(f)))
    return fd
  }

  /**
   * 统一的文件集合更新入口：任何 files 变化都会使旧解析结果失效——
   * processingJobId（已 READY 的 dataset）与 resp（已展示的结果）与当前 selection 不再一致，
   * 必须立即清除，避免「UI 显示 dataset A、files 是 dataset B、Export 复用 A」的静默错数据。
   *
   * <p>还在跑的旧 Processing Job 对当前 selection 无意义：停止轮询（token 置 null，迟到
   * 的 READY/FAILED 响应被丢弃，不覆盖当前 selection）并后台请求协作取消（释放 queue slot / 容量）。</p>
   *
   * <p>Export Job 不受影响：它是对用户已确认选择的一次导出快照，继续完成。</p>
   */
  function updateFiles(next) {
    files.value = next
    selectionRevision.value++
    processingJobId.value = null
    resp.value = null
    activeTab.value = 'aggregate'
    processingError.value = ''
    stopProcessingPolling()
    const job = processingJob.value
    processingJob.value = null
    if (job && JOB_ACTIVE.has(job.status)) {
      api.cancelProcessingJob(job.jobId).catch(() => {})
    }
  }

  // ---- Processing Job 流程 ----

  function stopProcessingPolling() {
    if (processingPollTimer) { clearInterval(processingPollTimer); processingPollTimer = null }
    processingPollJobId = null
  }

  async function pollProcessingJob(onColumnsInit) {
    const pollJobId = processingPollJobId
    if (!pollJobId) return
    try {
      const data = await api.getProcessingJob(pollJobId)
      // 轮询期间 selection 已变化 / 新 job 已启动
      // （updateFiles / startProcessingJob 已替换 processingPollJobId）→ 丢弃过期响应，
      // 绝不让旧 job 的 READY result 覆盖当前 selection。
      if (processingPollJobId !== pollJobId) {
        loading.value = false
        return
      }
      processingJob.value = data
      if (data.status === 'READY') {
        const readyJobId = pollJobId
        const revisionAtReady = selectionRevision.value
        stopProcessingPolling()
        const result = await api.getProcessingJobResult(readyJobId)
        if (selectionRevision.value !== revisionAtReady) {
          // 拉取 result 期间 files 已变化：丢弃（不展示、不复用），当前 selection 无结果。
          loading.value = false
          return
        }
        // result 与 files 是同一批次（READY 后不再变化）；直接替换 resp。
        resp.value = result
        processingJobId.value = readyJobId
        // P0：默认 tab 只依赖 response 本身（resp.league / aggregate / battles），
        // 在 columns 初始化之前决定——保证 READY 提交周期内 resp、League 模式、
        // aggregate 可见性与 activeTab 一致，结果 panel 第一帧即渲染，无需二次 poll/点击。
        activeTab.value = chooseInitialResultTab(result)
        if (onColumnsInit) onColumnsInit(result)
        loading.value = false
      } else if (data.status === 'FAILED' || data.status === 'CANCELLED') {
        stopProcessingPolling()
        loading.value = false
        if (data.status === 'FAILED') {
          processingError.value = data.errorCode === 'NO_VALID_REPLAYS'
            ? t('replay.processing_job.no_valid_replays')
            : data.errorCode === 'MIXED_LEAGUE_AND_STANDARD_REPLAYS'
              ? t('replay.processing_job.mixed_league_standard')
              : t('replay.processing_job.failed')
        }
      }
    } catch (e) {
      // stale error race：旧 job 的迟到失败（网络 reject / 404 / timeout）
      // 同样不得影响已更新的 Processing Job——token 已变（updateFiles 停止 / 新 job 已启动）则
      // 直接丢弃，绝不清掉新 job 的 timer/token（否则 P2 后端继续跑但前端永远停止轮询）。
      if (processingPollJobId !== pollJobId) {
        return
      }
      // job 已过期/网络错误：停止轮询，提示重新解析（不阻塞页面）
      stopProcessingPolling()
      processingJob.value = null
      loading.value = false
      processingError.value = apiErrorLabel(t, te, e)
    }
  }

  /**
   * 创建解析任务并开始轮询真实进度。READY 后自动拉取 result 展示。
   * 防重复：已有活跃 job 时忽略再次点击。
   */
  async function startProcessingJob(onColumnsInit) {
    if (!files.value.length) { error.value = t('replay.no_files'); return }
    if (processingActive.value) return
    const revisionAtCreate = selectionRevision.value
    loading.value = true
    error.value = ''
    processingError.value = ''
    try {
      const created = await api.createProcessingJob(buildFormData())
      if (selectionRevision.value !== revisionAtCreate) {
        // 创建请求期间 files 已变化：该 job 的输入不再匹配当前 selection——不注册到状态，
        // 后台取消（其输入由后端 TTL 清理）。
        api.cancelProcessingJob(created.jobId).catch(() => {})
        loading.value = false
        return
      }
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
   * 已解析 result，不再重新上传 replay / 重新解析。防重复：已有活跃 job 时忽略。
   *
   * @param {object|null} teamNamesOverrides League 战队名称覆盖
   *        {battle:{arenaId:team:名}, summary:{teamKey:名}}（必须完整传给 Export Job）；
   *        创建时快照进 Export Job，后续编辑不影响已创建的异步任务。
   */
  async function startExportJob(mode, teamNamesOverrides = null) {
    if (!files.value.length) { error.value = t('replay.no_files'); return }
    if (exportActive.value) return
    error.value = ''
    exportError.value = ''
    try {
      const reuse = resultMatchesSelection.value
      const body = reuse ? null : buildFormData()
      const teamNamesJson = teamNamesOverrides ? JSON.stringify(teamNamesOverrides) : null
      const created = await api.createExportJob(body, mode,
        reuse ? processingJobId.value : undefined, teamNamesJson)
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
    const next = p.type === 'battle'
      ? files.value.filter(f => displayName(f) !== p.battle.sourceName)
      : files.value.filter(f => fileKey(f) !== fileKey(p.file))
    updateFiles(next)
    if (next.length) startProcessingJob(onColumnsInit)
  }

  function confirmRemoveBattle(onColumnsInit) {
    if (pendingRemove.value?.type === 'battle') confirmRemove(onColumnsInit)
    else pendingRemove.value = null
  }

  return {
    files, loading, error, resp, playerCols, aggCols, activeTab, aggStats, pendingRemove,
    /** 文件集合版本号：任何 selection 变化（updateFiles）都会自增；team overrides 等 selection-bound 状态以此失效。 */
    selectionRevision,
    updateFiles,
    processingJob, processingError, processingActive, processingJobId,
    exportJob, exportError, exportActive,
    startProcessingJob, cancelProcessingJob, dismissProcessingJob,
    startExportJob, cancelExportJob, downloadExportResult, dismissExportJob,
    askRemoveBattle, askRemoveFile, cancelRemove, confirmRemove, confirmRemoveBattle,
  }
}