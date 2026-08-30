import { ref, computed, onUnmounted } from 'vue'
import { useI18n } from 'vue-i18n'
import { displayName, mapLabel, fileKey } from '../utils/helpers.js'
import { apiErrorLabel } from '../utils/display.js'
import { normalizeApiError, normalizeJobError } from '../utils/http.js'
import * as api from '../utils/api.js'

const JOB_TERMINAL = new Set(['READY', 'FAILED', 'CANCELLED'])
const JOB_ACTIVE = new Set(['QUEUED', 'PROCESSING'])
const JOB_POLL_MS = 1500

/**
 * Dataset-only 目标 source 可用性判定（现存 job 上）：source READY 由调用方复用；
 * FAILED → SOURCE_PROCESSING_FAILED（不可恢复）；source 不存在 → SOURCE_NOT_FOUND；
 * 其它 terminal/non-ready → SOURCE_NOT_READY。只有权威 JOB_NOT_FOUND 才允许重建 Dataset。
 */
function assertSourceAvailable(sourceId, source) {
  if (source && source.status === 'FAILED') throw new Error('SOURCE_PROCESSING_FAILED')
  if (!source) throw new Error('SOURCE_NOT_FOUND')
  throw new Error('SOURCE_NOT_READY')
}

/** 处理中 UI 状态（单一事实源；UPLOADING/REGISTERING 为前端本地态）。 */
const PROCESSING_UI_STATES = Object.freeze({
  EMPTY: 'EMPTY',
  FILES_SELECTED: 'FILES_SELECTED',
  UPLOADING: 'UPLOADING',
  REGISTERING: 'REGISTERING',
  QUEUED: 'QUEUED',
  PROCESSING: 'PROCESSING',
  FINALIZING: 'FINALIZING',
  READY: 'READY',
  FAILED: 'FAILED',
  CANCELLED: 'CANCELLED'
})

/**
 * 初始结果 tab 决策（activeTab 必须始终指向真实存在、可渲染的结果 panel）。
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
  /** 上传阶段本地状态（{phase:'UPLOADING'|'REGISTERING', loaded, total, percent}）。 */
  const uploadState = ref(null)
  /**
   * 当前 selection 的 in-flight Processing create（single-flight）：
   * {revision, promise, controller, prioritySourceIndex, onColumnsInit,
   *  phase, cancelRequested}。
   * 同一 selectionRevision 下所有 startProcessingJob / requestDirectAction 共享同一个
   * create Promise——api.createProcessingJob 至多调用一次；priority 由第一个发起者决定，
   * 后续 caller 复用同一 job 后各自等待自己的 sourceId READY。绝不用
   * 「abort 旧 create + 新建」来实现 priority 切换（abort XHR ≠ 后端事务回滚）。
   * phase = 'UPLOADING' | 'REGISTERING'；REGISTERING 表示 multipart body 已上传完成，
   * 后端可能已创建 job——此时禁止 abort（会丢 jobId），只能标记 cancelRequested 等
   * 202 返回后 cancel。
   */
  let processingStart = null
  /** source-ready poll 生命周期注册表（selection change / cancel / teardown 后全部终止）。 */
  const sourcePolls = new Set()
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
  /** 处理 UX 派生状态：upload 本地态 → job 状态 + phase（FINALIZING_BATCH → FINALIZING）。 */
  const processingUiState = computed(() => {
    if (uploadState.value) return uploadState.value.phase
    const job = processingJob.value
    if (!job) return files.value.length ? PROCESSING_UI_STATES.FILES_SELECTED : PROCESSING_UI_STATES.EMPTY
    switch (job.status) {
      case 'QUEUED': return PROCESSING_UI_STATES.QUEUED
      case 'PROCESSING':
        return job.phase === 'FINALIZING_BATCH' ? PROCESSING_UI_STATES.FINALIZING : PROCESSING_UI_STATES.PROCESSING
      case 'READY': return PROCESSING_UI_STATES.READY
      case 'FAILED': return PROCESSING_UI_STATES.FAILED
      case 'CANCELLED': return PROCESSING_UI_STATES.CANCELLED
      default: return PROCESSING_UI_STATES.FILES_SELECTED
    }
  })
  /**
   * 当前展示的 result 是否与当前 files selection 一致（export eligibility）：
   * processingJobId 与 resp 只会在「READY 自动加载」时成对设置、在 updateFiles 时成对清除，
   * 因此非 null 即代表「当前结果 = 当前文件选择」，可安全复用该 dataset 导出；
   * 否则（processingJobId 为空）Export 拒绝（require_processing），无 multipart 回退。
   */
  const resultMatchesSelection = computed(() => !!processingJobId.value && !!resp.value)

  function buildFormData(prioritySourceIndex) {
    const fd = new FormData()
    files.value.forEach(f => fd.append('files', f, displayName(f)))
    if (prioritySourceIndex !== undefined && prioritySourceIndex !== null) {
      fd.append('prioritySourceIndex', String(prioritySourceIndex))
    }
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
    stopAllSourcePolls()
    const job = processingJob.value
    processingJob.value = null
    if (processingStart) {
      if (processingStart.phase === 'REGISTERING') {
        // multipart 已上传完，后端可能已注册 job——禁止 abort 丢 jobId，
        // 标记取消等 202 返回后 cancel；在旧 create settle 前不新建（保持 single-flight）。
        processingStart.cancelRequested = true
      } else {
        // UPLOADING：body 尚未完整发送，abort 安全（server 未接受 → 无 orphan）。
        processingStart.controller?.abort()
        processingStart = null
        loading.value = false
      }
    } else {
      // 无 in-flight create（已绑定 job / 空闲）：selection 变化后无 loading。
      loading.value = false
    }
    uploadState.value = null
    if (job && JOB_ACTIVE.has(job.status)) {
      api.cancelProcessingJob(job.jobId).catch(() => {})
    }
  }

  // ---- Processing Job 流程 ----

  function stopProcessingPolling() {
    if (processingPollTimer) { clearInterval(processingPollTimer); processingPollTimer = null }
    processingPollJobId = null
  }

  /** 终止全部 source-ready poll（timer + abort），旧 poll 不得再写当前状态。 */
  function stopAllSourcePolls() {
    for (const entry of [...sourcePolls]) {
      if (entry.timer) clearTimeout(entry.timer)
      entry.controller.abort()
    }
    sourcePolls.clear()
  }

  /** 终止指定 Processing Job 的 source-ready poll（其余 job 的 poll 不受影响）。 */
  function stopSourcePollsForJob(jobId) {
    for (const entry of [...sourcePolls]) {
      if (entry.jobId === jobId) {
        if (entry.timer) clearTimeout(entry.timer)
        entry.controller.abort()
        sourcePolls.delete(entry)
      }
    }
  }

  async function pollProcessingJob(onColumnsInit) {
    const pollJobId = processingPollJobId
    const pollRevision = selectionRevision.value
    if (!pollJobId) return
    try {
      const data = await api.getProcessingJob(pollJobId)
      // STALE RESPONSE = ZERO SHARED STATE WRITES——轮询期间 selection 已变化
      // 或新 job 已启动（processingPollJobId 被替换）→ 直接丢弃，不写 loading / job / error。
      if (processingPollJobId !== pollJobId || selectionRevision.value !== pollRevision) return
      processingJob.value = data
      if (data.status === 'READY') {
        const readyJobId = pollJobId
        const revisionAtReady = selectionRevision.value
        stopProcessingPolling()
        const result = await api.getProcessingJobResult(readyJobId)
        // stale READY result：selection 已变或当前 job 已被替换 → pure discard（零写入）。
        if (selectionRevision.value !== revisionAtReady || processingPollJobId != null) return
        // result 与 files 是同一批次（READY 后不再变化）；直接替换 resp。
        resp.value = result
        processingJobId.value = readyJobId
        // 默认 tab 只依赖 response 本身：resp.leagueMode / resp.aggregate / resp.battles
        // （resp.league 不是页面级 CW mode source；页面级唯一事实源是 resp.leagueMode）。
        // 在 columns 初始化之前决定——保证 READY 提交周期内 resp、League 模式、
        // aggregate 可见性与 activeTab 一致，结果 panel 第一帧即渲染，无需二次 poll/点击。
        activeTab.value = chooseInitialResultTab(result)
        if (onColumnsInit) onColumnsInit(result)
        loading.value = false
      } else if (data.status === 'FAILED' || data.status === 'CANCELLED') {
        stopProcessingPolling()
        loading.value = false
        if (data.status === 'FAILED') {
          processingError.value = apiErrorLabel(t, te, normalizeJobError(data))
        }
      }
    } catch (e) {
      // stale error race：旧 job 的迟到失败（网络 reject / 404 / timeout）
      // 同样不得影响已更新的 Processing Job——token/revision 已变则直接丢弃（零写入）。
      if (processingPollJobId !== pollJobId || selectionRevision.value !== pollRevision) return
      // job 已过期/网络错误：停止轮询，提示重新解析（不阻塞页面）
      stopProcessingPolling()
      processingJob.value = null
      loading.value = false
      processingError.value = apiErrorLabel(t, te, e)
    }
  }

  /** 当前 create 是否为最新 owner（只有 owner 才能写共享 UI 状态）。 */
  function isCurrentCreate(start) {
    return processingStart === start
  }

  /**
   * 确保当前 selection 有且仅有一个 Processing Job（single-flight）：
   * 1) 已有活跃 job（QUEUED/PROCESSING）→ 直接复用；2) 同 revision 已有 in-flight create
   * → 共享同一 Promise（manual Parse 可补充 READY 后的列初始化）；3) 否则创建。
   * 返回 {jobId, stale}。
   */
  async function ensureProcessingCreate(prioritySourceIndex, onColumnsInit) {
    const job = processingJob.value
    if (job && (job.status === 'QUEUED' || job.status === 'PROCESSING')) {
      return { jobId: job.jobId, stale: false }
    }
    if (processingStart && processingStart.cancelRequested) {
      // 旧 create（REGISTERING cancel / selection change）settle 前禁止新建——
      // 无法证明旧 job 不存在；等它 resolve（cancel）或 reject 后才允许新 create，保持 single-flight。
      try {
        await processingStart.promise
      } catch {
        // 旧 create reject：确认没有可持有 jobId，允许继续新建
      }
      return ensureProcessingCreate(prioritySourceIndex, onColumnsInit)
    }
    if (processingStart && processingStart.revision === selectionRevision.value) {
      if (onColumnsInit) {
        processingStart.onColumnsInit = onColumnsInit
      }
      return processingStart.promise
    }
    const revision = selectionRevision.value
    const start = {
      revision,
      prioritySourceIndex,
      onColumnsInit,
      controller: new AbortController(),
      phase: 'UPLOADING',
      cancelRequested: false
    }
    processingStart = start
    start.promise = doCreate(start) // doCreate 的同步前缀内可能触发 onProgress（mock），必须先登记 owner
    return start.promise
  }

  /**
   * 真正的 create + bind（single-flight owner）。stale / abort / 迟到 catch/finally
   * 只能清理自己的局部资源；共享 UI 状态（uploadState / loading / processingError /
   * processingJob / poll token）一律经 isCurrentCreate 校验后才允许写。
   */
  async function doCreate(start) {
    const revision = start.revision
    const controller = start.controller
    loading.value = true
    error.value = ''
    processingError.value = ''
    uploadState.value = { phase: 'UPLOADING', loaded: 0, total: 0, percent: 0 }
    try {
      const created = await api.createProcessingJob(buildFormData(start.prioritySourceIndex), {
        onProgress: ({ loaded, total, percent }) => {
          if (!isCurrentCreate(start)) {
            return // 旧 owner 的进度不得写当前 UI
          }
          // 上传体已发完但 202 未返回 → REGISTERING
          start.phase = percent >= 100 ? 'REGISTERING' : 'UPLOADING'
          uploadState.value = {
            phase: start.phase,
            loaded,
            total,
            percent
          }
        },
        signal: controller.signal
      })
      if (start.cancelRequested) {
        // REGISTERING 取消——server 已返回 jobId，best-effort cancel，
        // 不绑定 / 不 poll / 不写 resp / 不暴露成当前 Dataset；lifecycle 到此结束。
        await api.cancelProcessingJob(created.jobId).catch(() => {})
        if (isCurrentCreate(start)) {
          processingStart = null
          uploadState.value = null
          loading.value = false
        }
        return { jobId: created.jobId, stale: true }
      }
      if (selectionRevision.value !== revision || !isCurrentCreate(start)) {
        // selection 已变 / owner 已被替换——best-effort cancel，不绑定、不 poll、
        // 不覆盖当前 selection 状态。abort 发生时 server 可能已成功创建 job，必须 cancel 兜底。
        api.cancelProcessingJob(created.jobId).catch(() => {})
        if (isCurrentCreate(start)) {
          processingStart = null
          uploadState.value = null
          loading.value = false
        }
        return { jobId: created.jobId, stale: true }
      }
      stopProcessingPolling() // 新主 poll 前确保旧 interval 已终止（无 lost interval）
      stopAllSourcePolls() // 新 job 绑定：终止任何旧 source-ready poll（其 jobId 已失效）
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
      processingPollTimer = setInterval(() => pollProcessingJob(start.onColumnsInit), JOB_POLL_MS)
      pollProcessingJob(start.onColumnsInit)
      processingStart = null
      uploadState.value = null
      return { jobId: created.jobId, stale: false }
    } catch (e) {
      if (isCurrentCreate(start)) {
        processingStart = null
        uploadState.value = null
        loading.value = false
      }
      throw e
    }
  }

  /**
   * 创建解析任务并开始轮询真实进度。READY 后自动拉取 result 展示。
   * 防重复：已有活跃 job 时忽略；UPLOADING/REGISTERING 期间与 Direct Action 共享
   * 同一个 create（single-flight），绝不 abort 后重建第二个 backend job。
   */
  async function startProcessingJob(onColumnsInit, { prioritySourceIndex } = {}) {
    if (!files.value.length) { error.value = t('replay.no_files'); return }
    if (processingActive.value) return
    // 当前 selection 已拥有 READY result/dataset → 普通 Preview 不得重新
    // create / upload / full-process；保留现有 resp，必要时重跑列初始化，直接返回。
    if (processingJobId.value && resp.value) {
      if (onColumnsInit) onColumnsInit(resp.value)
      return
    }
    const revisionAtStart = selectionRevision.value
    try {
      const result = await ensureProcessingCreate(prioritySourceIndex, onColumnsInit)
      if (!result || result.stale) return
    } catch (e) {
      if (normalizeApiError(e).code === 'REQUEST_ABORTED') {
        // 用户取消上传 / selection 变化：不显示错误（状态由 cancelProcessing/updateFiles 处理）。
        return
      }
      if (selectionRevision.value !== revisionAtStart) return // stale 非 Abort 错误：零写入
      loading.value = false
      processingError.value = `${t('replay.preview_failed')}: ${apiErrorLabel(t, te, e)}`
    }
  }

  /** 轮询直到指定 source READY（Direct Capability）。 */
  function pollSourceReady(jobId, sourceId) {
    const entry = { jobId, sourceId, controller: new AbortController(), timer: null, settled: false }
    sourcePolls.add(entry)
    let resolve
    let reject
    const cleanup = () => {
      sourcePolls.delete(entry)
      if (entry.timer) {
        entry.timer = null
      }
    }
    /** 唯一 terminal：resolve 至多一次，settle 后立即释放 registry（timer + abort）。 */
    const resolveOnce = (value) => {
      if (entry.settled) return
      entry.settled = true
      cleanup()
      resolve(value)
    }
    /** 唯一 terminal：reject 至多一次，settle 后立即释放 registry（timer + abort）。 */
    const rejectOnce = (error) => {
      if (entry.settled) return
      entry.settled = true
      cleanup()
      reject(error)
    }
    // 取消（stopAllSourcePolls / stopSourcePollsForJob / teardown）必须立刻 settle：GET pending、
    // timer 等待期间 abort 都不能让外层 Promise 永久 pending（迟到 response 一律 pure discard）。
    entry.controller.signal.addEventListener('abort', () => {
      if (entry.timer) {
        clearTimeout(entry.timer)
        entry.timer = null
      }
      rejectOnce(new Error('SOURCE_POLL_CANCELLED'))
    }, { once: true })
    return new Promise((res, rej) => {
      resolve = res
      reject = rej
      const poll = async () => {
        if (entry.controller.signal.aborted) {
          rejectOnce(new Error('SOURCE_POLL_CANCELLED'))
          return
        }
        let data
        try {
          data = await api.getProcessingJob(jobId)
        } catch (e) {
          // GET 失败：取消已发生 → 一律以本地 cancellation settle（迟到 reject 不得把
          // 网络错误写成当前用户错误）；未取消 → 原样传播。
          if (entry.controller.signal.aborted) {
            rejectOnce(new Error('SOURCE_POLL_CANCELLED'))
          } else {
            rejectOnce(e)
          }
          return
        }
        // 迟到响应（await 期间已取消）：pure discard，外层 Promise 以 cancellation settle。
        if (entry.controller.signal.aborted) {
          rejectOnce(new Error('SOURCE_POLL_CANCELLED'))
          return
        }
        const s = (data.sources || []).find(x => x.sourceId === sourceId)
        if (s && s.status === 'READY') {
          resolveOnce({ processingJobId: jobId, sourceId })
          return
        }
        if (s && s.status === 'FAILED') {
          rejectOnce(new Error('SOURCE_PROCESSING_FAILED'))
          return
        }
        if (JOB_TERMINAL.has(data.status)) {
          rejectOnce(new Error('SOURCE_NOT_READY'))
          return
        }
        entry.timer = setTimeout(poll, 750)
      }
      poll()
    })
  }

  /**
   * Direct AI/Playback：选中文件直接点击 capability 时，确保 Dataset 存在
   * 且目标 source READY（无则自动创建 Processing Job + priority 优先解析），返回
   * {processingJobId, sourceId} 供面板消费。批量其余 source 继续后台解析。
   * 查找顺序：1) 已有 READY dataset → 2) 当前 active job → 3) 当前
   * selection 的 in-flight create（single-flight）→ 4) 才创建。同一 selection 的所有
   * Direct Action 共享同一个 backend Processing Job（绝无 p1/p2 双 job）。
   */
  async function requestDirectAction(file) {
    const idx = files.value.findIndex(f => fileKey(f) === fileKey(file))
    if (idx < 0) throw new Error('NO_REPLAY_FILE')
    const sourceId = `r${idx}`
    // 1) 已有 READY dataset（dismiss 面板后仍可复用，不重新 full process）。
    //    进入该 async 分支时立即 capture 不可变 datasetJobId；整个分支（GET / READY return /
    //    poll / JOB_NOT_FOUND invalidate）只操作该 job——绝不跨 await 再用 mutable
    //    processingJobId.value 判定「这个 response 属于哪个 job」。
    const datasetJobId = processingJobId.value
    if (datasetJobId) {
      try {
        const data = await api.getProcessingJob(datasetJobId)
        const s = (data.sources || []).find(x => x.sourceId === sourceId)
        if (s && s.status === 'READY') {
          // ownership guard：await 期间 current Dataset 若已换成别的 job，则该成功 response
          // 已 stale——绝不伪装成 current identity 返回（防 p1 READY 混入 p2 identity），
          // 而是 discard 后继续向下找 current job（复用 branch 2 的 current active job）。
          if (processingJobId.value === datasetJobId) {
            return { processingJobId: datasetJobId, sourceId }
          }
        } else if (data.status === 'QUEUED' || data.status === 'PROCESSING') {
          // poll 绑定至 capture 的 datasetJobId：即使 current 后来切到 p2，p1 poll 只影响 p1。
          return pollSourceReady(datasetJobId, sourceId)
        } else {
          // 现存 Job 已 terminal（READY/FAILED/CANCELLED）且目标 source 未 READY——source FAILED /
          // source 不存在 / 其它 non-ready → 抛出稳定不可恢复错误，绝不静默续到步骤 3 新建
          // Processing Job（只有权威 JOB_NOT_FOUND 才允许重建）。source 在 create 时即按上传顺序
          // 固定为 r{index}，不会「稍后出现」，因此缺失 source 就是 SOURCE_NOT_FOUND。
          assertSourceAvailable(sourceId, s)
        }
      } catch (e) {
        // 只有稳定 not-found（404 / JOB_NOT_FOUND）才 invalidate 并允许重建；
        // transient（network / 5xx / timeout / auth / malformed）必须传播，绝不隐藏后
        // 重新 full-process（createProcessingJob call count 必须为 0）。
        const expired = e && (e.status === 404 || e.code === 'JOB_NOT_FOUND')
        if (!expired) {
          throw e
        }
        // authoritative GET 已确认该 job 过期：只失效 capture 的 datasetJobId（p1），
        // 绝不 invalidate await 期间后来居上的 p2；不清空 resp。
        invalidateProcessingDatasetJob(datasetJobId)
      }
    }
    // 2) 当前 active job：source READY 直接返回；仍在处理则等自己的 sourceId；
    //    已 terminal（READY/FAILED/CANCELLED）但 source 未 READY → 稳定不可恢复错误（不重建）。
    const job = processingJob.value
    if (job && (job.status === 'QUEUED' || job.status === 'PROCESSING' || job.status === 'READY' || job.status === 'FAILED' || job.status === 'CANCELLED')) {
      const s = (job.sources || []).find(x => x.sourceId === sourceId)
      if (s && s.status === 'READY') return { processingJobId: job.jobId, sourceId }
      if (job.status === 'QUEUED' || job.status === 'PROCESSING') {
        return pollSourceReady(job.jobId, sourceId)
      }
      assertSourceAvailable(sourceId, s)
    }
    // 3)+4) in-flight create 或新建（single-flight：B 复用 A 的 create，绝不双 job）
    const created = await ensureProcessingCreate(idx)
    if (!created || created.stale) throw new Error('PROCESSING_START_FAILED')
    return pollSourceReady(created.jobId, sourceId)
  }

  /**
   * 统一取消：UPLOADING → abort 安全（server 未接受，无 orphan）；
   * REGISTERING → 禁止 abort 丢 jobId，标记 cancelRequested 等 202 返回后 cancel。
   * 已注册 Job → 协作取消。
   */
  function cancelProcessing() {
    if (uploadState.value && processingStart) {
      if (processingStart.phase === 'REGISTERING') {
        processingStart.cancelRequested = true
        return
      }
      processingStart.controller?.abort()
      processingStart = null
      uploadState.value = null
      loading.value = false
      return
    }
    return cancelProcessingJob()
  }

  async function cancelProcessingJob() {
    const job = processingJob.value
    if (!job || !JOB_ACTIVE.has(job.status)) return
    try {
      await api.cancelProcessingJob(job.jobId)
      stopProcessingPolling()
      stopAllSourcePolls()
      processingJob.value = { ...job, status: 'CANCELLED' }
      loading.value = false
    } catch (e) {
      processingError.value = apiErrorLabel(t, te, e)
    }
  }

  function dismissProcessingJob() {
    stopProcessingPolling()
    stopAllSourcePolls()
    processingJob.value = null
    processingError.value = ''
    // 注意：processingJobId 保留（READY 后供 Export 复用）；重新解析时会覆盖。
  }

  /**
   * 权威 Dataset 失效（单点）：后端已用 JOB_NOT_FOUND authoritatively 证明该 job 不存在。
   * 仅当 jobId 命中当前 Dataset identity（processingJobId）、当前 processingJob snapshot 或仍在
   * poll 绑定的 job 时才失效，绝不影响其它 generation/job。保留 resp（仍可安全展示已解析结果）；
   * 不改 files / selectionRevision；不自动 create 新 Processing Job。
   */
  function invalidateProcessingDatasetJob(jobId) {
    if (!jobId) return
    const wasCurrentDataset = processingJobId.value === jobId
    const hadSnapshot = processingJob.value?.jobId === jobId
    if (wasCurrentDataset) processingJobId.value = null
    if (hadSnapshot) processingJob.value = null
    if (hadSnapshot || processingPollJobId === jobId) {
      stopProcessingPolling()
    }
    stopSourcePollsForJob(jobId)
  }

  /** 权威 Dataset 失效（别名，兼容外部调用点）。 */
  function invalidateExpiredProcessingDataset(jobId) {
    invalidateProcessingDatasetJob(jobId)
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
    if (!processingJobId.value) {
      exportError.value = t('replay.export_job.require_processing')
      return
    }
    error.value = ''
    exportError.value = ''
    try {
      const teamNamesJson = teamNamesOverrides ? JSON.stringify(teamNamesOverrides) : null
      const created = await api.createExportJob(mode, processingJobId.value, teamNamesJson)
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
    stopAllSourcePolls()
    stopExportPolling()
    // owned 非终态 active Job（QUEUED/PROCESSING）必须 best-effort cancel；
    // READY 不 cancel（已不消耗 parse CPU，由 TTL lifecycle 管理）。
    const job = processingJob.value
    if (job && JOB_ACTIVE.has(job.status)) {
      api.cancelProcessingJob(job.jobId).catch(() => {})
    }
    if (processingStart) {
      if (processingStart.phase === 'REGISTERING') {
        // REGISTERING：禁止 abort 丢 jobId；标记取消，202 返回后 cancel（promise 续体
        // 在 unmount 后仍会执行并完成 cancel，绝不 orphan）。
        processingStart.cancelRequested = true
      } else {
        processingStart.controller?.abort()
        processingStart = null
      }
    }
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
    uploadState, processingUiState,
    exportJob, exportError, exportActive,
    startProcessingJob, cancelProcessingJob, cancelProcessing, dismissProcessingJob,
    invalidateExpiredProcessingDataset,
    requestDirectAction,
    startExportJob, cancelExportJob, downloadExportResult, dismissExportJob,
    askRemoveBattle, askRemoveFile, cancelRemove, confirmRemove, confirmRemoveBattle,
  }
}
