import type { components } from '../../api/generated/http-contract.js'

type Request = components['schemas']['BattleDataRequest']
export type CollectorSeed = Omit<Request, 'teams'> & {
  authorTeam: 1 | 2
  teams: Array<Pick<components['schemas']['BattleDataTeam'], 'team' | 'vehicles'>>
}

export interface CollectorTask { id: number; blob: Blob; seed: CollectorSeed }
export interface CollectorDone { id: number }
