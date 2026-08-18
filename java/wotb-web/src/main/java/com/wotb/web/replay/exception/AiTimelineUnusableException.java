package com.wotb.web.replay.exception;

import com.wotb.core.replay.timeline.TimelineError;

import java.util.List;

/**
 * Canonical BattleTimeline 无法构建/校验失败时拒绝 AI Review（docs/current-plan.md §3/§4）。
 * <p>稳定错误码 {@code AI_TIMELINE_UNUSABLE}（SSE error 事件传达）；细节通过日志/validation
 * 消息保留，前端按稳定码本地化。禁止 settlement-only fallback 继续调用 AI。</p>
 */
public class AiTimelineUnusableException extends IllegalArgumentException {

    public AiTimelineUnusableException(final List<TimelineError> errors) {
        super("AI_TIMELINE_UNUSABLE" + (errors == null || errors.isEmpty() ? ""
                : ":" + errors));
    }

    public AiTimelineUnusableException(final String detail) {
        super("AI_TIMELINE_UNUSABLE" + (detail == null || detail.isBlank() ? "" : ":" + detail));
    }
}
