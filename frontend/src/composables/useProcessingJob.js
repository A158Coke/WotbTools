import { onUnmounted } from 'vue'
import { apiErrorLabel } from '../utils/display.js'
import { displayName, fileKey } from '../utils/helpers.js'
import { normalizeApiError, normalizeJobError } from '../utils/http.js'
import * as api from '../utils/api.js'

const JOB_TERMINAL = new Set(['READY', 'FAILED', 'CANCELLED'])
const JOB_ACTIVE = new Set(['QUEUED', 'PROCESSING'])
const JOB_POLL_MS = 1500

function assertSourceAvailable(sourceId, source) {
  if (source && source.status === 'FAILED') throw new Error('SOURCE_PROCESSING_FAILED')
  if (!source) throw new Error('SOURCE_NOT_FOUND')
  throw new Error('SOURCE_NOT_READY')
}

/**
 * Owns the Processing Job lifecycle for one ReplaySession.
 * The session supplies all shared refs; this composable owns upload/create,
 * polling, source readiness, single-flight and cancellation side effects.
 */
export function useProcessingJob(session, { t, te }) {
  const {
    files, selectionRevision, loading, error, resp,
    processingJob, processingError, uploadState, processingJobId,
    processingActive, replaceSelection, commitReadyResult,
  } = session

  let processingStart = null
  const sourcePolls = new Set()
  let processingPollTimer = null
  let processingPollJobId = null

  function buildFormData(prioritySourceIndex) {
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

  async function pollProcessingJob() {
    const pollJobId = processingPollJobId
    const pollRevision = selectionRevision.value
    if (!pollJobId) return
    try {
      const data = await api.getProcessingJob(pollJobId)
      if (processingPollJobId !== pollJobId || selectionRevision.value !== pollRevision) return
      processingJob.value = data
      if (data.status === 'READY') {
        const readyJobId = pollJobId
        const revisionAtReady = selectionRevision.value
        stopProcessingPolling()
        const result = await api.getProcessingJobResult(readyJobId)
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

  function isCurrentCreate(start) {
    return processingStart === start
  }

  async function ensureProcessingCreate(prioritySourceIndex) {
    const job = processingJob.value
    if (job && JOB_ACTIVE.has(job.status)) return { jobId: job.jobId, stale: false }
    if (processingStart && processingStart.cancelRequested) {
      try { await processingStart.promise } catch { /* cancellation/rejection is terminal */ }
      return ensureProcessingCreate(prioritySourceIndex)
    }
    if (processingStart && processingStart.revision === selectionRevision.value) {
      return processingStart.promise
    }
    const start = {
      revision: selectionRevision.value,
      prioritySourceIndex,
      controller: new AbortController(),
      phase: 'UPLOADING',
      cancelRequested: false,
    }
    processingStart = start
    start.promise = doCreate(start)
    return start.promise
  }

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
          if (!isCurrentCreate(start)) return
          start.phase = percent >= 100 ? 'REGISTERING' : 'UPLOADING'
          uploadState.value = { phase: start.phase, loaded, total, percent }
        },
        signal: controller.signal,
      })
      if (start.cancelRequested) {
        await api.cancelProcessingJob(created.jobId).catch(() => {})
        if (isCurrentCreate(start)) {
          processingStart = null
          uploadState.value = null
          loading.value = false
        }
        return { jobId: created.jobId, stale: true }
      }
      if (selectionRevision.value !== revision || !isCurrentCreate(start)) {
        api.cancelProcessingJob(created.jobId).catch(() => {})
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

  function updateFiles(next) {
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
    if (job && JOB_ACTIVE.has(job.status)) api.cancelProcessingJob(job.jobId).catch(() => {})
  }

  async function startProcessingJob({ prioritySourceIndex } = {}) {
    if (!files.value.length) { error.value = t('replay.no_files'); return }
    if (processingActive.value) return
    if (processingJobId.value && resp.value) {
      return
    }
    const revisionAtStart = selectionRevision.value
    try {
      const result = await ensureProcessingCreate(prioritySourceIndex)
      if (!result || result.stale) return
    } catch (e) {
      if (normalizeApiError(e).code === 'REQUEST_ABORTED') return
      if (selectionRevision.value !== revisionAtStart) return
      loading.value = false
      processingError.value = `${t('replay.preview_failed')}: ${apiErrorLabel(t, te, e)}`
    }
  }

  function pollSourceReady(jobId, sourceId) {
    const entry = { jobId, sourceId, controller: new AbortController(), timer: null, settled: false }
    sourcePolls.add(entry)
    let resolve
    let reject
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

  async function requestDirectAction(file) {
    const idx = files.value.findIndex(f => fileKey(f) === fileKey(file))
    if (idx < 0) throw new Error('NO_REPLAY_FILE')
    const sourceId = `r${idx}`
    const datasetJobId = processingJobId.value
    if (datasetJobId) {
      try {
        const data = await api.getProcessingJob(datasetJobId)
        const source = (data.sources || []).find(x => x.sourceId === sourceId)
        if (source && source.status === 'READY') {
          if (processingJobId.value === datasetJobId) return { processingJobId: datasetJobId, sourceId }
        } else if (data.status === 'QUEUED' || data.status === 'PROCESSING') {
          return pollSourceReady(datasetJobId, sourceId)
        } else {
          assertSourceAvailable(sourceId, source)
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
      assertSourceAvailable(sourceId, source)
    }
    const created = await ensureProcessingCreate(idx)
    if (!created || created.stale) throw new Error('PROCESSING_START_FAILED')
    return pollSourceReady(created.jobId, sourceId)
  }

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
  }

  function invalidateProcessingDatasetJob(jobId) {
    if (!jobId) return
    const wasCurrentDataset = processingJobId.value === jobId
    const hadSnapshot = processingJob.value?.jobId === jobId
    if (wasCurrentDataset) processingJobId.value = null
    if (hadSnapshot) processingJob.value = null
    if (hadSnapshot || processingPollJobId === jobId) stopProcessingPolling()
    stopSourcePollsForJob(jobId)
  }

  function invalidateExpiredProcessingDataset(jobId) {
    invalidateProcessingDatasetJob(jobId)
  }

  onUnmounted(() => {
    stopProcessingPolling()
    stopAllSourcePolls()
    const job = processingJob.value
    if (job && JOB_ACTIVE.has(job.status)) api.cancelProcessingJob(job.jobId).catch(() => {})
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
