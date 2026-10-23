/** Shared presentation of recorded shot facts; this never recomputes a hit or damage. */
import { shotResultClass } from './shotResultClass.js'

export function shotResultBadge(s, t) {
  switch (shotResultClass(s)) {
    case 'MISS': return { text: t('agentShots.res_miss'), tone: 'neutral' }
    case 'PENETRATION': return { text: t('agentShots.res_pen'), tone: 'success' }
    case 'UNVERIFIED': return { text: t('agentShots.res_result_unverified'), tone: 'warning' }
    case 'HIT': return { text: t('agentShots.res_hit_unknown'), tone: 'warning' }
    case 'RICOCHET': return { text: t('agentShots.res_ric'), tone: 'warning' }
    case 'HE BLAST': return { text: 'HE', tone: 'warning' }
    default: return { text: t('agentShots.res_nopen'), tone: 'danger' }
  }
}
