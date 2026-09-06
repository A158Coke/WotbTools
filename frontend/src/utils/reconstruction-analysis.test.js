import { describe, expect, it, vi } from 'vitest'
import { localizeAiError } from './reconstruction-analysis.js'

const t = vi.fn((key, values) => values ? `${key}:${values.max ?? values.status}` : key)

describe('reconstruction analysis presentation', () => {
  it('localizes stable error codes and hides unknown backend text', () => {
    expect(localizeAiError('AI_RATE_LIMITED', 502, t))
      .toBe('recon.errors.AI_RATE_LIMITED')
    expect(localizeAiError('NO_REPLAY_FILE', 400, t))
      .toBe('recon.errors.NO_REPLAY_FILE')
    expect(localizeAiError('INVALID_REPLAY_FILE_TYPE', 400, t))
      .toBe('recon.errors.INVALID_REPLAY_FILE_TYPE')
    expect(localizeAiError('FILE_TOO_LARGE', 400, t))
      .toBe('recon.errors.FILE_TOO_LARGE')
    expect(localizeAiError('AI_REVIEW_BUSY', 503, t))
      .toBe('recon.errors.AI_REVIEW_BUSY')
    expect(localizeAiError('AI_REVIEW_SCHEMA_FAILED', 502, t))
      .toBe('recon.errors.AI_REVIEW_SCHEMA_FAILED')
    expect(localizeAiError('AI_TIMELINE_UNUSABLE', 200, t))
      .toBe('recon.errors.AI_TIMELINE_UNUSABLE')
    // 防御性契约：后端一旦泄露 detail（内部 TIMELINE_* / NO_RECONSTRUCTION），
    // 前端不得本地化内部码，只落到通用 HTTP 错误（内部码绝不出现在 UI）。
    expect(localizeAiError('AI_TIMELINE_UNUSABLE:[TIMELINE_CLOCK_UNRESOLVED]', 200, t))
      .toBe('recon.ai_error_http:200')
    expect(localizeAiError({ code: 'REPLAY_FILE_COUNT_EXCEEDED' }, 400, t))
      .toBe('recon.errors.REPLAY_FILE_COUNT_EXCEEDED:1')
    expect(localizeAiError({ code: 'REPLAY_FILE_COUNT_EXCEEDED', maxFiles: 3 }, 400, t))
      .toBe('recon.errors.REPLAY_FILE_COUNT_EXCEEDED:3')
    expect(localizeAiError('java.lang.IllegalStateException', 500, t))
      .toBe('recon.ai_error_http:500')
  })
})
