import { describe, expect, it } from 'vitest'
import { shotResultBadge } from './shotPresentation.js'
const t = (key) => key

describe('shotResultBadge recorded facts', () => {
  it.each([undefined, 0, 255])('a recorded target with unknown result %s remains unknown', (game_hit_result) => {
    expect(shotResultBadge({ target_eid: 7, game_hit_result }, t)).toEqual({ text: 'agentShots.res_hit_unknown', tone: 'warning' })
  })
  it('uses hit flags before the fallback result and distinguishes a missing target', () => {
    expect(shotResultBadge({ target_eid: 7, hit_flags: 16, game_hit_result: 1 }, t).text).toBe('agentShots.res_pen')
    expect(shotResultBadge({ target_eid: null, game_hit_result: 255 }, t).text).toBe('agentShots.res_miss')
    expect(shotResultBadge({ target_eid: 7, hit_flags: 8 }, t).text).toBe('agentShots.res_ric')
    expect(shotResultBadge({ target_eid: 7, hit_flags: 4096 }, t)).toEqual({ text: 'HE', tone: 'warning' })
  })
})
