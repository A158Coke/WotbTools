package com.wotb.web.replay.job;

import com.wotb.broker.rabbitmq.ParserFailedMessage;
import com.wotb.broker.rabbitmq.ParserOutcomeHandler;
import com.wotb.broker.rabbitmq.ParserResultMessage;
import com.wotb.broker.rabbitmq.ParserSourceOutcome;
import com.wotb.broker.rabbitmq.ParserSourceStatus;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Objects;

/**
 * 分布式控制面的 parser 结果处理器：把 {@code wotb.parser.result} 上的结果**按权威状态**应用到
 * PostgreSQL。
 *
 * <p><b>幂等 / 陈旧判定（唯一规则）</b>——按顺序：</p>
 * <ol>
 *   <li>job 在权威状态里不存在 → {@code IGNORED}（unknown job 是安全 no-op，不可能重试成功）；</li>
 *   <li>{@code message.attempt < reportedAttempt} → {@code IGNORED}（陈旧：更晚的 attempt 已经推进过状态）；</li>
 *   <li>job 已是终态 → {@code IGNORED}（重复投递；不再产生任何副作用）；</li>
 *   <li>job 已 {@code cancel_requested} → 推进 CANCELLED 并 {@code IGNORED}（迟到结果绝不覆盖终态）；</li>
 *   <li>否则逐个 source 应用（已终态的 source 跳过），全部 source 都已终态 → {@code IGNORED}。</li>
 * </ol>
 *
 * <p><b>状态迁移的唯一所有者仍然是 {@link ReplayProcessingJob}/{@link ReplayJobState}</b>：
 * 本类只调用既有 mutator（{@code startProcessing/markSourceReady/markSourceFailed/markReady/
 * markFailed/markCancelled}），不复制任何状态合法性规则；落库由注册表的 write-through
 * 投影完成。因此「分布式」与「本地」两种执行共用同一套 job 生命周期语义。</p>
 *
 * <p><b>并发</b>：一次 apply 会写回整份 source 投影（权威 save 是全量替换），因此同一 job 的
 * outcome 必须串行应用。装配点把 {@code SimpleMessageListenerContainer} 固定为单消费者
 * （prefetch/concurrentConsumers = 1），这也是本类不做 per-job 加锁的前提。</p>
 *
 * <p>抛异常 = 「本投递现在无法应用」：{@code ParserResultListener} 会 nack 不重入队，消息落到
 * {@code wotb.parser.dlq} 等 operator 处理。瞬时的数据库故障绝不能返回 Outcome。</p>
 */
public final class PostgresParserOutcomeHandler implements ParserOutcomeHandler {

    private static final Logger LOGGER = LoggerFactory.getLogger(PostgresParserOutcomeHandler.class);

    /** 全部 source 都没有可用回放时的稳定错误码（沿用本地 finalize 的语义）。 */
    static final String NO_VALID_REPLAYS = "NO_VALID_REPLAYS";

    private final ReplayProcessingJobStore store;
    private final ReplayJobAuthority authority;

    public PostgresParserOutcomeHandler(final ReplayProcessingJobStore store,
                                        final ReplayJobAuthority authority) {
        this.store = Objects.requireNonNull(store, "store");
        this.authority = Objects.requireNonNull(authority, "authority");
    }

    @Override
    public Outcome handleResult(final ParserResultMessage message) {
        final ReplayProcessingJob job = store.get(message.jobId());
        if (job == null) {
            LOGGER.warn("event=replay_processing_outcome_unknown_job jobId={} attempt={}",
                    message.jobId(), message.attempt());
            return Outcome.IGNORED_STALE_OR_DUPLICATE;
        }
        final int reportedAttempt = authority.reportedAttempt(message.jobId());
        if (message.attempt() < reportedAttempt) {
            LOGGER.warn("event=replay_processing_outcome_stale jobId={} attempt={} reportedAttempt={}",
                    message.jobId(), message.attempt(), reportedAttempt);
            return Outcome.IGNORED_STALE_OR_DUPLICATE;
        }        if (terminal(job)) {
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
        authority.advanceReportedAttempt(job.jobId(), message.attempt());
        finishIfComplete(job);
        return Outcome.APPLIED;
    }

    @Override
    public Outcome handleFailed(final ParserFailedMessage message) {
        final ReplayProcessingJob job = store.get(message.jobId());
        if (job == null) {
            LOGGER.warn("event=replay_processing_failure_unknown_job jobId={} attempt={} errorCode={}",
                    message.jobId(), message.attempt(), message.errorCode());
            return Outcome.IGNORED_STALE_OR_DUPLICATE;
        }
        final int reportedAttempt = authority.reportedAttempt(message.jobId());
        if (message.attempt() < reportedAttempt) {
            LOGGER.warn("event=replay_processing_failure_stale jobId={} attempt={} errorCode={}",
                    message.jobId(), message.attempt(), message.errorCode());
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
        job.startProcessing();
        for (final ReplayProcessingJob.SourceState source : job.sourceStates()) {
            if (sourceTerminal(source)) {
                continue;
            }
            job.markSourceFailed(source.sourceIndex(), message.errorCode());
            job.recordParseFailure();
        }
        authority.advanceReportedAttempt(job.jobId(), message.attempt());
        if (message.retryable()) {
            // worker 认为「再解析一次可能有意义」，但控制面在 PR E 里没有重新派发通道：
            // 这是一个需要 operator 介入的信号，必须留下可检索的痕迹，不能静默终态。
            LOGGER.error("event=replay_processing_failure_retryable_unhandled jobId={} attempt={} errorCode={}",
                    message.jobId(), message.attempt(), message.errorCode());
        }
        job.markFailed(message.errorCode());
        recordTerminal(job, "processing_job_failed jobId=" + job.jobId() + " errorCode=" + message.errorCode());
        return Outcome.APPLIED;
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
