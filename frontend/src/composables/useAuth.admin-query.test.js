import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const source = readFileSync(new URL('./useAuth.js', import.meta.url), 'utf8')

describe('admin query authorization boundary', () => {
  it('keeps role authorization independent from URL query parameters', () => {
    expect(source).not.toContain('DEV_ADMIN_ROLES')
    expect(source).not.toMatch(/searchParams\.has\(['"]admin['"]\)/)
    expect(source).not.toMatch(/URLSearchParams\([^)]*\).*has\(['"]admin['"]\)/s)

    const hasRoleBody = source.match(/function hasRole\(role\) \{([\s\S]*?)\n\}/)?.[1]
    expect(hasRoleBody).toContain('tokenParsed.value?.realm_access?.roles')
    expect(hasRoleBody).not.toContain('window')
    expect(hasRoleBody).not.toContain('location')
    expect(hasRoleBody).not.toContain('URLSearchParams')
  })
})
