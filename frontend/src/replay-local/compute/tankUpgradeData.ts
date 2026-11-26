export type Data = Record<string, unknown>
export function record(value: unknown): value is Data {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}
export function finite(value: unknown): value is number { return typeof value === 'number' && Number.isFinite(value) }
export function records(value: unknown): Data[] { return Array.isArray(value) ? value.filter(record) : [] }
export function child(value: unknown, key: string): Data | undefined {
  return record(value) && record(value[key]) ? value[key] : undefined
}
export function cloneData<T>(value: T): T {
  if (Array.isArray(value)) return value.map(item => cloneData(item)) as T
  if (record(value)) return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, cloneData(item)])) as T
  return value
}
