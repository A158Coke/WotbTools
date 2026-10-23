// 射击复现的 hash6 解码盒只取客户端权威数据（game_data collision.*_bbox）。
// 盒缺失必须 fail-closed：不解码段线/不判定，禁止按装甲网格 rest 顶点自算 AABB——
// 网格 AABB 与客户端部件盒不是同一份数据（全量 738 辆中只有 287 辆 hull 两者完全相等）。
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const src = readFileSync(fileURLToPath(new URL('./tankViewer.js', import.meta.url)), 'utf8')

describe('shot segment collision box source', () => {
  it('uses the client collision_boxes and a fail-closed missing-box branch', () => {
    expect(src).toContain('tankData.collision_boxes')
    expect(src).toContain('缺少客户端部件盒')
    expect(src).toContain('射击复现已阻断')
  })

  it('blocks world judgment when the client box is missing, including rejudge paths', () => {
    expect(src).toContain('window.__segBoxMissing = true')
    expect(src).toContain('window.__worldPenMode === true && window.__segBoxMissing === true')
  })

  it('does not let the result card reopen a require_primary block via probability', () => {
    expect(src).toContain('blockedNoPrimary')
    expect(src).toContain('allowChance = allowChance && !blockedNoPrimary')
    expect(src).toContain('!isHE && !blockedNoPrimary')
  })

  it('never synthesizes a mesh-tight AABB fallback', () => {
    expect(src).not.toContain("'mesh-tight'")
    expect(src).not.toContain('网格盒回退')
  })

  it('uses the client 1/255 quantization denominator, not 1/256', () => {
    // 客户端 BWUtils::DecodeShotSegment 的常量是 255.0f（@0x364B110）：
    // b=0 → min、b=255 → max；/256 会让 max 面永远差一个量化步长。
    expect(src).toContain('* (b / 255)')
    expect(src).not.toContain('/ 256')
  })
})
