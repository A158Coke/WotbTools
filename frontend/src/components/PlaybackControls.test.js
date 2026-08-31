// @vitest-environment happy-dom

import { defineComponent, h } from 'vue'
import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import PlaybackControls from './PlaybackControls.vue'

const timelineStub = defineComponent({
  emits: ['drag-start', 'seek', 'jump'],
  setup(_, { emit }) {
    return () => h('div', { 'data-test': 'timeline-stub' }, [
      h('button', { 'data-test': 'timeline-seek', onClick: () => emit('seek', 17) }),
      h('button', { 'data-test': 'timeline-jump', onClick: () => emit('jump', 12) }),
      h('button', { 'data-test': 'timeline-drag', onClick: () => emit('drag-start') }),
    ])
  },
})

const props = () => ({
  playing: false,
  speed: 1,
  currentTime: 12,
  duration: 60,
  recorderAccountId: 1,
  showAll: false,
  labelPrefs: { showPlayerName: false, showTankName: true },
  hpPrefs: { showHp: true },
  fullscreenSupported: true,
  isFullscreen: false,
  typeFilter: new Set(['DAMAGE']),
  activeTool: null,
  annotColors: ['#f00', '#0f0'],
  annotColor: '#f00',
  annotVisible: true,
  annotWidthSlider: 2,
  annotWidthMin: 1,
  annotWidthMax: 10,
  historyIndex: 1,
  history: [{}],
  canUndo: () => true,
  canRedo: () => false,
  eventMarkers: [{ sec: 12, count: 1 }],
  formatClock: sec => `00:${sec}`,
})

function mountControls(overrides = {}) {
  return mount(PlaybackControls, {
    props: { ...props(), ...overrides },
    global: { stubs: { PlaybackTimeline: timelineStub }, mocks: { $t: key => key } },
  })
}

describe('PlaybackControls', () => {
  it('emits playback controls, stepping, speed, and fullscreen actions', async () => {
    const wrapper = mountControls()

    await wrapper.find('[data-test="pb-play"]').trigger('click')
    await wrapper.find('[data-test="pb-back5"]').trigger('click')
    await wrapper.find('[data-test="pb-fwd5"]').trigger('click')
    await wrapper.find('[data-test="pb-speed"]').trigger('click')
    await wrapper.find('[data-test="pb-fullscreen"]').trigger('click')

    expect(wrapper.emitted('toggle-play')).toHaveLength(1)
    expect(wrapper.emitted('step')).toEqual([[-5], [5]])
    expect(wrapper.emitted('toggle-speed')).toHaveLength(1)
    expect(wrapper.emitted('toggle-fullscreen')).toHaveLength(1)
  })

  it('emits filters, label/HP preferences, annotations, and timeline events', async () => {
    const wrapper = mountControls()

    await wrapper.find('[data-test="pb-all-events"]').setValue(true)
    await wrapper.find('[data-test="pb-show-player"]').setValue(true)
    await wrapper.find('[data-test="pb-show-hp"]').setValue(false)
    await wrapper.findAll('.pb-chip')[1].trigger('click')
    await wrapper.find('[data-test="pb-annot-arrow"]').trigger('click')
    await wrapper.findAll('.pb-annot-color')[1].trigger('click')
    await wrapper.find('.pb-annot-width input').setValue('5')
    await wrapper.find('[data-test="pb-annot-undo"]').trigger('click')
    await wrapper.find('[data-test="pb-annot-clear"]').trigger('click')
    await wrapper.find('[data-test="pb-annot-toggle"]').trigger('click')
    await wrapper.find('[data-test="timeline-drag"]').trigger('click')
    await wrapper.find('[data-test="timeline-seek"]').trigger('click')
    await wrapper.find('[data-test="timeline-jump"]').trigger('click')

    expect(wrapper.emitted('update:show-all')).toEqual([[true]])
    expect(wrapper.emitted('update-label-pref')).toEqual([['showPlayerName', true]])
    expect(wrapper.emitted('update-hp-pref')).toEqual([['showHp', false]])
    expect(wrapper.emitted('toggle-type')).toEqual([['DESTROYED']])
    expect(wrapper.emitted('toggle-tool')).toEqual([['arrow']])
    expect(wrapper.emitted('set-annot-color')).toEqual([['#0f0']])
    expect(wrapper.emitted('update:annot-width')).toEqual([[5]])
    expect(wrapper.emitted('undo')).toHaveLength(1)
    expect(wrapper.emitted('clear-annotations')).toHaveLength(1)
    expect(wrapper.emitted('toggle-annotations')).toHaveLength(1)
    expect(wrapper.emitted('drag-start')).toHaveLength(1)
    expect(wrapper.emitted('seek')).toEqual([[17]])
    expect(wrapper.emitted('jump')).toEqual([[12]])
  })
})
