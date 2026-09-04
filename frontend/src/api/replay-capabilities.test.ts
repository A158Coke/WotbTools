import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const read = (path: string) => readFileSync(resolve(process.cwd(), path), 'utf8')

describe('Replay capability API ownership', () => {
  it.each([
    'src/components/AiReviewPanel.vue',
    'src/components/BattlePlaybackPanel.vue',
  ])('%s does not own backend transport details', (path) => {
    const source = read(path)
    expect(source).not.toMatch(/\bauthedFetch\b/)
    expect(source).not.toMatch(/\bapiFetch\s*\(/)
    expect(source).not.toMatch(/fetch\s*\(\s*['"]\/api\/replay\//)
  })

  it('keeps replay capability endpoints inside the API boundary', () => {
    const source = read('src/api/replay-capabilities.ts')
    expect(source).toContain("'/api/replay/map-overview'")
    expect(source).toContain("'/api/replay/battle-playback-v2'")
    expect(source).toContain("'/api/replay/analyze'")
    expect(source).toContain('validateBattlePlaybackDataset')
  })
})
