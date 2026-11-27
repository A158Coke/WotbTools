import { activeEntityAt } from '../../replay-local/canonical/facts'
import { replacedBySuccessorAt } from './lastKnown'

export interface CanonicalIdentityEvidence {
  entityStartsByAccount?: Map<number, Map<number, number | null>> | null
  clock?: { startRaw?: number | null } | null
}

export interface IdentityVehicle {
  eid: number
  account_id?: number | null
  coverage?: number[] | null
}

export interface IdentityReplacementSource {
  canonical: () => CanonicalIdentityEvidence | null | undefined
  vehicles: () => readonly IdentityVehicle[]
  spansOf: (eid: number) => readonly number[] | null | undefined
}

export function makeReplacedAt(
  source: IdentityReplacementSource,
): (eid: number, t: number) => boolean {
  return (eid: number, t: number): boolean => {
    if (!Number.isFinite(t)) return false
    const all = source.vehicles()
    const self = all.find((candidate) => candidate.eid === eid)
    if (!self) return false
    const canonical = source.canonical()
    const startRaw = canonical?.clock?.startRaw
    const starts = self.account_id == null
      ? null
      : canonical?.entityStartsByAccount?.get(self.account_id)
    if (starts && starts.size > 1 && Number.isFinite(startRaw)) {
      const active = activeEntityAt(starts, t - (startRaw as number))
      if (active != null) return active !== eid
    }
    const spansOf = (id: number) => source.spansOf(id)
      ?? all.find((candidate) => candidate.eid === id)?.coverage
    return replacedBySuccessorAt(all, spansOf, eid, t)
  }
}
