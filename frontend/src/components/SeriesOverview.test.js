// @vitest-environment happy-dom

import { describe, expect, it, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import SeriesOverview from './SeriesOverview.vue'
import { buildSeriesOverview } from '../utils/replaySeries.js'

vi.mock('vue-i18n', () => ({
  useI18n: () => ({ t: (key, values) => (values ? `${key}:${Object.values(values).join(',')}` : key), locale: { value: 'en' } }),
}))

function cwResp() {
  const battles = [1, 2, 1].map((winnerTeam, i) => ({ sourceId: `r${i}`, arenaId: `a${i}`, mapName: null, durationS: 300, winnerTeam, players: [] }))
  return {
    leagueMode: true,
    battles,
    league: {
      teamSummaries: [
        { teamKey: 'clan:CHRD', autoName: 'CHRD', arenaTeams: ['a0:1', 'a1:1', 'a2:1'] },
        { teamKey: 'clan:TOP', autoName: 'TOP', arenaTeams: ['a0:2', 'a1:2', 'a2:2'] },
      ],
    },
  }
}

describe('SeriesOverview', () => {
  it('两支战队时显示比分（领先方在前），逐场条标明胜方', () => {
    const wrapper = mount(SeriesOverview, { props: { series: buildSeriesOverview(cwResp()) } })
    expect(wrapper.get('[data-testid="series-score"]').text().replace(/\s+/g, '')).toBe('CHRD2:1TOP')
    const battles = wrapper.findAll('[data-testid="series-battle"]')
    expect(battles).toHaveLength(3)
    expect(battles[1].text()).toContain('workspace.series_winner:TOP')
    expect(battles[0].classes()).toContain('is-lead')
    expect(battles[1].classes()).toContain('is-trail')
  })

  it('普通批次没有比分；点击逐场条发出 sourceId', async () => {
    const series = buildSeriesOverview({ leagueMode: false, battles: [{ sourceId: 'r0', winnerTeam: 2 }, { sourceId: 'r1', winnerTeam: null }] })
    const wrapper = mount(SeriesOverview, { props: { series } })
    expect(wrapper.find('[data-testid="series-score"]').exists()).toBe(false)
    const battles = wrapper.findAll('[data-testid="series-battle"]')
    expect(battles[0].text()).toContain('workspace.series_team_winner:2')
    expect(battles[1].text()).toContain('workspace.series_unknown_winner')
    await battles[1].trigger('click')
    expect(wrapper.emitted('select-battle')).toEqual([['r1']])
  })
})
