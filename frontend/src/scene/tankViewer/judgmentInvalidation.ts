import { disposeHitMarker } from '../viewer/overlayStroke.js'
import type { Host } from '../tankViewer.js'

export function invalidateJudgment(S: Host) {
  S.jc.bumpPenSeq()
  S.tc.tidyTrajectory()
  disposeHitMarker(S.fxScene)
  S.jc.clearLastClickNdc()
  S.onJudgmentDistance?.(null)
}