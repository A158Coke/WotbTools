import type {
  ExportJob,
  ExportJobCreateResponse,
  ProcessingJob,
  ProcessingJobCreateResponse,
  UploadProgress,
} from '../types/jobs.js'
import type { ReplayResult } from '../types/replay.js'
import {
  isExportJob,
  isExportJobCreateResponse,
  isJobCreateResponse,
  isProcessingJob,
  isReplayResult,
} from '../types/guards.js'
import {
  ApiError,
  apiErrorFromXhr,
  apiFetch,
  requireOk,
} from '../utils/http.js'

export type ExportMode = 'aggregate' | 'each' | (string & {})

function invalidResponse(message: string, status: number | null = null): ApiError {
  return new ApiError({ errorCode: 'INVALID_RESPONSE', status, retryable: false, errorMsg: message })
}

async function readJson<T>(response: Response, guard: (value: unknown) => value is T, label: string): Promise<T> {
  let body: unknown
  try {
    body = await response.json() as unknown
  } catch {
    throw invalidResponse(`${label} response is not valid JSON`, response.status)
  }
  if (!guard(body)) throw invalidResponse(`${label} response does not match its contract`, response.status)
  return body
}

async function downloadResponse(response: Response, fallbackName: string): Promise<void> {
  const blob = await response.blob()
  const disposition = response.headers.get('Content-Disposition') || ''
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filenameFromDisposition(disposition) || fallbackName
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
  URL.revokeObjectURL(url)
}

/** Create an asynchronous processing job from replay files. */
export function createProcessingJob(
  body: FormData,
  options: { onProgress?: (progress: UploadProgress) => void; signal?: AbortSignal } = {},
): Promise<ProcessingJobCreateResponse> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest()
    xhr.open('POST', '/api/replay/processing-jobs')
    const abort = () => xhr.abort()
    options.signal?.addEventListener('abort', abort, { once: true })
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable && options.onProgress) {
        options.onProgress({
          loaded: event.loaded,
          total: event.total,
          percent: Math.min(100, Math.round((event.loaded / event.total) * 100)),
        })
      }
    }
    xhr.onload = () => {
      options.signal?.removeEventListener('abort', abort)
      if (xhr.status >= 200 && xhr.status < 300) {
        let bodyValue: unknown
        try {
          bodyValue = JSON.parse(xhr.responseText || '{}') as unknown
        } catch {
          reject(invalidResponse('Processing job response is not valid JSON', xhr.status))
          return
        }
        if (!isJobCreateResponse(bodyValue)) {
          reject(invalidResponse('Processing job response does not match its contract', xhr.status))
          return
        }
        resolve(bodyValue)
        return
      }
      reject(apiErrorFromXhr(xhr))
    }
    xhr.onerror = () => {
      options.signal?.removeEventListener('abort', abort)
      reject(new ApiError({ code: 'NETWORK_ERROR', status: null, retryable: true }))
    }
    xhr.onabort = () => {
      options.signal?.removeEventListener('abort', abort)
      reject(new ApiError({ code: 'REQUEST_ABORTED', status: null, retryable: false }))
    }
    xhr.send(body)
  })
}

export async function getProcessingJob(jobId: string): Promise<ProcessingJob> {
  const response = await requireOk(await apiFetch(`/api/replay/processing-jobs/${encodeURIComponent(jobId)}`))
  return readJson(response, isProcessingJob, 'Processing job status')
}

export async function cancelProcessingJob(jobId: string): Promise<void> {
  await requireOk(await apiFetch(`/api/replay/processing-jobs/${encodeURIComponent(jobId)}`, { method: 'DELETE' }))
}

export async function getProcessingJobResult(jobId: string): Promise<ReplayResult> {
  const response = await requireOk(await apiFetch(`/api/replay/processing-jobs/${encodeURIComponent(jobId)}/result`))
  return readJson(response, isReplayResult, 'Processing job result')
}

/** Create a Dataset-only export job. Replay files are never uploaded on this path. */
export async function createExportJob(
  mode: ExportMode,
  processingJobId: string,
  teamNamesJson: string | null = null,
): Promise<ExportJobCreateResponse> {
  const query = new URLSearchParams({ mode, processingJobId })
  let body: FormData | undefined
  if (teamNamesJson) {
    body = new FormData()
    body.append('teamNames', teamNamesJson)
  }
  const response = await requireOk(await apiFetch(`/api/replay/export-jobs?${query.toString()}`, {
    method: 'POST',
    body,
  }))
  return readJson(response, isExportJobCreateResponse, 'Export job creation')
}

export async function getExportJob(jobId: string): Promise<ExportJob> {
  const response = await requireOk(await apiFetch(`/api/replay/export-jobs/${encodeURIComponent(jobId)}`))
  return readJson(response, isExportJob, 'Export job status')
}

export async function cancelExportJob(jobId: string): Promise<void> {
  await requireOk(await apiFetch(`/api/replay/export-jobs/${encodeURIComponent(jobId)}`, { method: 'DELETE' }))
}

export async function downloadExportJob(jobId: string, fallbackName: string): Promise<void> {
  const response = await requireOk(await apiFetch(`/api/replay/export-jobs/${encodeURIComponent(jobId)}/download`))
  await downloadResponse(response, fallbackName)
}

function filenameFromDisposition(disposition: string): string {
  const star = /filename\*=UTF-8''([^;]+)/i.exec(disposition)
  if (star) {
    try {
      return decodeURIComponent(star[1])
    } catch {
      // Fall through to the plain filename.
    }
  }
  const plain = /filename="?([^";]+)"?/i.exec(disposition)
  return plain ? plain[1] : ''
}
