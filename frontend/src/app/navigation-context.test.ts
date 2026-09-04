import { readdirSync, readFileSync, statSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

function productionSources(root: string): string[] {
  const out: string[] = []
  for (const name of readdirSync(root)) {
    const path = resolve(root, name)
    if (statSync(path).isDirectory()) {
      out.push(...productionSources(path))
      continue
    }
    if (!/\.(?:vue|[jt]s)$/.test(name) || /\.test\.[jt]s$/.test(name)) continue
    out.push(path)
  }
  return out
}

const REMOVED_STRING_CONTEXTS = [
  'navigate',
  'isAuthenticated',
  'login',
  'authInit',
  'replay',
  'replayWorkspace',
] as const

describe('application context boundaries', () => {
  it('does not restore removed magic-string service locators in production sources', () => {
    const src = resolve(process.cwd(), 'src')
    const offenders = productionSources(src).flatMap((path) => {
      const text = readFileSync(path, 'utf8')
      return REMOVED_STRING_CONTEXTS
        .filter((key) => new RegExp(`(?:inject|provide)\\(\\s*['\"]${key}['\"]`).test(text))
        .map((key) => `${path}:${key}`)
    })
    expect(offenders).toEqual([])
  })
})
