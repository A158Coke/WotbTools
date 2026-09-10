import type {
  ExportJob,
  ExportJobCreateResponse,
  ProcessingJob,
  ProcessingJobCreateResponse,
  UploadProgressEvent,
} from '../types/jobs.js'
import type { ReplayResult } from '../types/replay.js'
import type { ReplayAuthSession } from './replay-capabilities.js'
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

/**
 * Processing Job 的认证边界（与 `replay-capabilities.ts` 同一 contract）：
 * 先确保 token 有效再返回 Bearer header；未登录抛 canonical AUTH_UNAUTHENTICATED，
 * 由统一 error infrastructure 处理，不新增特殊 auth code。
 */
async function authHeaders(auth: ReplayAuthSession): Promise<Record<string, string>> {
  const valid = await auth.ensureToken(30)
  if (!valid) throw new ApiError({ code: 'AUTH_UNAUTHENTICATED', status: 401, retryable: false })
  const accessToken = auth.token()
  return accessToken ? { Authorization: `Bearer ${accessToken}` } : {}
}

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

/** Create an asynchronous processing job from replay files. Requires an authenticated session. */
export async function createProcessingJob(
  auth: ReplayAuthSession,
  body: FormData,
  options: { onProgress?: (progress: UploadProgressEvent) => void; signal?: AbortSignal } = {},
): Promise<ProcessingJobCreateResponse> {
  const headers = await authHeaders(auth)
  const signal = options.signal
  // ensureToken 是异步的：等待期间可能已被取消，先给出 canonical abort，避免发出无谓请求。
  if (signal?.aborted) throw new ApiError({ code: 'REQUEST_ABORTED', status: null, retryable: false })
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest()
    xhr.open('POST', '/api/replay/processing-jobs')
    // 只设置 Authorization：multipart Content-Type 必须由浏览器负责（含 boundary）。
    for (const [name, value] of Object.entries(headers)) xhr.setRequestHeader(name, value)
    const abort = () => xhr.abort()
    signal?.addEventListener('abort', abort, { once: true })
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
      signal?.removeEventListener('abort', abort)
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
      signal?.removeEventListener('abort', abort)
      reject(new ApiError({ code: 'NETWORK_ERROR', status: null, retryable: true }))
    }
    xhr.onabort = () => {
      signal?.removeEventListener('abort', abort)
      reject(new ApiError({ code: 'REQUEST_ABORTED', status: null, retryable: false }))
    }
    xhr.send(body)
  })
}

export async function getProcessingJob(auth: ReplayAuthSession, jobId: string): Promise<ProcessingJob> {
  const headers = await authHeaders(auth)
  const response = await requireOk(await apiFetch(
    `/api/replay/processing-jobs/${encodeURIComponent(jobId)}`, { headers }))
  return readJson(response, isProcessingJob, 'Processing job status')
}

export async function cancelProcessingJob(auth: ReplayAuthSession, jobId: string): Promise<void> {
  const headers = await authHeaders(auth)
  await requireOk(await apiFetch(
    `/api/replay/processing-jobs/${encodeURIComponent(jobId)}`, { method: 'DELETE', headers }))
}

export async function getProcessingJobResult(auth: ReplayAuthSession, jobId: string): Promise<ReplayResult> {
  const headers = await authHeaders(auth)
  const response = await requireOk(await apiFetch(
    `/api/replay/processing-jobs/${encodeURIComponent(jobId)}/result`, { headers }))
  return readJson(response, isReplayResult, 'Processing job result')
}

/** Create a Dataset-only export job. Replay files are never uploaded on this path. */
export async function createExportJob(
  auth: ReplayAuthSession,
  mode: ExportMode,
  processingJobId: string,
  teamNamesJson: string | null = null,
): Promise<ExportJobCreateResponse> {
  const headers = await authHeaders(auth)
  const query = new URLSearchParams({ mode, processingJobId })
  let body: FormData | undefined
  if (teamNamesJson) {
    body = new FormData()
    body.append('teamNames', teamNamesJson)
  }
  const response = await requireOk(await apiFetch(`/api/replay/export-jobs?${query.toString()}`, {
    method: 'POST',
    headers,
    body,
  }))
  return readJson(response, isExportJobCreateResponse, 'Export job creation')
}

export async function getExportJob(auth: ReplayAuthSession, jobId: string): Promise<ExportJob> {
  const headers = await authHeaders(auth)
  const response = await requireOk(await apiFetch(
    `/api/replay/export-jobs/${encodeURIComponent(jobId)}`, { headers }))
  return readJson(response, isExportJob, 'Export job status')
}

export async function cancelExportJob(auth: ReplayAuthSession, jobId: string): Promise<void> {
  const headers = await authHeaders(auth)
  await requireOk(await apiFetch(
    `/api/replay/export-jobs/${encodeURIComponent(jobId)}`, { method: 'DELETE', headers }))
}

/**
 * Export artifact 下载：必须走 authenticated fetch（不能是 `<a href>` 裸链，否则不会附带 Bearer），
 * 读取 blob 后再触发下载。
 */
export async function downloadExportJob(auth: ReplayAuthSession, jobId: string, fallbackName: string): Promise<void> {
  const headers = await authHeaders(auth)
  const response = await requireOk(await apiFetch(
    `/api/replay/export-jobs/${encodeURIComponent(jobId)}/download`, { headers }))
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
