import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const src = readFileSync(fileURLToPath(new URL('./viewer/shotReplay.ts', import.meta.url)), 'utf8')
    + readFileSync(fileURLToPath(new URL('./viewer/judgment.ts', import.meta.url)), 'utf8')
    + readFileSync(fileURLToPath(new URL('./viewer/segmentJudgment.ts', import.meta.url)), 'utf8')
    + readFileSync(fileURLToPath(new URL('./viewer/trajectoryCard.ts', import.meta.url)), 'utf8')
    + readFileSync(fileURLToPath(new URL('./tankViewer.js', import.meta.url)), 'utf8')

describe('shot segment collision box source（Integration Contract，窄化守卫）', () => {
  it('缺盒 fail-closed：不解码、置旗标、阻断世界判定；无网格盒回退', () => {
    expect(src).toContain('getTankData().collision_boxes')
    expect(src).toContain('缺少客户端部件盒')
    expect(src).toContain('window.__segBoxMissing = true')
    expect(src.replaceAll('window.__segBoxMissing = true', '')).not.toContain('window.__segBoxMissing = true')
    expect(src).toContain('window.__worldPenMode === true && window.__segBoxMissing === true')
    expect(src).not.toContain("'mesh-tight'")
    expect(src).not.toContain('网格盒回退')
  })

  it('结果卡不可概率重开：宿主把 blockedNoPrimary 传进 allowChance 链（行为见 shotResultCard.test.ts）', () => {
    expect(src).toContain('allowChance = allowChance && !blockedNoPrimary')
    const result = readFileSync(fileURLToPath(new URL('./viewer/judgmentResult.ts', import.meta.url)), 'utf8')
    expect(result).toContain('!isHE && !blockedNoPrimary')
    expect(result.replaceAll('!isHE && !blockedNoPrimary', '')).not.toContain('!isHE && !blockedNoPrimary')
  })
})
