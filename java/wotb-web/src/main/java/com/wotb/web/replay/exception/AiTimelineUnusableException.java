package com.wotb.web.replay.exception;

import com.wotb.core.replay.timeline.TimelineError;

import java.util.List;

/**
 * Canonical BattleTimeline 无法构建/校验失败时拒绝 AI Review（docs/current-plan.md §3/§4）。
 * <p>稳定错误码 {@link #STABLE_ERROR_CODE}（SSE error 事件传达）；细节通过日志/validation
 * 消息保留，前端按稳定码本地化。禁止 settlement-only fallback 继续调用 AI。</p>
 * <p>SSE 错误契约（PR #102 review）：{@code error} 事件对任何本异常只输出
 * {@code AI_TIMELINE_UNUSABLE}；message 冒号后的 validation detail（{@code TIMELINE_*} /
 * {@code NO_RECONSTRUCTION}）仅供后端日志/debug，绝不作为客户端 error code 或泄露到
 * 稳定协议。message 前缀即稳定码（同步 HTTP 路径 {@code GlobalExceptionHandler} 也按
 * 冒号前前缀提取），由构造函数保证单一来源、不会漂移。</p>
 */
public class AiTimelineUnusableException extends IllegalArgumentException {

    /**
     * 客户端稳定错误码（SSE error 事件 / 同步 HTTP 响应共用，禁止携带 detail）。
     */
    public static final String STABLE_ERROR_CODE = "AI_TIMELINE_UNUSABLE";

    public AiTimelineUnusableException(final List<TimelineError> errors) {
        super(STABLE_ERROR_CODE + (errors == null || errors.isEmpty() ? ""
                : ":" + errors));
    }

    public AiTimelineUnusableException(final String detail) {
        super(STABLE_ERROR_CODE + (detail == null || detail.isBlank() ? "" : ":" + detail));
    }
}
