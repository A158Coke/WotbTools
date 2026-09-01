import Ajv2020 from 'ajv/dist/2020.js'
import addFormats from 'ajv-formats'
import type { components } from './generated/http-contract.js'
import schema from './generated/playback-v2.schema.js'

type BattlePlaybackDataset = components['schemas']['BattlePlaybackDataset']

export interface ContractDiagnostic {
  endpoint: string
  schema: string
  path: string
  expected: string
  receivedType: string
}

const ajv = new Ajv2020({ allErrors: true, strict: false })
addFormats(ajv)
const validator = ajv.compile(schema)

function receivedType(value: unknown): string {
  if (value === null) return 'null'
  if (Array.isArray(value)) return 'array'
  return typeof value
}

export function validateBattlePlaybackDataset(value: unknown): {
  data: BattlePlaybackDataset | null
  diagnostics: ContractDiagnostic[]
} {
  if (validator(value)) return { data: value as BattlePlaybackDataset, diagnostics: [] }
  const diagnostics = (validator.errors || []).map(error => ({
    endpoint: '/api/replay/battle-playback-v2',
    schema: 'BattlePlaybackDataset',
    path: error.instancePath || '$',
    expected: error.message || 'schema match',
    receivedType: receivedType(error.data),
  }))
  return { data: null, diagnostics }
}
