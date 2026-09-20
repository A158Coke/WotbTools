package com.wotb.web.replay.job;

import com.wotb.broker.rabbitmq.ParserFailedMessage;
import com.wotb.broker.rabbitmq.ParserOutcomeHandler;
import com.wotb.broker.rabbitmq.ParserResultMessage;
import com.wotb.broker.rabbitmq.ParserSourceOutcome;
import com.wotb.broker.rabbitmq.ParserSourceStatus;
import com.wotb.contracts.ReplayProcessingDispatcher;
import com.wotb.contracts.ReplayProcessingRequest;
import com.wotb.contracts.ReplayProcessingSource;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Objects;

/**
 * 分布式控制面的 parser 报告处理器：把 {@code wotb.parser.result} 队列上的报告（{@code parser.result}
 * 与 {@code parser.failed}）**按权威状态**应用到 PostgreSQL。
 *
 * <p><b>幂等 / 陈旧判定（唯一规则）</b>——两种报告共用同一个前置判定，按顺序：</p>
 * <ol>
 *   <li>job 在权威状态里不存在 → {@code IGNORED}（unknown job 是安全 no-op，不可能重试成功）；</li>
 *   <li>{@code message.attempt < attemptWatermark} → {@code IGNORED}（陈旧：更晚的 attempt 已经推进过状态）；</li>
 *   <li>job 已是终态 → {@code IGNORED}（重复投递；不再产生任何副作用）；</li>
 *   <li>job 已 {@code cancel_requested} → 推进 CANCELLED 并 {@code IGNORED}（迟到结果绝不覆盖终态）；</li>
 *   <li>结果：否则逐个 source 应用（已终态的 source 跳过），全部 source 都已终态 → {@code IGNORED}；</li>
 *   <li>失败：{@code retryable} 且预算未用尽 → **重派 {@code attempt+1}**；否则转终态。</li>
 * </ol>
 *
 * <p><b>逻辑重试归控制面（本类的核心职责）</b>：worker 从不 nack、也从不把任务送进
 * {@code wotb.parser.retry}；它只在基础设施失败时发布确认投递的
 * {@code parser.failed(retryable=true)}。真正的重试决定发生在这里——依据 PostgreSQL 权威状态
 * （job 是否仍活跃、是否已终态、是否已取消、attempt 水位线是否仍是本次 attempt、预算是否剩余）
 * 派发一次新的 {@code parser.request}（同 {@code jobId}、{@code attempt+1}）。因此重试预算只存在于
 * 控制面，随 job 权威状态一起持久化在 PG 水位线里，worker 与 broker 都不持有它，也不存在
 * 「broker 自动重放 parser 工作」这条路径。immediate re-dispatch（没有延迟队列）是有意的：延迟
 * 重试属于控制面自己的调度器，绝不能通过把消息塞回 broker 拓扑来借用。</p>
 *
 * <p><b>重派的失败模型</b>：先派发、再推进水位线。派发抛异常时水位线保持不动并让异常上抛，
 * {@code ParserResultListener} 会把这条报告 nack 不重入队 → 落在 {@code wotb.parser.dlq} 等
 * operator 重放；重放时会重新派发这一次重试，job 不会卡在「已决定重试但没有任何执行」。
 * 崩溃窗口（已派发、未推进水位线）最坏结果是同一 {@code attempt+1} 被执行两次——产物按对象键
 * 幂等覆盖、报告按同一 attempt 幂等应用，属重复工作而非不一致状态。</p>
 *
 * <p><b>状态迁移的唯一所有者仍然是 {@link ReplayProcessingJob}/{@link ReplayJobState}</b>：
 * 本类只调用既有 mutator（{@code startProcessing/markSourceReady/markSourceFailed/markReady/
 * markFailed/markCancelled}），不复制任何状态合法性规则；落库由注册表的 write-through
 * 投影完成。因此「分布式」与「本地」两种执行共用同一套 job 生命周期语义。</p>
 *
 * <p><b>并发</b>：一次 apply 会写回整份 source 投影（权威 save 是全量替换），因此同一 job 的
 * outcome 必须串行应用。装配点把 {@code SimpleMessageListenerContainer} 固定为单消费者
 * （prefetch/concurrentConsumers = 1），这也是本类不做 per-job 加锁的前提。跨实例的重复重派
 * 由 {@code advanceAttemptWatermark} 的 CAS 语义收敛（见 {@link #dispatchRetry}）。</p>
 *
 * <p>抛异常 = 「本投递现在无法应用」：{@code ParserResultListener} 会 nack 不重入队，消息落到
 * {@code wotb.parser.dlq} 等 operator 处理。瞬时的数据库故障（或重派失败）绝不能返回 Outcome。</p>
 */
public final class PostgresParserOutcomeHandler implements ParserOutcomeHandler {

    private static final Logger LOGGER = LoggerFactory.getLogger(PostgresParserOutcomeHandler.class);

    /** 全部 source 都没有可用回放时的稳定错误码（沿用本地 finalize 的语义）。 */
    static final String NO_VALID_REPLAYS = "NO_VALID_REPLAYS";

    private final ReplayProcessingJobStore store;
    private final ReplayJobAuthority authority;
    /** 逻辑重试的派发通道（同一端口，attempt 由控制面写入命令）。 */
    private final ReplayProcessingDispatcher dispatcher;
    /** 每个 job 允许的最大 attempt 数（含首次）；attempt 用尽即终态。 */
    private final int maxAttempts;

    public PostgresParserOutcomeHandler(final ReplayProcessingJobStore store,
                                        final ReplayJobAuthority authority,
                                        final ReplayProcessingDispatcher dispatcher,
                                        final int maxAttempts) {
        this.store = Objects.requireNonNull(store, "store");
        this.authority = Objects.requireNonNull(authority, "authority");
        this.dispatcher = Objects.requireNonNull(dispatcher, "dispatcher");
        if (maxAttempts < ReplayProcessingRequest.FIRST_ATTEMPT) {
            throw new IllegalArgumentException("maxAttempts must be at least "
                    + ReplayProcessingRequest.FIRST_ATTEMPT + ": " + maxAttempts);
        }
        this.maxAttempts = maxAttempts;
    }

    @Override
    public Outcome handleResult(final ParserResultMessage message) {
        final ReplayProcessingJob job = store.get(message.jobId());
        if (job == null) {
            LOGGER.warn("event=replay_processing_outcome_unknown_job jobId={} attempt={}",
                    message.jobId(), message.attempt());
            return Outcome.IGNORED_STALE_OR_DUPLICATE;
        }
        final int watermark = authority.attemptWatermark(message.jobId());
        if (message.attempt() < watermark) {
            LOGGER.warn("event=replay_processing_outcome_stale jobId={} attempt={} attemptWatermark={}",
                    message.jobId(), message.attempt(), watermark);
            return Outcome.IGNORED_STALE_OR_DUPLICATE;
        }
        if (terminal(job)) {
            LOGGER.info("event=replay_processing_outcome_duplicate jobId={} attempt={} status={}",
                    message.jobId(), message.attempt(), job.snapshot().status().name());
            return Outcome.IGNORED_STALE_OR_DUPLICATE;
        }
        if (job.isCancelled()) {
            cancel(job);
            return Outcome.IGNORED_STALE_OR_DUPLICATE;
        }
        if (!applySources(job, message.sources())) {
            LOGGER.info("event=replay_processing_outcome_duplicate jobId={} attempt={} reason=all_sources_terminal",
                    message.jobId(), message.attempt());
            return Outcome.IGNORED_STALE_OR_DUPLICATE;
        }
        authority.advanceAttemptWatermark(job.jobId(), message.attempt());
        finishIfComplete(job);
        return Outcome.APPLIED;
    }

    /**
     * 整个 attempt 在产生任何逐源结果之前就失败了（例如 worker 读不到输入、写不了产物）。
     *
     * <p>预算允许时**不落终态**，而是按 PG 权威状态重派 {@code attempt+1}；只有预算用尽、
     * worker 明确宣告不可重试、或 job 已不再活跃时才转终态。</p>
     */
    @Override
    public Outcome handleFailed(final ParserFailedMessage message) {
        final ReplayProcessingJob job = store.get(message.jobId());
        if (job == null) {
            LOGGER.warn("event=replay_processing_failure_unknown_job jobId={} attempt={} errorCode={}",
                    message.jobId(), message.attempt(), message.errorCode());
            return Outcome.IGNORED_STALE_OR_DUPLICATE;
        }
        final int watermark = authority.attemptWatermark(message.jobId());
        if (message.attempt() < watermark) {
            LOGGER.warn("event=replay_processing_failure_stale jobId={} attempt={} attemptWatermark={} errorCode={}",
                    message.jobId(), message.attempt(), watermark, message.errorCode());
            return Outcome.IGNORED_STALE_OR_DUPLICATE;
        }
        if (terminal(job)) {
            LOGGER.info("event=replay_processing_failure_duplicate jobId={} attempt={} status={}",
                    message.jobId(), message.attempt(), job.snapshot().status().name());
            return Outcome.IGNORED_STALE_OR_DUPLICATE;
        }
        if (job.isCancelled()) {
            cancel(job);
            return Outcome.IGNORED_STALE_OR_DUPLICATE;
        }
        if (message.retryable() && message.attempt() < maxAttempts) {
            return dispatchRetry(job, message);
        }
        return failTerminal(job, message);
    }

    /**
     * 逻辑重试：控制面按 PG 权威状态决定 {@code attempt+1} 并派发一次新的 {@code parser.request}。
     *
     * <p>重派的是**整个 attempt 的完整 source 集合**（一个 attempt = 一次完整的 batch 执行）：
     * worker 只有在整个请求成功后才会发布逐源结果，因此基础设施失败时权威状态里不存在任何
     * 「已完成的 source」可以跳过。</p>
     */
    private Outcome dispatchRetry(final ReplayProcessingJob job, final ParserFailedMessage message) {
        final int nextAttempt = message.attempt() + 1;
        final ReplayProcessingRequest retry = new ReplayProcessingRequest(
                job.jobId(), retrySources(job), nextAttempt);
        // 先派发、再推进水位线。派发失败即上抛（listener nack 不重入队 → DLQ + operator 重放），
        // 水位线保持不动，重放会重新派发这一次重试，而不是把 job 卡成「已重试但没有执行」。
        dispatcher.submit(retry);
        if (!authority.advanceAttemptWatermark(job.jobId(), nextAttempt)) {
            // 另一个控制面实例已经把水位线推进到 >= nextAttempt：本次重派只是重复工作，丢弃报告。
            LOGGER.warn("event=replay_processing_failure_retry_raced jobId={} attempt={} nextAttempt={}",
                    job.jobId(), message.attempt(), nextAttempt);
            return Outcome.IGNORED_STALE_OR_DUPLICATE;
        }
        LOGGER.warn("event=replay_processing_failure_retry_dispatched jobId={} failedAttempt={}"
                        + " nextAttempt={} maxAttempts={} errorCode={}",
                job.jobId(), message.attempt(), nextAttempt, maxAttempts, message.errorCode());
        return Outcome.APPLIED;
    }

    /** 重试不可用（预算用尽或 worker 宣告不可重试）：整个 attempt 落成终态 FAILED。 */
    private Outcome failTerminal(final ReplayProcessingJob job, final ParserFailedMessage message) {
        LOGGER.warn("event=replay_processing_failure_terminal jobId={} attempt={} maxAttempts={}"
                        + " retryable={} errorCode={}",
                job.jobId(), message.attempt(), maxAttempts, message.retryable(), message.errorCode());
        // QUEUED → PROCESSING：终态迁移的状态机前提要求先进入 PROCESSING（分布式下没有
        // worker-start 事件，失败报告本身就是「执行发生过」的可观察事实）。
        job.startProcessing();
        for (final ReplayProcessingJob.SourceState source : job.sourceStates()) {
            if (sourceTerminal(source)) {
                continue;
            }
            job.markSourceFailed(source.sourceIndex(), message.errorCode());
            job.recordParseFailure();
        }
        authority.advanceAttemptWatermark(job.jobId(), message.attempt());
        job.markFailed(message.errorCode());
        recordTerminal(job, "processing_job_failed jobId=" + job.jobId() + " errorCode=" + message.errorCode());
        return Outcome.APPLIED;
    }

    /**
     * attempt 的完整 source 集合（按 sourceIndex 顺序）。
     *
     * <p>只带 wire envelope 需要的 identity（index + name）：worker 自己从 {@code jobId} + index
     * 推导对象键，控制面不传递任何存储位置。</p>
     */
    private static List<ReplayProcessingSource> retrySources(final ReplayProcessingJob job) {
        return job.sourceStates().stream()
                .map(source -> new ReplayProcessingSource(source.sourceIndex(), source.sourceName()))
                .toList();
    }

    /** 逐个 source 应用结果（已终态 source 幂等跳过）。@return 是否至少应用了一个 source */
    private boolean applySources(final ReplayProcessingJob job, final List<ParserSourceOutcome> outcomes) {
        final Map<Integer, ReplayProcessingJob.SourceState> sources = sourceIndex(job);
        for (final ParserSourceOutcome outcome : outcomes) {
            if (!sources.containsKey(outcome.sourceIndex())) {
                LOGGER.warn("event=replay_processing_outcome_unknown_source jobId={} sourceIndex={}",
                        job.jobId(), outcome.sourceIndex());
            }
        }
        final List<ParserSourceOutcome> applicable = outcomes.stream()
                .distinct()
                .filter(outcome -> sources.containsKey(outcome.sourceIndex()))
                .filter(outcome -> !sourceTerminal(sources.get(outcome.sourceIndex())))
                .toList();
        if (applicable.isEmpty()) {
            return false;
        }
        // QUEUED → PROCESSING：分布式下没有 worker-start 事件，第一个到达的结果就是「执行已开始」
        // 的可观察事实；markReady/markFailed 的状态机前提也要求先进入 PROCESSING。
        job.startProcessing();
        applicable.forEach(outcome -> applySource(job, outcome));
        return true;
    }

    private static void applySource(final ReplayProcessingJob job, final ParserSourceOutcome outcome) {
        if (outcome.status() == ParserSourceStatus.READY) {
            job.markSourceReady(outcome.sourceIndex());
            job.recordParseSuccess();
            return;
        }
        job.markSourceFailed(outcome.sourceIndex(), outcome.errorCode());
        job.recordParseFailure();
    }

    /** 全部 source 终态后收敛 batch 终态：有 READY → READY；全 FAILED → FAILED(NO_VALID_REPLAYS)。 */
    private void finishIfComplete(final ReplayProcessingJob job) {
        final List<ReplayProcessingJob.SourceState> sources = job.sourceStates();
        if (sources.stream().anyMatch(source -> !sourceTerminal(source))) {
            return;
        }
        final boolean anyReady = sources.stream()
                .anyMatch(source -> source.status() == ReplayProcessingJob.SourceStatus.READY);
        if (anyReady) {
            job.markReady();
            recordTerminal(job, "processing_job_ready jobId=" + job.jobId());
            return;
        }
        job.markFailed(NO_VALID_REPLAYS);
        recordTerminal(job, "processing_job_failed jobId=" + job.jobId() + " errorCode=" + NO_VALID_REPLAYS);
    }

    /** 取消竞态：worker 仍活跃、结果迟到 → 状态机收尾为 CANCELLED，结果丢弃。 */
    private void cancel(final ReplayProcessingJob job) {
        job.markCancelled();
        recordTerminal(job, "processing_job_cancelled jobId=" + job.jobId());
    }

    /** 终态 observability exactly-once（状态机的 markTerminalRecorded 是唯一 CAS 边界）。 */
    private static void recordTerminal(final ReplayProcessingJob job, final String message) {
        if (job.markTerminalRecorded()) {
            LOGGER.info("event={}", message);
        }
    }

    private static boolean terminal(final ReplayProcessingJob job) {
        return switch (job.snapshot().status()) {
            case READY, FAILED, CANCELLED -> true;
            case QUEUED, PROCESSING -> false;
        };
    }

    private static boolean sourceTerminal(final ReplayProcessingJob.SourceState source) {
        return source.status() == ReplayProcessingJob.SourceStatus.READY
                || source.status() == ReplayProcessingJob.SourceStatus.FAILED;
    }

    private static Map<Integer, ReplayProcessingJob.SourceState> sourceIndex(final ReplayProcessingJob job) {
        final Map<Integer, ReplayProcessingJob.SourceState> byIndex = new HashMap<>();
        for (final ReplayProcessingJob.SourceState source : job.sourceStates()) {
            byIndex.put(source.sourceIndex(), source);
        }
        return byIndex;
    }
}
