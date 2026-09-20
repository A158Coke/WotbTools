package com.wotb.web.replay.job;

import com.wotb.broker.rabbitmq.ParserFailedMessage;
import com.wotb.broker.rabbitmq.ParserMessageCodec;
import com.wotb.broker.rabbitmq.ParserOutcomeHandler;
import com.wotb.broker.rabbitmq.ParserResultListener;
import com.wotb.broker.rabbitmq.ParserResultMessage;
import com.wotb.broker.rabbitmq.ParserSourceOutcome;
import com.wotb.broker.rabbitmq.ParserSourceStatus;
import com.wotb.broker.rabbitmq.ParserTopology;
import com.rabbitmq.client.Channel;
import com.wotb.contracts.ReplayProcessingDispatcher;
import com.wotb.contracts.ReplayProcessingRequest;
import com.wotb.contracts.ReplayProcessingSource;
import com.wotb.core.model.Battle;
import org.flywaydb.core.Flyway;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import org.springframework.amqp.core.Message;
import org.springframework.amqp.core.MessageProperties;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.jdbc.datasource.DataSourceTransactionManager;
import org.springframework.jdbc.datasource.DriverManagerDataSource;
import org.springframework.transaction.PlatformTransactionManager;
import org.testcontainers.containers.PostgreSQLContainer;
import org.testcontainers.junit.jupiter.Container;
import org.testcontainers.junit.jupiter.Testcontainers;

import java.nio.file.Path;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyBoolean;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * 分布式控制面的 parser 报告消费（真实 PostgreSQL）：attempt 陈旧/重复判定、状态推进，
 * 以及**控制面所有的逻辑重试**。
 *
 * <p>锁死的契约：</p>
 * <ul>
 *   <li>匹配 attempt 的结果 → {@code APPLIED}，source 与 job 状态按既有状态机推进；</li>
 *   <li>重复结果（同 attempt、source 已终态）→ {@code IGNORED}，且**零副作用**（revision 不变）；</li>
 *   <li>陈旧 attempt（小于已观察到的 attempt）→ {@code IGNORED}，不推进任何 source；</li>
 *   <li>未知 job / 终态 job / 已取消 job 的迟到结果 → {@code IGNORED}（安全 no-op，不新建权威行）；</li>
 *   <li>全部 source 终态 → batch 终态：有 READY → READY；全 FAILED → FAILED（NO_VALID_REPLAYS）；</li>
 *   <li>{@code parser.failed(retryable=true)} 且预算未用尽 → **重派 attempt+1**，job 不落终态、
 *       source 不变；同一 attempt 的重复失败报告因水位线推进而成为陈旧 no-op；预算用尽或
 *       {@code retryable=false} → 终态 FAILED；重派失败则异常上抛（消息进 DLQ 而非被 ack）。</li>
 * </ul>
 */
@Testcontainers(disabledWithoutDocker = true)
class PostgresParserOutcomeHandlerPostgresTest {

    /** 测试用重试预算：与生产缺省一致（attempt 1..3）。 */
    private static final int MAX_ATTEMPTS = 3;

    @Container
    static final PostgreSQLContainer<?> POSTGRES = new PostgreSQLContainer<>("postgres:18-alpine")
            .withDatabaseName("wotb").withUsername("wotb").withPassword("wotb");

    private static JdbcClient jdbc;
    private static PlatformTransactionManager transactions;

    @TempDir
    Path tempDir;

    private ReplayProcessingJobStore store;
    private RecordingDispatcher dispatcher;
    private PostgresParserOutcomeHandler handler;

    @BeforeEach
    void migrateOnceThenResetAuthorityTables() {
        if (jdbc == null) {
            Flyway.configure()
                    .dataSource(POSTGRES.getJdbcUrl(), POSTGRES.getUsername(), POSTGRES.getPassword())
                    .locations("classpath:db/migration")
                    .load()
                    .migrate();
            final DriverManagerDataSource dataSource = new DriverManagerDataSource(
                    POSTGRES.getJdbcUrl(), POSTGRES.getUsername(), POSTGRES.getPassword());
            jdbc = JdbcClient.create(dataSource);
            transactions = new DataSourceTransactionManager(dataSource);
        }
        jdbc.sql("delete from replay_processing_job").update();
        store = new ReplayProcessingJobStore(tempDir, 60, new ReplayJobAuthority(jdbc, transactions));
        dispatcher = new RecordingDispatcher();
        handler = new PostgresParserOutcomeHandler(store, new ReplayJobAuthority(jdbc, transactions),
                dispatcher, MAX_ATTEMPTS, new StubFinalization());
    }

    /**
     * 收尾替身：与真实实现同一条业务规则——至少一个 source READY 才有有效回放，否则 0 场有效。
     * 真实的 dedupe / League / enrichment 与对象存储落地由
     * {@code DistributedReplayProcessingPathsTest} 用真实 {@code ObjectStorage} 替身覆盖。
     */
    private static final class StubFinalization implements ReplayBatchFinalization {

        @Override
        public ProcessedDataset finalizeBatch(final ReplayProcessingJob job) {
            final boolean anyReady = job.sourceStates().stream()
                    .anyMatch(source -> source.status() == ReplayProcessingJob.SourceStatus.READY);
            if (!anyReady) {
                throw new ReplayBatchFinalizer.NoValidReplaysException();
            }
            return new ProcessedDataset(List.of(new Battle()), List.of(), List.of(), List.of(), List.of(),
                    null, null);
        }
    }

    @AfterEach
    void closeStore() {
        store.close();
    }

    @Test
    void matchingAttemptAdvancesAuthoritativeSourceAndJobState() {
        register("p-1", List.of("a.wotbreplay", "b.wotbreplay"));

        assertEquals(ParserOutcomeHandler.Outcome.APPLIED, handler.handleResult(result("p-1", 1,
                new ParserSourceOutcome(0, "a.wotbreplay", ParserSourceStatus.READY, null))));

        final ReplayJobAuthority.StoredJob stored = authority().findJob("p-1").orElseThrow();
        assertEquals(ReplayProcessingJob.Status.PROCESSING, stored.status(),
                "首个结果必须把 QUEUED 推进到 PROCESSING（分布式没有 worker-start 事件）");
        assertEquals(ReplayProcessingJob.SourceStatus.READY, stored.sources().get(0).status());
        assertEquals(ReplayProcessingJob.SourceStatus.PENDING, stored.sources().get(1).status());
        assertEquals(1, stored.parseCompleted());
        assertEquals(1, stored.parseSucceeded());
        assertEquals(1, attemptWatermark("p-1"));
    }

    @Test
    void allSourcesReadyMarksJobReady() {
        register("p-2", List.of("a.wotbreplay", "b.wotbreplay"));

        assertEquals(ParserOutcomeHandler.Outcome.APPLIED, handler.handleResult(result("p-2", 1,
                new ParserSourceOutcome(0, "a.wotbreplay", ParserSourceStatus.READY, null))));
        assertEquals(ParserOutcomeHandler.Outcome.APPLIED, handler.handleResult(result("p-2", 1,
                new ParserSourceOutcome(1, "b.wotbreplay", ParserSourceStatus.READY, null))));

        final ReplayJobAuthority.StoredJob stored = authority().findJob("p-2").orElseThrow();
        assertEquals(ReplayProcessingJob.Status.READY, stored.status());
        assertNull(stored.errorCode());
        assertEquals(2, stored.parseSucceeded());
        assertEquals(2, stored.processed());
        assertTrue(stored.finishedAtMillis() > 0);
        assertNull(store.get("p-2").result(),
                "分布式 READY 不在进程内存持有 dataset（dataset 由对象存储承载）");
    }

    @Test
    void duplicateResultIsIgnoredWithoutAnySideEffect() {
        register("p-3", List.of("a.wotbreplay"));
        final ParserResultMessage message = result("p-3", 1,
                new ParserSourceOutcome(0, "a.wotbreplay", ParserSourceStatus.READY, null));
        assertEquals(ParserOutcomeHandler.Outcome.APPLIED, handler.handleResult(message));
        final long revisionAfterApply = revisionOf("p-3");
        final ReplayProcessingJob.Status statusAfterApply = statusOf("p-3");

        assertEquals(ParserOutcomeHandler.Outcome.IGNORED_STALE_OR_DUPLICATE, handler.handleResult(message));
        assertEquals(ParserOutcomeHandler.Outcome.IGNORED_STALE_OR_DUPLICATE, handler.handleResult(message),
                "重复投递必须始终是幂等 no-op（可被 ack 丢弃）");

        assertEquals(revisionAfterApply, revisionOf("p-3"), "重复结果不得产生任何权威写入");
        assertEquals(statusAfterApply, statusOf("p-3"));
        assertEquals(1, attemptWatermark("p-3"));
    }

    @Test
    void staleAttemptIsIgnoredAndDoesNotAdvanceSources() {
        register("p-4", List.of("a.wotbreplay", "b.wotbreplay"));
        assertEquals(ParserOutcomeHandler.Outcome.APPLIED, handler.handleResult(result("p-4", 3,
                new ParserSourceOutcome(0, "a.wotbreplay", ParserSourceStatus.READY, null))));
        final long revisionAfterNewerAttempt = revisionOf("p-4");

        assertEquals(ParserOutcomeHandler.Outcome.IGNORED_STALE_OR_DUPLICATE, handler.handleResult(result("p-4", 1,
                new ParserSourceOutcome(1, "b.wotbreplay", ParserSourceStatus.READY, null))));

        assertEquals(revisionAfterNewerAttempt, revisionOf("p-4"), "陈旧 attempt 不得写入权威状态");
        assertEquals(ReplayProcessingJob.SourceStatus.PENDING,
                authority().findJob("p-4").orElseThrow().sources().get(1).status());
        assertEquals(3, attemptWatermark("p-4"), "attempt 水位线只能单调前进");
    }

    @Test
    void allSourcesFailedMarksJobFailedWithStableErrorCode() {
        register("p-5", List.of("a.wotbreplay"));

        assertEquals(ParserOutcomeHandler.Outcome.APPLIED, handler.handleResult(result("p-5", 1,
                new ParserSourceOutcome(0, "a.wotbreplay", ParserSourceStatus.FAILED, "REPLAY_UNREADABLE"))));

        final ReplayJobAuthority.StoredJob stored = authority().findJob("p-5").orElseThrow();
        assertEquals(ReplayProcessingJob.Status.FAILED, stored.status());
        assertEquals("NO_VALID_REPLAYS", stored.errorCode());
        assertEquals(ReplayProcessingJob.SourceStatus.FAILED, stored.sources().get(0).status());
        assertEquals("REPLAY_UNREADABLE", stored.sources().get(0).failureMessage());
        assertEquals(1, stored.parseFailed());
    }

    @Test
    void retryableAttemptFailureRedispatchesNextAttemptInsteadOfFailingTheJob() {
        register("p-6", List.of("a.wotbreplay", "b.wotbreplay"));

        assertEquals(ParserOutcomeHandler.Outcome.APPLIED, handler.handleFailed(failed("p-6", 1)));

        assertEquals(1, dispatcher.requests.size(), "可重试的基础设施失败必须重派，而不是落成终态");
        final ReplayProcessingRequest retry = dispatcher.requests.getFirst();
        assertEquals("p-6", retry.jobId());
        assertEquals(2, retry.attempt(), "逻辑重试 = 同一 job、attempt+1");
        assertEquals(List.of(0, 1), retry.sources().stream().map(ReplayProcessingSource::sourceIndex).toList(),
                "重派的是这次 attempt 的完整 source 集合");

        final ReplayJobAuthority.StoredJob stored = authority().findJob("p-6").orElseThrow();
        assertEquals(ReplayProcessingJob.Status.QUEUED, stored.status(),
                "重派本身既不是终态，也不伪造任何逐源结果");
        assertTrue(stored.sources().stream().allMatch(s -> s.status() == ReplayProcessingJob.SourceStatus.PENDING));
        assertEquals(2, attemptWatermark("p-6"), "水位线推进到已派发的 attempt，重复报告才会被判陈旧");
    }

    @Test
    void duplicateRetryableFailureForTheSameAttemptIsStaleAndNeverRedispatchesTwice() {
        register("p-6b", List.of("a.wotbreplay"));
        final ParserFailedMessage failed = failed("p-6b", 1);

        assertEquals(ParserOutcomeHandler.Outcome.APPLIED, handler.handleFailed(failed));
        assertEquals(ParserOutcomeHandler.Outcome.IGNORED_STALE_OR_DUPLICATE, handler.handleFailed(failed),
                "同一 attempt 的重复失败报告必须 ack 丢弃（幂等 no-op），绝不产生第二次重派");

        assertEquals(1, dispatcher.requests.size());
        assertEquals(2, attemptWatermark("p-6b"));
    }

    @Test
    void retryBudgetExhaustionFailsTheJobWithTheReportedCode() {
        register("p-6c", List.of("a.wotbreplay", "b.wotbreplay"));

        assertEquals(ParserOutcomeHandler.Outcome.APPLIED, handler.handleFailed(failed("p-6c", 1)));
        assertEquals(ParserOutcomeHandler.Outcome.APPLIED, handler.handleFailed(failed("p-6c", 2)));
        assertEquals(ParserOutcomeHandler.Outcome.APPLIED, handler.handleFailed(failed("p-6c", 3)));

        assertEquals(List.of(2, 3), dispatcher.requests.stream().map(ReplayProcessingRequest::attempt).toList(),
                "attempt=1,2 各重派一次；attempt=max 用尽预算 → 终态");

        final ReplayJobAuthority.StoredJob stored = authority().findJob("p-6c").orElseThrow();
        assertEquals(ReplayProcessingJob.Status.FAILED, stored.status());
        assertEquals("PARSER_WORKER_STORAGE_UNAVAILABLE", stored.errorCode());
        assertEquals(2, stored.parseFailed());
        assertTrue(stored.sources().stream().allMatch(s -> s.status() == ReplayProcessingJob.SourceStatus.FAILED));
    }

    @Test
    void nonRetryableAttemptFailureFailsTheJobImmediately() {
        register("p-6d", List.of("a.wotbreplay"));
        final ParserFailedMessage failed = new ParserFailedMessage(
                "1", "evt-6d", "p-6d", 1, Instant.now(), "REPLAY_PROCESSING_FAILED", false);

        assertEquals(ParserOutcomeHandler.Outcome.APPLIED, handler.handleFailed(failed));

        assertTrue(dispatcher.requests.isEmpty(), "worker 判定不可重试时控制面不得重派");
        assertEquals(ReplayProcessingJob.Status.FAILED, statusOf("p-6d"));
        assertEquals("REPLAY_PROCESSING_FAILED", authority().findJob("p-6d").orElseThrow().errorCode());
    }

    /**
     * 重派失败必须**上抛**（因此 listener nack 不重入队 → {@code wotb.parser.dlq}），
     * 且绝不能推进水位线：否则 operator 重放这条报告时会因「已陈旧」而被丢弃，
     * job 就永久卡在「已决定重试、却没有任何执行」。
     */
    @Test
    void retryDispatchFailurePropagatesSoTheReportDeadLettersInsteadOfBeingAcked() throws Exception {
        register("p-6e", List.of("a.wotbreplay"));
        dispatcher.failure = new IllegalStateException("broker confirmation failed");
        final ParserMessageCodec codec = new ParserMessageCodec();
        final byte[] body = codec.encode(failed("p-6e", 1));
        final Channel channel = mock(Channel.class);

        new ParserResultListener(codec, handler).onMessage(amqpMessage(body, 11L,
                ParserTopology.PARSER_FAILED_ROUTING_KEY), channel);

        verify(channel).basicNack(11L, false, false);
        verify(channel, never()).basicAck(anyLong(), anyBoolean());
        assertEquals(0, attemptWatermark("p-6e"), "派发失败不得推进水位线：重放必须能重新派发这次重试");
        assertEquals(ReplayProcessingJob.Status.QUEUED, statusOf("p-6e"));
    }

    /** 重试预算是控制面的配置：0（或负数）必须构造即失败，绝不静默变成「不重试」。 */
    @Test
    void retryBudgetBelowTheFirstAttemptIsRejected() {
        assertThrows(IllegalArgumentException.class, () -> new PostgresParserOutcomeHandler(
                store, authority(), dispatcher, 0, new StubFinalization()));
    }

    @Test
    void unknownJobResultIsIgnoredAndCreatesNoAuthorityRow() {
        assertEquals(ParserOutcomeHandler.Outcome.IGNORED_STALE_OR_DUPLICATE, handler.handleResult(result("missing", 1,
                new ParserSourceOutcome(0, "a.wotbreplay", ParserSourceStatus.READY, null))));
        assertEquals(ParserOutcomeHandler.Outcome.IGNORED_STALE_OR_DUPLICATE, handler.handleFailed(
                new ParserFailedMessage("1", "evt-x", "missing", 1, Instant.now(), "REPLAY_PROCESSING_FAILED", false)));

        assertEquals(0, jdbc.sql("select count(*) from replay_processing_job").query(Integer.class).single());
    }

    @Test
    void lateResultAfterCancellationIsDiscardedAndJobBecomesTerminal() {
        register("p-7", List.of("a.wotbreplay"));
        final ReplayProcessingJob job = store.get("p-7");
        assertTrue(job.startProcessing());
        assertTrue(job.requestCancel());
        assertEquals(ReplayProcessingJob.Status.PROCESSING, job.snapshot().status(),
                "PROCESSING 取消先只置协作标志");

        assertEquals(ParserOutcomeHandler.Outcome.IGNORED_STALE_OR_DUPLICATE, handler.handleResult(result("p-7", 1,
                new ParserSourceOutcome(0, "a.wotbreplay", ParserSourceStatus.READY, null))));

        assertEquals(ReplayProcessingJob.Status.CANCELLED, statusOf("p-7"),
                "迟到结果必须丢弃并按协作取消收尾，绝不覆盖终态语义");
        assertEquals(ReplayProcessingJob.SourceStatus.PENDING,
                authority().findJob("p-7").orElseThrow().sources().get(0).status());
    }

    private void register(final String jobId, final List<String> sourceNames) {
        store.register(new ReplayProcessingJob(jobId, sourceNames));
    }

    /**
     * 传输层语义：幂等 no-op（重复/陈旧）同样必须 **ack** —— 否则一条重复结果会进 DLQ 等
     * operator 处理；只有「现在无法应用」（handler 抛异常）才 nack 不重入队。
     */
    @Test
    void outcomeAcknowledgementFollowsHandlerOutcome() throws Exception {
        register("p-8", List.of("a.wotbreplay"));
        final ParserMessageCodec codec = new ParserMessageCodec();
        final byte[] body = codec.encode(result("p-8", 1,
                new ParserSourceOutcome(0, "a.wotbreplay", ParserSourceStatus.READY, null)));
        final ParserResultListener listener = new ParserResultListener(codec, handler);
        final Channel channel = mock(Channel.class);

        listener.onMessage(amqpMessage(body, 7L), channel);
        listener.onMessage(amqpMessage(body, 8L), channel);
        verify(channel).basicAck(7L, false);
        verify(channel).basicAck(8L, false);
        verify(channel, never()).basicNack(anyLong(), anyBoolean(), anyBoolean());

        final Channel failingChannel = mock(Channel.class);
        final ParserOutcomeHandler failing = mock(ParserOutcomeHandler.class);
        when(failing.handleResult(any())).thenThrow(new IllegalStateException("database unavailable"));
        new ParserResultListener(codec, failing).onMessage(amqpMessage(body, 9L), failingChannel);
        verify(failingChannel).basicNack(9L, false, false);
        verify(failingChannel, never()).basicAck(anyLong(), anyBoolean());
    }

    private static Message amqpMessage(final byte[] body, final long deliveryTag) {
        return amqpMessage(body, deliveryTag, ParserTopology.PARSER_RESULT_ROUTING_KEY);
    }

    private static Message amqpMessage(final byte[] body, final long deliveryTag, final String routingKey) {
        final MessageProperties properties = new MessageProperties();
        properties.setDeliveryTag(deliveryTag);
        properties.setReceivedRoutingKey(routingKey);
        return new Message(body, properties);
    }

    private static ParserResultMessage result(final String jobId, final int attempt,
                                              final ParserSourceOutcome outcome) {
        return new ParserResultMessage("1", "evt-" + jobId, jobId, attempt, Instant.now(), List.of(outcome));
    }

    /** 可重试的整次 attempt 失败（worker 基础设施失败的 wire 形状）。 */
    private static ParserFailedMessage failed(final String jobId, final int attempt) {
        return new ParserFailedMessage("1", "evt-" + jobId + "-" + attempt, jobId, attempt, Instant.now(),
                "PARSER_WORKER_STORAGE_UNAVAILABLE", true);
    }

    private ReplayJobAuthority authority() {
        return new ReplayJobAuthority(jdbc, transactions);
    }

    private static long revisionOf(final String jobId) {
        return jdbc.sql("select revision from replay_processing_job where job_id = :id")
                .param("id", jobId).query(Long.class).single();
    }

    private static int attemptWatermark(final String jobId) {
        return jdbc.sql("select attempt_watermark from replay_processing_job where job_id = :id")
                .param("id", jobId).query(Integer.class).single();
    }

    private static ReplayProcessingJob.Status statusOf(final String jobId) {
        return ReplayProcessingJob.Status.valueOf(jdbc.sql("select status from replay_processing_job where job_id = :id")
                .param("id", jobId).query(String.class).single());
    }

    /** 记录重派请求、可按需失败的 {@link ReplayProcessingDispatcher} 替身。 */
    private static final class RecordingDispatcher implements ReplayProcessingDispatcher {

        private final List<ReplayProcessingRequest> requests = new ArrayList<>();
        private RuntimeException failure;

        @Override
        public void submit(final ReplayProcessingRequest request) {
            requests.add(request);
            if (failure != null) {
                throw failure;
            }
        }

        @Override
        public CancellationResult cancelQueued(final String jobId) {
            return CancellationResult.ACTIVE_COMPLETION_PENDING;
        }
    }
}
