package com.wotb.parserworker;

/**
 * parser worker 的运行时预算与投递确认参数。
 *
 * <p>并发预算只有一处表达：AMQP {@code prefetch}（默认 2，对齐本地
 * {@code REPLAY_PARSE_MAX_CONCURRENT=2}）。worker 不引入第二套调度器。</p>
 *
 * @param prefetch      consumer prefetch，即 worker 的并发预算，至少 1
 * @param confirmTimeoutSeconds 发布 {@code parser.result}/{@code parser.failed} 等待 broker 确认的秒数
 * @param shutdownTimeoutSeconds 停机时等待在途消息完成的秒数
 */
public record ParserWorkerProperties(
        int prefetch,
        int confirmTimeoutSeconds,
        int shutdownTimeoutSeconds
) {

    public ParserWorkerProperties {
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
