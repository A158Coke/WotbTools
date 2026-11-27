import { describe, expect, it } from 'vitest'
import { compile } from '@intlify/core-base'
import zhBase from './zh.json'
import { messages, mergeLocaleMessages } from './messages.js'
import { API_ERROR_CODES } from '../api/generated/api-error-codes.js'

describe('locale message composition', () => {
  it('provides the feedback model label in each supported language', () => {
    expect(messages.zh.aiFeedback.model).toBe('模型')
    expect(messages.en.aiFeedback.model).toBe('Model')
    expect(messages.ru.aiFeedback.model).toBe('Модель')
  })
  it('keeps catch/defend raw-target event copy in all locales', () => {
    for (const locale of ['zh', 'en', 'ru']) {
      for (const key of ['cmd_catch_point_raw', 'cmd_defend_point_raw']) {
        const message = messages[locale].eventStream[key]
        expect(message, `${locale} eventStream.${key}`).toBeTruthy()
        expect(message).toContain('{who}')
        expect(message).toContain('{target}')
      }
    }
    expect(messages.zh.eventStream.cmd_catch_point_raw).toContain('夺取据点指令')
    expect(messages.zh.eventStream.cmd_defend_point_raw).toContain('防守据点指令')
  })
  it('compiles every message in every locale', () => {
    const failures = []
    for (const locale of ['zh', 'en', 'ru']) {
      const walk = (node, prefix) => {
        for (const [key, value] of Object.entries(node)) {
          const path = `${prefix}.${key}`
          if (typeof value === 'string') {
            try {
              compile(value, { warnHtmlMessage: false })
            } catch (error) {
              failures.push(`${locale}:${path}: ${error.message}`)
            }
          } else if (value && typeof value === 'object') {
            walk(value, path)
          }
        }
      }
      walk(messages[locale], locale)
    }
    expect(failures).toEqual([])
  })

  it('provides 3D toolbar disclosure labels in every locale', () => {
    for (const locale of ['zh', 'en', 'ru']) {
      expect(messages[locale].agentReplay.collapse_toolbar).toBeTruthy()
      expect(messages[locale].agentReplay.expand_toolbar).toBeTruthy()
    }
  })
  it('labels every league team-summary column key in all locales', () => {
    for (const locale of ['zh', 'en', 'ru']) {
      for (const key of ['rated_battles', 'league_observed_mean']) {
        expect(messages[locale].league.summary[key], `${locale} league.summary.${key}`).toBeTruthy()
      }
    }
  })
  it('contains creator forms, manual ratings, assessment and canonical errors in all locales', () => {
    for (const locale of ['zh', 'en', 'ru']) {
      for (const key of ['title', 'configTitle', 'loginRequired', 'adminRequired', 'uid', 'assessmentDisclaimer', 'starsHint', 'avatarUnavailable']) expect(messages[locale].creators[key], `${locale} ${key}`).toBeTruthy()
      expect(messages[locale].featureOffline.creators).toBeTruthy()
      for (const code of API_ERROR_CODES.filter(code => code.startsWith('CREATOR_'))) expect(messages[locale].api_errors[code], `${locale} ${code}`).toBeTruthy()
    }
  })
  it('translates stable tournament and recognition errors in all supported locales', () => {
    for (const code of API_ERROR_CODES.filter(code => /TOURNAMENT|RECOGNITION|BROADCAST/.test(code))) {
      for (const locale of ['zh', 'en', 'ru']) expect(messages[locale].api_errors[code], `${locale} ${code}`).toBeTruthy()
    }
  })
  it('merges nested feature namespaces without dropping base translations', () => {
    expect(messages.zh.league.title).toBe(zhBase.league.title)
    for (const locale of ['zh', 'en', 'ru']) {
      expect(messages[locale].league.title).toBeTruthy()
      expect(messages[locale].league.rated_count).toBeTruthy()
    }
  })

  it('contains local replay analysis / export / verification copy in all supported locales', () => {
    for (const locale of ['zh', 'en', 'ru']) {
      const m = messages[locale]
      for (const key of ['loading', 'progress', 'failed_open', 'cancel', 'retry', 'open_other', 'remove_from_list', 'clear_list',
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

  it('contains replay event-details and per-user 3D autostart copy in all locales', () => {
    for (const locale of ['zh', 'en', 'ru']) {
      expect(messages[locale].workspace.show_event_details, `${locale} workspace.show_event_details`).toBeTruthy()
      for (const key of ['playbackSettingsTitle', 'autoStart3d', 'autoStart3dHint']) {
        expect(messages[locale].profile[key], `${locale} profile.${key}`).toBeTruthy()
      }
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
    for (const locale of ['zh', 'en', 'ru']) {
      const offline = messages[locale].featureOffline
      expect(offline, `${locale} featureOffline`).toBeTruthy()
      for (const key of ['title', 'retry', 'aiReview', 'hallOfFame', 'playback3d', 'accountProfile', 'syncPaused']) {
        expect(offline[key], `${locale} featureOffline.${key}`).toBeTruthy()
      }
    }
  })

  it('ships distinct connectivity copy for unknown / degraded / service-unavailable', () => {
    for (const locale of ['zh', 'en', 'ru']) {
      const notice = messages[locale].connectivityNotice
      expect(notice, `${locale} connectivityNotice`).toBeTruthy()
      for (const key of ['unknownTitle', 'unknown', 'degradedTitle', 'degraded',
        'serviceUnavailableTitle', 'serviceUnavailable', 'retry']) {
        expect(notice[key], `${locale} connectivityNotice.${key}`).toBeTruthy()
      }
      expect(new Set([notice.unknown, notice.degraded, notice.serviceUnavailable]).size, `${locale} bodies`).toBe(3)
      const titles = new Set([notice.unknownTitle, notice.degradedTitle, notice.serviceUnavailableTitle])
      expect(titles.size, `${locale} titles`).toBe(3)
      expect(titles.has(messages[locale].featureOffline.title), `${locale} titles vs offline`).toBe(false)
    }
  })

  it('keeps every tank parameter label in all locales', () => {
    for (const locale of ['en', 'ru']) {
      for (const key of Object.keys(zhBase.agentTanks.params)) {
        expect(messages[locale].agentTanks.params[key], `${locale} agentTanks.params.${key}`).toBeTruthy()
      }
    }
  })

  it('describes parameter deltas against the previous rendered values', () => {
    expect(messages.zh.agentTanks.params.baseline_note).toContain('上一次')
    expect(messages.en.agentTanks.params.baseline_note.toLowerCase()).toContain('previously')
    expect(messages.ru.agentTanks.params.baseline_note.toLowerCase()).toContain('предыдущими')
    for (const locale of ['zh', 'en', 'ru']) {
      expect(messages[locale].agentTanks.params.baseline_note, `${locale} baseline_note`).not.toContain('stock configuration')
    }
  })
})
