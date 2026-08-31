import type { ComputedRef, Ref } from 'vue'
import type { Battle, ProcessingJobId, ReplayResult, SourceId } from './replay.js'
import type { ExportJob, ProcessingJob, UploadProgress } from './jobs.js'

export type ReplayCapability = 'data' | 'ai' | 'playback'
export type DataViewMode = 'SUMMARY' | 'SINGLE'

/** Public state contract exposed by the Replay Workspace/session owner. */
export interface ReplayWorkspaceState {
  files: Ref<File[]>
  resp: Ref<ReplayResult | null>
  processingJob: Ref<ProcessingJob | null>
  exportJob: Ref<ExportJob | null>
  uploadState: Ref<UploadProgress | null>
  processingJobId: Ref<ProcessingJobId | null>
  currentBattleId: Ref<SourceId | null>
  parsedBattles: ComputedRef<Battle[]>
  dataViewMode: Ref<DataViewMode>
  activeWorkspaceTab: Ref<ReplayCapability>
}
