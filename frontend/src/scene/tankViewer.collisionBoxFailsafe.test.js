// 射击复现的 hash6 解码盒只取客户端权威数据（game_data collision.*_bbox）。
// 盒缺失必须 fail-closed：不解码段线/不判定，禁止按装甲网格 rest 顶点自算 AABB——
// 网格 AABB 与客户端部件盒不是同一份数据（全量 738 辆中只有 287 辆 hull 两者完全相等）。
//
// #827 Wave 2 改写说明：
// - 1/255 量化分母已行为化 → viewer/shotReplay.quantization.test.ts（decodeB255 等价抽取）。
// - 结果卡不可概率重开（blockedNoPrimary）的行为已在 viewer/shotResultCard.test.ts
//   「无主装甲（blockedNoPrimary）」组锁定；此处保留其宿主接线子句。
// - 缺盒 fail-closed 分支运行在 runShotReplay 闭包 + window 全局旗标（__segBoxMissing /
//   __worldPenMode）之上，宿主无注入点（F3：Integration Contract）——保留窄化的源码子句，
//   只断言 fail-closed 关键行存在，不再整段文本匹配。
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const src = readFileSync(fileURLToPath(new URL('./viewer/shotReplay.ts', import.meta.url)), 'utf8')
    + readFileSync(fileURLToPath(new URL('./viewer/judgment.ts', import.meta.url)), 'utf8')
    + readFileSync(fileURLToPath(new URL('./viewer/trajectoryCard.ts', import.meta.url)), 'utf8')
    + readFileSync(fileURLToPath(new URL('./tankViewer.js', import.meta.url)), 'utf8')

describe('shot segment collision box source（Integration Contract，窄化守卫）', () => {
  it('缺盒 fail-closed：不解码、置旗标、阻断世界判定；无网格盒回退', () => {
    expect(src).toContain('getTankData().collision_boxes')
    expect(src).toContain('缺少客户端部件盒')
    expect(src).toContain('window.__segBoxMissing = true')
    expect(src).toContain('window.__worldPenMode === true && window.__segBoxMissing === true')
    // 禁止网格 AABB 回退（负面守卫）
    expect(src).not.toContain("'mesh-tight'")
    expect(src).not.toContain('网格盒回退')
  })

  it('结果卡不可概率重开：宿主把 blockedNoPrimary 传进 allowChance 链（行为见 shotResultCard.test.ts）', () => {
    expect(src).toContain('allowChance = allowChance && !blockedNoPrimary')
    expect(src).toContain('!isHE && !blockedNoPrimary')
  })
})
