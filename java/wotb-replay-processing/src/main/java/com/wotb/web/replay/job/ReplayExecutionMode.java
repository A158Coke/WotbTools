package com.wotb.web.replay.job;

/**
 * Replay 执行平面的**单一正向枚举**（{@code docs/current-plan.md} §14.6）。
 *
 * <p>{@code local} = 本进程内解析（缺省，Yecao 现网行为）；{@code distributed} = TX 控制面
 * （输入/产物走对象存储、执行走 RabbitMQ、job/source 权威状态走 PostgreSQL）。</p>
 *
 * <p><b>fail-fast</b>：未知值（含显式空值）必须让启动失败，绝不静默降级为 {@code local}——
 * 静默降级会在「以为已经不在本机解析」的部署里继续占用本机 CPU，是本次切换最危险的单点。
 * 解析入口 {@link #parse(String)} 由 {@code com.wotb.web.replay.config.ReplayProcessingConfig}
 * 在启动时调用。</p>
 *
 * <p>属性名与取值是本枚举的常量，装配点用它做 {@code @ConditionalOnProperty} 门控
 * （本模块与 {@code wotb-web} 都能引用，避免属性名在多处漂移）。</p>
 */
public enum ReplayExecutionMode {

    /** 本进程内解析（缺省）。 */
    LOCAL,

    /** TX 控制面：MinIO + RabbitMQ + PostgreSQL 权威状态。 */
    DISTRIBUTED;

    /** 配置键；{@code application.yml} 与 {@code .env.example} 里的名字必须与它逐字一致。 */
    public static final String PROPERTY = "wotb.replay.execution.mode";

    /** {@link #LOCAL} 的配置字面量。 */
    public static final String LOCAL_VALUE = "local";

    /** {@link #DISTRIBUTED} 的配置字面量。 */
    public static final String DISTRIBUTED_VALUE = "distributed";

    private static final String ALLOWED = LOCAL_VALUE + " | " + DISTRIBUTED_VALUE;

    /**
     * 解析配置值。
     *
     * @throws IllegalStateException 值缺失、空白或不是 {@link #LOCAL_VALUE}/{@link #DISTRIBUTED_VALUE}
     */
    public static ReplayExecutionMode parse(final String raw) {
        if (raw == null || raw.isBlank()) {
            throw new IllegalStateException(
                    PROPERTY + " must be explicitly one of " + ALLOWED + " (blank is not a valid mode)");
        }
        return switch (raw.trim()) {
            case LOCAL_VALUE -> LOCAL;
            case DISTRIBUTED_VALUE -> DISTRIBUTED;
            default -> throw new IllegalStateException(
                    PROPERTY + " must be one of " + ALLOWED + ", got: " + raw);
        };
    }
}
