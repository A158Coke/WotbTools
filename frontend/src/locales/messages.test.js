import { describe, expect, it } from 'vitest'
import zhBase from './zh.json'
import { messages, mergeLocaleMessages } from './messages.js'

describe('locale message composition', () => {
  it('merges nested feature namespaces without dropping base translations', () => {
    // league 同时存在于 base 与 feature-messages：base 独有键保留，feature 键追加
    expect(messages.zh.league.title).toBe(zhBase.league.title)
    for (const locale of ['zh', 'en', 'ru']) {
      expect(messages[locale].league.title).toBeTruthy()
      expect(messages[locale].league.rated_count).toBeTruthy()
    }
  })

  it('contains local replay analysis / export / verification copy in all supported locales', () => {
    for (const locale of ['zh', 'en', 'ru']) {
      const m = messages[locale]
      for (const key of ['parsing', 'progress', 'ready', 'summary', 'failed', 'cancelled', 'cancel', 'dismiss',
        'engine_unavailable', 'no_valid_replays', 'failed_unknown']) {
        expect(m.replay.analysis[key], `${locale} replay.analysis.${key}`).toBeTruthy()
      }
      expect(m.replay.excel_exporting).toBeTruthy()
      expect(m.replay.excel_export_failed).toBeTruthy()
      expect(m.recon.playback.engine_unavailable).toBeTruthy()
      expect(m.recon.playback.parse_failed).toBeTruthy()
      expect(m.profile.verifyWithReplay).toBeTruthy()
      expect(m.profile.verifyingReplay).toBeTruthy()
      for (const code of ['INVALID_REPLAY_FACTS', 'REPLAY_FACTS_COUNT_MISMATCH', 'REPLAY_RECORDER_MISMATCH',
        'REPLAY_RECORDER_REQUIRED', 'WOTB_ACCOUNT_NOT_BOUND']) {
        expect(m.api_errors[code], `${locale} api_errors.${code}`).toBeTruthy()
      }
    }
  })

  it('no longer ships server export-job copy', () => {
    for (const locale of ['zh', 'en', 'ru']) {
      expect(messages[locale].replay.export_job).toBeUndefined()
      expect(messages[locale].workspace.dataset_prepare_failed).toBeUndefined()
    }
  })

  it('contains direct Replay Workspace selector copy in all supported locales', () => {
    for (const locale of ['zh', 'en', 'ru']) {
      expect(messages[locale].upload.action_replay_selector).toBeTruthy()
      expect(messages[locale].upload.action_replay_placeholder).toBeTruthy()
    }
  })

  it('contains both development backend notices in all supported locales', () => {
    for (const locale of ['zh', 'en', 'ru']) {
      expect(messages[locale].environment.local).toBeTruthy()
      expect(messages[locale].environment.productionRemote).toBeTruthy()
    }
  })

  it('does not mutate the base locale object during nested merge', () => {
    const base = { replay: { processing_job: { existing: 'keep' } } }
    const merged = mergeLocaleMessages(base, { replay: { processing_job: { added: 'new' } } })
    expect(merged.replay.processing_job).toEqual({ existing: 'keep', added: 'new' })
    expect(base.replay.processing_job).toEqual({ existing: 'keep' })
  })

  it('ships offline-requirement copy for every capability-gated feature in all locales', () => {
    // capability 模型给 ONLINE_REQUIRED 功能发 `featureOffline.<feature>`、给 ONLINE_OPTIONAL 发
    // `featureOffline.syncPaused`：这里把「模型里的每个 key 都有译文」变成 CI 断言，
    // 新增联网功能却忘了文案会直接失败，而不是在界面上显示原始 key。
    for (const locale of ['zh', 'en', 'ru']) {
      const offline = messages[locale].featureOffline
      expect(offline, `${locale} featureOffline`).toBeTruthy()
      for (const key of ['title', 'retry', 'aiReview', 'hallOfFame', 'playback3d', 'accountProfile', 'syncPaused']) {
        expect(offline[key], `${locale} featureOffline.${key}`).toBeTruthy()
      }
    }
  })
})
