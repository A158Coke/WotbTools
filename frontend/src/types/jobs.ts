/** Shared replay processing/export job contracts. */

import type { ExportJobId, ProcessingJobId, SourceId } from './replay.js'

export type ProcessingJobStatus = 'QUEUED' | 'PROCESSING' | 'READY' | 'FAILED' | 'CANCELLED'
export type ExportJobStatus = ProcessingJobStatus

export type ProcessingPhase =
  | 'WAITING_FOR_WORKER'
  | 'PROCESSING_REPLAYS'
  | 'FINALIZING_BATCH'
  | (string & {})

export type ExportPhase =
  | 'PROCESSING_REPLAYS'
  | 'BUILDING_EXCEL'
  | 'BUILDING_ARCHIVE'
  | (string & {})

export type SourceStatus = 'PENDING' | 'PROCESSING' | 'READY' | 'FAILED'

export interface ProcessingSource {
  sourceId: SourceId
  sourceIndex: number
  displayName: string
  status: SourceStatus
  /** Backend failureMessage is exposed under the DTO's errorCode key. */
  errorCode: string | null
}

export interface ActiveSource {
  sourceId: SourceId
  sourceIndex: number
  displayName: string
}

export interface ProcessingJob {
  jobId: ProcessingJobId
  status: ProcessingJobStatus
  phase: ProcessingPhase | null
  total: number
  processed: number
  valid: number
  duplicates: number
  failures: number
  errorCode: string | null
  currentFile: string | null
  parseCompleted: number
  parseSucceeded: number
  parseFailed: number
  sources: ProcessingSource[]
  activeSources: ActiveSource[]
}

export interface ExportJob {
  jobId: ExportJobId
  status: ExportJobStatus
  phase: ExportPhase | null
  total: number
  processed: number
  duplicates: number
  failures: number
  errorCode: string | null
  filename: string | null
  contentType: string | null
}

export interface ProcessingJobCreateResponse {
  jobId: ProcessingJobId
  status: ProcessingJobStatus
  total: number
}

export interface ExportJobCreateResponse {
  jobId: ExportJobId
  status: ExportJobStatus
  total: number
}

export type UploadPhase = 'UPLOADING' | 'REGISTERING'

export interface UploadProgress {
  phase: UploadPhase
  loaded: number
  total: number
  percent: number
}

export interface UploadProgressEvent {
  loaded: number
  total: number
  percent: number
}
