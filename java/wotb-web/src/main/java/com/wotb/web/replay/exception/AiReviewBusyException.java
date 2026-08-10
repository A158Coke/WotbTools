package com.wotb.web.replay.exception;

/**
 * AI Review worker 池已满（workers + queue 全部占用），立即拒绝而非阻塞
 * servlet request 线程。映射为 HTTP 503 + {@code AI_REVIEW_BUSY} 稳定码。
 * <p>与 {@link ReplayBusyException}（回放解析并发容量已满，{@code REPLAY_BUSY}）
 * 区分：本异常专指 AI Review worker 池饱和。</p>
 */
public class AiReviewBusyException extends RuntimeException {

    public AiReviewBusyException() {
        super("AI_REVIEW_BUSY");
    }
}
