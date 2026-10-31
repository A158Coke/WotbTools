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
  it('compiles every message in every locale', () => {
    // vue-i18n 在渲染时才编译消息；未转义的 `@`（linked message）/非法 `|` 会在
    // 切语言后抛 SyntaxError，表现为整块 UI 消失（2026-10-27 英文 pen_far 事故）。
    // 逐条过官方 compiler，别等浏览器里第一次渲染才发现。
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
    // #671 回归：表头由 `league.summary.<column key>` 拼出，缺 key 就会把内部 key 直接显示给用户。
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

  it('ships distinct connectivity copy for unknown / degraded / service-unavailable', () => {
    // review P1：这三种状态**不能**复用 offline 文案，否则用户会被错误告知「你现在离线」。
    for (const locale of ['zh', 'en', 'ru']) {
      const notice = messages[locale].connectivityNotice
      expect(notice, `${locale} connectivityNotice`).toBeTruthy()
      for (const key of ['unknownTitle', 'unknown', 'degradedTitle', 'degraded',
        'serviceUnavailableTitle', 'serviceUnavailable', 'retry']) {
        expect(notice[key], `${locale} connectivityNotice.${key}`).toBeTruthy()
      }
      // 三种状态三套文案，且都不得与 offline 标题重复。
      expect(new Set([notice.unknown, notice.degraded, notice.serviceUnavailable]).size, `${locale} bodies`).toBe(3)
      const titles = new Set([notice.unknownTitle, notice.degradedTitle, notice.serviceUnavailableTitle])
      expect(titles.size, `${locale} titles`).toBe(3)
      expect(titles.has(messages[locale].featureOffline.title), `${locale} titles vs offline`).toBe(false)
    }
  })

  it('keeps every tank parameter label in all locales', () => {
    // 配置器参数/俯仰表按 key 直出；缺 key 会把内部 key 显示给用户（新增键曾漏 en/ru）。
    for (const locale of ['en', 'ru']) {
      for (const key of Object.keys(zhBase.agentTanks.params)) {
        expect(messages[locale].agentTanks.params[key], `${locale} agentTanks.params.${key}`).toBeTruthy()
      }
    }
  })

  it('describes parameter deltas against the previous rendered values', () => {
    // BK useDelta：delta 不是相对空装备初始配置；文案必须与 AgentTankopedia 的 previous 基线一致。
    expect(messages.zh.agentTanks.params.baseline_note).toContain('上一次')
    expect(messages.en.agentTanks.params.baseline_note.toLowerCase()).toContain('previously')
    expect(messages.ru.agentTanks.params.baseline_note.toLowerCase()).toContain('предыдущими')
    for (const locale of ['zh', 'en', 'ru']) {
      expect(messages[locale].agentTanks.params.baseline_note, `${locale} baseline_note`).not.toContain('stock configuration')
    }
  })
})
