import type { JsonObject } from './api.js'

// 这里不依赖 contract validators：首屏 chunk 的 auth / Native Bridge 模块只需要这些判断，
// guards.ts 带着约 1MB 的 Ajv 产物，不能进入首屏。

export function isRecord(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function isString(value: unknown): value is string {
  return typeof value === 'string'
}
