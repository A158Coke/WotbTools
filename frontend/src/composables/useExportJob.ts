import { useI18n } from 'vue-i18n'
import * as api from '../utils/api.js'
import { apiErrorLabel } from '../utils/display.js'
import type { ExportMode } from '../api/replay.js'
import type { ExportJobId, JsonObject } from '../types/replay.js'
import type { useReplaySession } from './useReplaySession.js'

const JOB_ACTIVE = new Set(['QUEUED', 'PROCESSING'])
const JOB_TERMINAL = new Set(['READY', 'FAILED', 'CANCELLED'])
const JOB_POLL_MS = 1500
type Session = ReturnType<typeof useReplaySession>

/**
 * Export Job 的唯一 lifecycle owner。
 * Processing Dataset identity 由 ReplaySession 提供；Export 只消费 READY 的
 * processingJobId，不参与 selection/result 的写入，也不重新上传 replay。
 */
export function useExportJob(session: Session) {
  const { t, te } = useI18n()
  const { files, error, processingJobId, exportJob, exportError, exportActive } = session
  let pollTimer: ReturnType<typeof setInterval> | null = null
  let pollJobId: ExportJobId | null = null
  let lifecycleToken = 0
  let pollRequestToken = 0
  let createInFlight = false

  function stopPolling() {
    if (pollTimer) {
      clearInterval(pollTimer)
      pollTimer = null
    }
    pollJobId = null
    pollRequestToken++
  }

  async function poll(ownerToken: number, currentJobId: ExportJobId): Promise<void> {
    if (!currentJobId) return
    const requestToken = ++pollRequestToken
    try {
      const data = await api.getExportJob(currentJobId)
      if (ownerToken !== lifecycleToken || pollJobId !== currentJobId || requestToken !== pollRequestToken) return
      exportJob.value = data
      if (JOB_TERMINAL.has(data.status)) stopPolling()
    } catch (e) {
      if (ownerToken !== lifecycleToken || pollJobId !== currentJobId || requestToken !== pollRequestToken) return
      stopPolling()
      exportJob.value = null
      exportError.value = apiErrorLabel(t, te, e)
    }
  }

  async function start(mode: ExportMode, teamNamesOverrides: JsonObject | null = null): Promise<void> {
    if (!files.value.length) {
      error.value = t('replay.no_files')
      return
    }
    if (exportActive.value || createInFlight) return
    if (!processingJobId.value) {
      exportError.value = t('replay.export_job.require_processing')
      return
    }
    error.value = ''
    exportError.value = ''
    const ownerToken = ++lifecycleToken
    createInFlight = true
    try {
      const teamNamesJson = teamNamesOverrides ? JSON.stringify(teamNamesOverrides) : null
      const created = await api.createExportJob(mode, processingJobId.value, teamNamesJson)
      if (ownerToken !== lifecycleToken) {
        api.cancelExportJob(created.jobId).catch(() => {})
        return
      }
      createInFlight = false
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
        contentType: null,
      }
      pollJobId = created.jobId
      pollTimer = setInterval(() => poll(ownerToken, created.jobId), JOB_POLL_MS)
      poll(ownerToken, created.jobId)
    } catch (e) {
      if (ownerToken !== lifecycleToken) return
      createInFlight = false
      exportError.value = `${t('replay.export_failed')}: ${apiErrorLabel(t, te, e)}`
    }
  }

  async function cancel(): Promise<void> {
    const job = exportJob.value
    if (!job || !JOB_ACTIVE.has(job.status)) return
    const ownerToken = lifecycleToken
    try {
      await api.cancelExportJob(job.jobId)
      if (ownerToken !== lifecycleToken || exportJob.value?.jobId !== job.jobId) return
      lifecycleToken++
      stopPolling()
      exportJob.value = { ...job, status: 'CANCELLED' }
    } catch (e) {
      if (ownerToken !== lifecycleToken) return
      exportError.value = apiErrorLabel(t, te, e)
    }
  }

  async function download(): Promise<void> {
    const job = exportJob.value
    if (!job || job.status !== 'READY') return
    const ownerToken = lifecycleToken
    try {
      const fallback = job.contentType && job.contentType.includes('zip') ? 'each-export.zip' : 'export.xlsx'
      await api.downloadExportJob(job.jobId, job.filename || fallback)
      if (ownerToken !== lifecycleToken || exportJob.value?.jobId !== job.jobId) return
    } catch (e) {
      if (ownerToken !== lifecycleToken || exportJob.value?.jobId !== job.jobId) return
      exportError.value = apiErrorLabel(t, te, e)
    }
  }

  function dismiss(): void {
    lifecycleToken++
    createInFlight = false
    stopPolling()
    exportJob.value = null
    exportError.value = ''
  }

  return {
    start,
    cancel,
    download,
    dismiss,
    stopPolling,
  }
}
