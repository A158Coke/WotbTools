package com.wotb.web.replay.ai;

/**
 * AI 复盘流式进度监听器：编排层（Harness / Team / Player Service）在执行期间
 * 通过此接口向调用方（Controller 的 SSE 发送器）广播阶段事件与主复盘 token 增量。
 * <p>事件命名约定（SSE 协议）：{@code call1_start} / {@code call1_done} /
 * {@code evidence_done} / {@code call2_token}；{@code done} 事件由调用方在拿到最终
 * {@code AnalyzeResponse} 后自行发送。</p>
 * <p>{@code autopsy_*} 仅可能由历史兼容 facade 发出，不属于生产 Team AI Review v0.5 协议。</p>
 * <p>所有回调与发起调用同线程、单线程顺序；回调抛出的异常会中断当前阶段
 * （token 回调抛出时等价于断流）。</p>
 */
public interface AiReviewStreamListener {

    /** 空实现：同步路径（无需进度广播）时使用，行为与改造前完全一致。 */
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
