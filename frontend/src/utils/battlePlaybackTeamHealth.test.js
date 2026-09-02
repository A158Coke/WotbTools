import { describe, expect, it } from 'vitest'
import { friendlyHealthAt } from './battlePlaybackV2'

const hp = (timeSec, currentHp, knowledge, displayCapacityHp, source = 'EXACT_BATTLE_EVENT') => ({
  timeSec,
  currentHp,
  knowledge,
  source,
  displayCapacityHp,
  relativeFull: false,
  confidence: 'HIGH',
})

describe('Battle Playback team HP presentation scale', () => {
  it('keeps the disclosed enemy scale when replay authority arrives without capacity', () => {
    const enemy = {
      friendly: false,
      healthTransitions: [
        hp(0, 3400, 'CURRENT', 3400, 'TANKOPEDIA_BASE_PROVISIONAL'),
        hp(10, 3200, 'CURRENT', null),
        hp(12, 3200, 'LAST_KNOWN', null),
        hp(20, 2800, 'CURRENT', 3560),
      ],
      lifeTransitions: [],
    }

    expect(friendlyHealthAt([enemy], false, 0)).toMatchObject({
      state: 'EXACT', knownRemaining: 3400, totalMax: 3400,
    })

    // First trusted replay HP switches authority but does not fabricate 3200/3200 and does not
    // erase the already-disclosed presentation scale. The bar therefore stays proportional.
    expect(friendlyHealthAt([enemy], false, 10)).toMatchObject({
      state: 'PARTIAL', knownRemaining: 3200, totalMax: 3400,
    })

    // Hidden/AoI last-known must not turn the team bar into a fake 100% partial bar.
    expect(friendlyHealthAt([enemy], false, 15)).toMatchObject({
      state: 'PARTIAL', knownRemaining: 3200, totalMax: 3400,
    })

    // A later replay-provided capacity replaces the provisional presentation scale.
    expect(friendlyHealthAt([enemy], false, 25)).toMatchObject({
      state: 'EXACT', knownRemaining: 2800, totalMax: 3560,
    })
  })

  it('keeps a stable team denominator when only one enemy switches to replay HP without capacity', () => {
    const first = {
      friendly: false,
      healthTransitions: [
        hp(0, 3400, 'CURRENT', 3400, 'TANKOPEDIA_BASE_PROVISIONAL'),
        hp(10, 3000, 'CURRENT', null),
      ],
      lifeTransitions: [],
    }
    const second = {
      friendly: false,
      healthTransitions: [
        hp(0, 2500, 'CURRENT', 2500, 'TANKOPEDIA_BASE_PROVISIONAL'),
      ],
      lifeTransitions: [],
    }

    expect(friendlyHealthAt([first, second], false, 10)).toMatchObject({
      state: 'PARTIAL',
      knownRemaining: 5500,
      totalMax: 5900,
    })
  })

  it('never invents a presentation capacity from currentHp when none has ever been disclosed', () => {
    const enemy = {
      friendly: false,
      healthTransitions: [hp(10, 3200, 'CURRENT', null)],
      lifeTransitions: [],
    }

    expect(friendlyHealthAt([enemy], false, 10)).toMatchObject({
      state: 'PARTIAL',
      knownRemaining: 3200,
      totalMax: 0,
    })
  })
})
