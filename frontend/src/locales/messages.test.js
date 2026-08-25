import { describe, expect, it } from 'vitest'
import zhBase from './zh.json'
import { messages, mergeLocaleMessages } from './messages.js'

describe('locale message composition', () => {
  it('preserves existing nested processing-job translations while adding new copy', () => {
    expect(messages.zh.replay.processing_job.mixed_league_standard).toBe(
      zhBase.replay.processing_job.mixed_league_standard
    )
    expect(messages.zh.replay.processing_job.ready).toBe('回放解析完成')
    expect(messages.en.replay.processing_job.ready).toBe('Replay parsing complete')
    expect(messages.ru.replay.processing_job.ready).toBe('Обработка реплеев завершена')
  })

  it('contains direct Replay Workspace selector copy in all supported locales', () => {
    for (const locale of ['zh', 'en', 'ru']) {
      expect(messages[locale].upload.action_replay_selector).toBeTruthy()
      expect(messages[locale].upload.action_replay_placeholder).toBeTruthy()
    }
  })

  it('keeps historical submitted Boost notifications translatable', () => {
    for (const locale of ['zh', 'en', 'ru']) {
      expect(messages[locale].boost.notificationTitle.BOOST_REQUEST_SUBMITTED).toBeTruthy()
      expect(messages[locale].boost.notificationMessage.BOOST_REQUEST_SUBMITTED).toBeTruthy()
    }
  })

  it('does not mutate the base locale object during nested merge', () => {
    const base = { replay: { processing_job: { existing: 'keep' } } }
    const merged = mergeLocaleMessages(base, { replay: { processing_job: { added: 'new' } } })
    expect(merged.replay.processing_job).toEqual({ existing: 'keep', added: 'new' })
    expect(base.replay.processing_job).toEqual({ existing: 'keep' })
  })
})
