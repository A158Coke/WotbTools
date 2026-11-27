package com.wotb.ai.review;

public interface AiReviewStreamListener {

    AiReviewStreamListener NOOP = new AiReviewStreamListener() {
    };

    /**
     * 阶段边界事件（如 {@code call1_start} / {@code evidence_done}）。
     *
     * @param stage 稳定阶段名，非 null
     */
    default void onStage(final String stage) {
    }

    /**
     * 主复盘（Call #2 / 团队复盘）文本增量，逐段到达。
     *
     * @param delta 文本增量，非 null
     */
    default void onToken(final String delta) {
    }
}
