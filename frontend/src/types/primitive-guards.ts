import type { JsonObject } from './api.js'

// 这里不依赖 contract validators：首屏 chunk 的 auth / Native Bridge 模块只需要这些判断，
// guards.ts 带着约 1MB 的 Ajv 产物，不能进入首屏。

export function isRecord(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function isString(value: unknown): value is string {
  return typeof value === 'string'
}

export function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

/** 非负安全整数：契约里的字节数、时间戳等 integer 字段。 */
export function isSafeCount(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
}
