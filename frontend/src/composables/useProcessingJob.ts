import { onUnmounted } from 'vue'
import type { Composer } from 'vue-i18n'
import { apiErrorLabel } from '../utils/display.js'
import { displayName, fileKey } from '../utils/helpers.js'
import { normalizeApiError, normalizeJobError } from '../utils/http.js'
import type { ProcessingJob, UploadPhase, UploadProgressEvent } from '../types/jobs.js'
import type { ProcessingJobId, SourceId } from '../types/replay.js'
import type { ReplayAuthSession } from '../api/replay-capabilities.js'
import type { useReplaySession } from './useReplaySession.js'
import * as api from '../utils/api.js'

type I18nContext = Pick<Composer, 't' | 'te'>
type ReplaySession = ReturnType<typeof useReplaySession>
type ProcessingCreateResult = { jobId: ProcessingJobId; stale: boolean }

/**
 * `startProcessingJob` 的可判定结果：调用方（Android pending replay 的 exactly-once ACK）
 * 必须能区分「server 已接受该 processing request」与「没有真正创建 job」。
 */
type StartProcessingResult =
  | { accepted: true; jobId: ProcessingJobId }
  | { accepted: false; reason: 'EMPTY_SELECTION' | 'ALREADY_ACTIVE' | 'SUPERSEDED' | 'ABORTED' | 'REQUEST_FAILED' }
type ProcessingStart = {
  revision: number
  prioritySourceIndex?: number
  controller: AbortController
  phase: UploadPhase
  cancelRequested: boolean
  promise: Promise<ProcessingCreateResult> | null
}
type SourcePoll = {
  jobId: ProcessingJobId
  sourceId: SourceId
  controller: AbortController
  timer: ReturnType<typeof setTimeout> | null
  settled: boolean
}

const JOB_TERMINAL = new Set(['READY', 'FAILED', 'CANCELLED'])
const JOB_ACTIVE = new Set(['QUEUED', 'PROCESSING'])
const JOB_POLL_MS = 1500

function assertSourceAvailable(source: ProcessingJob['sources'][number] | undefined): never {
  if (source && source.status === 'FAILED') throw new Error('SOURCE_PROCESSING_FAILED')
  if (!source) throw new Error('SOURCE_NOT_FOUND')
  throw new Error('SOURCE_NOT_READY')
}

/**
 * Owns the Processing Job lifecycle for one ReplaySession.
 * The session supplies all shared refs; this composable owns upload/create,
 * polling, source readiness, single-flight and cancellation side effects.
 */
export function useProcessingJob(session: ReplaySession, { t, te }: I18nContext, auth: ReplayAuthSession) {
  const {
    files, selectionRevision, loading, error, resp,
    processingJob, processingError, uploadState, processingJobId,
    processingActive, replaceSelection, commitReadyResult,
  } = session

  let processingStart: ProcessingStart | null = null
  const sourcePolls = new Set<SourcePoll>()
  let processingPollTimer: ReturnType<typeof setInterval> | null = null
  let processingPollJobId: ProcessingJobId | null = null

  function buildFormData(prioritySourceIndex?: number) {
    const fd = new FormData()
    files.value.forEach(f => fd.append('files', f, displayName(f)))
    if (prioritySourceIndex !== undefined && prioritySourceIndex !== null) {
      fd.append('prioritySourceIndex', String(prioritySourceIndex))
    }
    return fd
  }

  function stopProcessingPolling() {
    if (processingPollTimer) { clearInterval(processingPollTimer); processingPollTimer = null }
    processingPollJobId = null
  }

  function stopAllSourcePolls() {
    for (const entry of [...sourcePolls]) {
      if (entry.timer) clearTimeout(entry.timer)
      entry.controller.abort()
    }
    sourcePolls.clear()
  }

  function stopSourcePollsForJob(jobId) {
    for (const entry of [...sourcePolls]) {
      if (entry.jobId === jobId) {
        if (entry.timer) clearTimeout(entry.timer)
        entry.controller.abort()
        sourcePolls.delete(entry)
      }
    }
  }

  async function pollProcessingJob(): Promise<void> {
    const pollJobId = processingPollJobId
    const pollRevision = selectionRevision.value
    if (!pollJobId) return
    try {
      const data = await api.getProcessingJob(auth, pollJobId)
      if (processingPollJobId !== pollJobId || selectionRevision.value !== pollRevision) return
      processingJob.value = data
      if (data.status === 'READY') {
        const readyJobId = pollJobId
        const revisionAtReady = selectionRevision.value
        stopProcessingPolling()
        const result = await api.getProcessingJobResult(auth, readyJobId)
        if (selectionRevision.value !== revisionAtReady || processingPollJobId != null) return
        commitReadyResult(result, readyJobId)
        loading.value = false
      } else if (data.status === 'FAILED' || data.status === 'CANCELLED') {
        stopProcessingPolling()
        loading.value = false
        if (data.status === 'FAILED') {
          processingError.value = apiErrorLabel(t, te, normalizeJobError(data))
        }
      }
    } catch (e) {
      if (processingPollJobId !== pollJobId || selectionRevision.value !== pollRevision) return
      stopProcessingPolling()
      processingJob.value = null
      loading.value = false
      processingError.value = apiErrorLabel(t, te, e)
    }
  }

  function isCurrentCreate(start: ProcessingStart): boolean {
    return processingStart === start
  }

  async function ensureProcessingCreate(prioritySourceIndex?: number): Promise<ProcessingCreateResult> {
    const job = processingJob.value
    if (job && JOB_ACTIVE.has(job.status)) return { jobId: job.jobId, stale: false }
    if (processingStart && processingStart.cancelRequested) {
      if (processingStart.promise) {
        try { await processingStart.promise } catch { /* cancellation/rejection is terminal */ }
      }
      return ensureProcessingCreate(prioritySourceIndex)
    }
    if (processingStart && processingStart.revision === selectionRevision.value && processingStart.promise) {
      return processingStart.promise
    }
    const start: ProcessingStart = {
      revision: selectionRevision.value,
      prioritySourceIndex,
      controller: new AbortController(),
      phase: 'UPLOADING',
      cancelRequested: false,
      promise: null,
    }
    processingStart = start
    start.promise = doCreate(start)
    return start.promise
  }

  async function doCreate(start: ProcessingStart): Promise<ProcessingCreateResult> {
    const revision = start.revision
    const controller = start.controller
    loading.value = true
    error.value = ''
    processingError.value = ''
    uploadState.value = { phase: 'UPLOADING', loaded: 0, total: 0, percent: 0 }
    try {
      const created = await api.createProcessingJob(auth, buildFormData(start.prioritySourceIndex), {
        onProgress: ({ loaded, total, percent }: UploadProgressEvent) => {
          if (!isCurrentCreate(start)) return
          start.phase = percent >= 100 ? 'REGISTERING' : 'UPLOADING'
          uploadState.value = { phase: start.phase, loaded, total, percent }
        },
        signal: controller.signal,
      })
      if (start.cancelRequested) {
        await api.cancelProcessingJob(auth, created.jobId).catch(() => {})
        if (isCurrentCreate(start)) {
          processingStart = null
          uploadState.value = null
          loading.value = false
        }
        return { jobId: created.jobId, stale: true }
      }
      if (selectionRevision.value !== revision || !isCurrentCreate(start)) {
        api.cancelProcessingJob(auth, created.jobId).catch(() => {})
        if (isCurrentCreate(start)) {
          processingStart = null
          uploadState.value = null
          loading.value = false
        }
        return { jobId: created.jobId, stale: true }
      }
      stopProcessingPolling()
      stopAllSourcePolls()
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
        currentFile: null,
        parseCompleted: 0,
        parseSucceeded: 0,
        parseFailed: 0,
        sources: [],
        activeSources: [],
      }
      processingPollJobId = created.jobId
      processingPollTimer = setInterval(() => pollProcessingJob(), JOB_POLL_MS)
      pollProcessingJob()
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

  function updateFiles(next: File[]): void {
    const job = processingJob.value
    replaceSelection(next)
    stopProcessingPolling()
    stopAllSourcePolls()
    if (processingStart) {
      if (processingStart.phase === 'REGISTERING') {
        processingStart.cancelRequested = true
      } else {
        processingStart.controller?.abort()
        processingStart = null
        loading.value = false
      }
    } else {
      loading.value = false
    }
    if (job && JOB_ACTIVE.has(job.status)) api.cancelProcessingJob(auth, job.jobId).catch(() => {})
  }

  async function startProcessingJob({ prioritySourceIndex }: { prioritySourceIndex?: number } = {}): Promise<StartProcessingResult> {
    if (!files.value.length) { error.value = t('replay.no_files'); return { accepted: false, reason: 'EMPTY_SELECTION' } }
    if (processingActive.value) return { accepted: false, reason: 'ALREADY_ACTIVE' }
    if (processingJobId.value && resp.value) {
      return { accepted: false, reason: 'ALREADY_ACTIVE' }
    }
    const revisionAtStart = selectionRevision.value
    try {
      const result = await ensureProcessingCreate(prioritySourceIndex)
      if (!result) return { accepted: false, reason: 'REQUEST_FAILED' }
      if (result.stale) return { accepted: false, reason: 'SUPERSEDED' }
      return { accepted: true, jobId: result.jobId }
    } catch (e) {
      if (normalizeApiError(e).code === 'REQUEST_ABORTED') return { accepted: false, reason: 'ABORTED' }
      if (selectionRevision.value !== revisionAtStart) return { accepted: false, reason: 'SUPERSEDED' }
      loading.value = false
      processingError.value = `${t('replay.preview_failed')}: ${apiErrorLabel(t, te, e)}`
      return { accepted: false, reason: 'REQUEST_FAILED' }
    }
  }

  function pollSourceReady(jobId: ProcessingJobId, sourceId: SourceId): Promise<{ processingJobId: ProcessingJobId; sourceId: SourceId }> {
    const entry: SourcePoll = { jobId, sourceId, controller: new AbortController(), timer: null, settled: false }
    sourcePolls.add(entry)
    let resolve: (value: { processingJobId: ProcessingJobId; sourceId: SourceId }) => void
    let reject: (reason?: unknown) => void
    const cleanup = () => {
      sourcePolls.delete(entry)
      if (entry.timer) entry.timer = null
    }
    const resolveOnce = (value) => {
      if (entry.settled) return
      entry.settled = true
      cleanup()
      resolve(value)
    }
    const rejectOnce = (reason) => {
      if (entry.settled) return
      entry.settled = true
      cleanup()
      reject(reason)
    }
    entry.controller.signal.addEventListener('abort', () => {
      if (entry.timer) {
        clearTimeout(entry.timer)
        entry.timer = null
      }
      rejectOnce(new Error('SOURCE_POLL_CANCELLED'))
    }, { once: true })
    return new Promise<{ processingJobId: ProcessingJobId; sourceId: SourceId }>((res, rej) => {
      resolve = res
      reject = rej
      const poll = async (): Promise<void> => {
        if (entry.controller.signal.aborted) {
          rejectOnce(new Error('SOURCE_POLL_CANCELLED'))
          return
        }
        let data: ProcessingJob
        try {
          data = await api.getProcessingJob(auth, jobId)
        } catch (e) {
          if (entry.controller.signal.aborted) rejectOnce(new Error('SOURCE_POLL_CANCELLED'))
          else rejectOnce(e)
          return
        }
        if (entry.controller.signal.aborted) {
          rejectOnce(new Error('SOURCE_POLL_CANCELLED'))
          return
        }
        const source = (data.sources || []).find(x => x.sourceId === sourceId)
        if (source && source.status === 'READY') {
          resolveOnce({ processingJobId: jobId, sourceId })
          return
        }
        if (source && source.status === 'FAILED') {
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

  async function requestDirectAction(file: File): Promise<{ processingJobId: ProcessingJobId; sourceId: SourceId }> {
    const idx = files.value.findIndex(f => fileKey(f) === fileKey(file))
    if (idx < 0) throw new Error('NO_REPLAY_FILE')
    const sourceId = `r${idx}` as SourceId
    const datasetJobId = processingJobId.value
    if (datasetJobId) {
      try {
        const data = await api.getProcessingJob(auth, datasetJobId)
        const source = (data.sources || []).find(x => x.sourceId === sourceId)
        if (source && source.status === 'READY') {
          if (processingJobId.value === datasetJobId) return { processingJobId: datasetJobId, sourceId }
        } else if (data.status === 'QUEUED' || data.status === 'PROCESSING') {
          return pollSourceReady(datasetJobId, sourceId)
        } else {
          assertSourceAvailable(source)
        }
      } catch (e) {
        const expired = e && (e.status === 404 || e.code === 'JOB_NOT_FOUND')
        if (!expired) throw e
        invalidateProcessingDatasetJob(datasetJobId)
      }
    }
    const job = processingJob.value
    if (job && (JOB_ACTIVE.has(job.status) || JOB_TERMINAL.has(job.status))) {
      const source = (job.sources || []).find(x => x.sourceId === sourceId)
      if (source && source.status === 'READY') return { processingJobId: job.jobId, sourceId }
      if (JOB_ACTIVE.has(job.status)) return pollSourceReady(job.jobId, sourceId)
      assertSourceAvailable(source)
    }
    const created = await ensureProcessingCreate(idx)
    if (!created || created.stale) throw new Error('PROCESSING_START_FAILED')
    return pollSourceReady(created.jobId, sourceId)
  }

  function cancelProcessing(): void | Promise<void> {
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

  async function cancelProcessingJob(): Promise<void> {
    const job = processingJob.value
    if (!job || !JOB_ACTIVE.has(job.status)) return
    try {
      await api.cancelProcessingJob(auth, job.jobId)
      stopProcessingPolling()
      stopAllSourcePolls()
      processingJob.value = { ...job, status: 'CANCELLED' }
      loading.value = false
    } catch (e) {
      processingError.value = apiErrorLabel(t, te, e)
    }
  }

  function dismissProcessingJob(): void {
    stopProcessingPolling()
    stopAllSourcePolls()
    processingJob.value = null
    processingError.value = ''
  }

  function invalidateProcessingDatasetJob(jobId: ProcessingJobId): void {
    if (!jobId) return
    const wasCurrentDataset = processingJobId.value === jobId
    const hadSnapshot = processingJob.value?.jobId === jobId
    if (wasCurrentDataset) processingJobId.value = null
    if (hadSnapshot) processingJob.value = null
    if (hadSnapshot || processingPollJobId === jobId) stopProcessingPolling()
    stopSourcePollsForJob(jobId)
  }

  function invalidateExpiredProcessingDataset(jobId: ProcessingJobId): void {
    invalidateProcessingDatasetJob(jobId)
  }

  onUnmounted(() => {
    stopProcessingPolling()
    stopAllSourcePolls()
    const job = processingJob.value
    if (job && JOB_ACTIVE.has(job.status)) api.cancelProcessingJob(auth, job.jobId).catch(() => {})
    if (processingStart) {
      if (processingStart.phase === 'REGISTERING') processingStart.cancelRequested = true
      else {
        processingStart.controller?.abort()
        processingStart = null
      }
    }
  })

  return {
    updateFiles,
    startProcessingJob,
    cancelProcessingJob,
    cancelProcessing,
    dismissProcessingJob,
    invalidateExpiredProcessingDataset,
    requestDirectAction,
  }
}
