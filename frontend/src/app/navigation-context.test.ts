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

describe('application navigation context', () => {
  it('does not use magic-string navigation injection in production sources', () => {
    const src = resolve(process.cwd(), 'src')
    const offenders = productionSources(src).filter((path) => {
      const text = readFileSync(path, 'utf8')
      return /(?:inject|provide)\(\s*['"]navigate['"]/.test(text)
    })
    expect(offenders).toEqual([])
  })
})
