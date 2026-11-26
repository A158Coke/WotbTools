import type { components } from './generated/http-contract.js'
import type { ValidateFunction } from 'ajv'
import { validator as playbackValidator, apiErrorValidator as errorValidator } from './generated/contract-validators.js'

type BattlePlaybackDataset = components['schemas']['BattlePlaybackDataset']
type ApiErrorWirePayload = components['schemas']['ApiError']

const validator = playbackValidator as ValidateFunction<BattlePlaybackDataset>
const apiErrorValidator = errorValidator as ValidateFunction<ApiErrorWirePayload>

export interface ContractDiagnostic {
  endpoint: string
  schema: string
  path: string
  expected: string
  receivedType: string
}


function receivedType(value: unknown): string {
  if (value === null) return 'null'
  if (Array.isArray(value)) return 'array'
  return typeof value
}

export function validateBattlePlaybackDataset(value: unknown): {
  data: BattlePlaybackDataset | null
  diagnostics: ContractDiagnostic[]
} {
  if (validator(value)) {
    const data = value as BattlePlaybackDataset
    if (!Array.isArray(data.baseStates)) {
      return { data: { ...data, baseStates: [] }, diagnostics: [] }
    }
    return { data, diagnostics: [] }
  }
  const diagnostics = (validator.errors || []).map(error => ({
    endpoint: 'local replay dataset (client-side projection)',
    schema: 'BattlePlaybackDataset',
    path: error.instancePath || '$',
    expected: error.message || 'schema match',
    receivedType: receivedType(error.data),
  }))
  return { data: null, diagnostics }
}

export function validateApiError(value: unknown): {
  data: ApiErrorWirePayload | null
  diagnostics: ContractDiagnostic[]
} {
  if (apiErrorValidator(value)) return { data: value as ApiErrorWirePayload, diagnostics: [] }
  const diagnostics = (apiErrorValidator.errors || []).map(error => ({
    endpoint: 'HTTP error response',
    schema: 'ApiError',
    path: error.instancePath || '$',
    expected: error.message || 'schema match',
    receivedType: receivedType(error.data),
  }))
  return { data: null, diagnostics }
}
