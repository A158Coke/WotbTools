package com.wotb.parserworker;

/**
 * parser worker 的运行时预算与投递确认参数。
 *
 * <p><b>并发只有一个事实源</b>：AMQP consumer 并发（{@code concurrency}，默认 2，对齐本地
 * {@code REPLAY_PARSE_MAX_CONCURRENT=2}）。{@code prefetch} 是<b>每个 consumer</b> 未确认消息的上限，
 * 不是并发度：单 consumer 加大 prefetch 只会让一个线程持有更多未确认消息。worker 不引入第二套调度器。</p>
 *
 * <p><b>没有重试预算参数</b>：重试策略归控制面（新的 {@code parser.request} + {@code attempt+1}），
 * worker 既不做 broker 自动重试也不持有预算状态。</p>
 *
 * @param concurrency           并行解析的 consumer 数（真正的同时解析数），至少 1
 * @param prefetch              每个 consumer 的未确认消息上限，至少 1
 * @param confirmTimeoutSeconds 发布 {@code parser.result}/{@code parser.failed} 等待 broker 确认的秒数
 * @param shutdownTimeoutSeconds 停机时等待在途消息完成的秒数
 */
public record ParserWorkerProperties(
        int concurrency,
        int prefetch,
        int confirmTimeoutSeconds,
        int shutdownTimeoutSeconds
) {

    public ParserWorkerProperties {
        if (concurrency < 1) {
            throw new IllegalArgumentException("concurrency must be at least 1: " + concurrency);
        }
        if (prefetch < 1) {
            throw new IllegalArgumentException("prefetch must be at least 1: " + prefetch);
        }
        if (confirmTimeoutSeconds < 1) {
            throw new IllegalArgumentException("confirmTimeoutSeconds must be at least 1");
        }
        if (shutdownTimeoutSeconds < 1) {
            throw new IllegalArgumentException("shutdownTimeoutSeconds must be at least 1");
        }
    }
}
