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
import java.util.List;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyBoolean;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * 分布式控制面的 parser 结果消费（真实 PostgreSQL）：attempt 陈旧/重复判定与状态推进。
 *
 * <p>锁死的契约：</p>
 * <ul>
 *   <li>匹配 attempt 的结果 → {@code APPLIED}，source 与 job 状态按既有状态机推进；</li>
 *   <li>重复结果（同 attempt、source 已终态）→ {@code IGNORED}，且**零副作用**（revision 不变）；</li>
 *   <li>陈旧 attempt（小于已观察到的 attempt）→ {@code IGNORED}，不推进任何 source；</li>
 *   <li>未知 job / 终态 job / 已取消 job 的迟到结果 → {@code IGNORED}（安全 no-op，不新建权威行）；</li>
 *   <li>全部 source 终态 → batch 终态：有 READY → READY；全 FAILED → FAILED（NO_VALID_REPLAYS）。</li>
 * </ul>
 */
@Testcontainers(disabledWithoutDocker = true)
class PostgresParserOutcomeHandlerPostgresTest {

    @Container
    static final PostgreSQLContainer<?> POSTGRES = new PostgreSQLContainer<>("postgres:18-alpine")
            .withDatabaseName("wotb").withUsername("wotb").withPassword("wotb");

    private static JdbcClient jdbc;
    private static PlatformTransactionManager transactions;

    @TempDir
    Path tempDir;

    private ReplayProcessingJobStore store;
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
        handler = new PostgresParserOutcomeHandler(store, new ReplayJobAuthority(jdbc, transactions));
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
        assertEquals(1, reportedAttempt("p-1"));
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
        assertEquals(1, reportedAttempt("p-3"));
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
        assertEquals(3, reportedAttempt("p-4"), "reported attempt 只能单调前进");
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
    void wholeAttemptFailureMarksJobFailedWithReportedCode() {
        register("p-6", List.of("a.wotbreplay", "b.wotbreplay"));

        assertEquals(ParserOutcomeHandler.Outcome.APPLIED, handler.handleFailed(new ParserFailedMessage(
                "1", "evt-6", "p-6", 1, Instant.now(), "PROCESSING_JOB_STORAGE_UNAVAILABLE", true)));

        final ReplayJobAuthority.StoredJob stored = authority().findJob("p-6").orElseThrow();
        assertEquals(ReplayProcessingJob.Status.FAILED, stored.status());
        assertEquals("PROCESSING_JOB_STORAGE_UNAVAILABLE", stored.errorCode());
        assertEquals(2, stored.parseFailed());
        assertTrue(stored.sources().stream().allMatch(s -> s.status() == ReplayProcessingJob.SourceStatus.FAILED));
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
    void lateResultAfterCancellationIsDiscardedAndJobBecomesTerminal() {        register("p-7", List.of("a.wotbreplay"));
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
        final MessageProperties properties = new MessageProperties();
        properties.setDeliveryTag(deliveryTag);
        properties.setReceivedRoutingKey(ParserTopology.PARSER_RESULT_ROUTING_KEY);
        return new Message(body, properties);
    }

    private static ParserResultMessage result(final String jobId, final int attempt,
                                              final ParserSourceOutcome outcome) {
        return new ParserResultMessage("1", "evt-" + jobId, jobId, attempt, Instant.now(), List.of(outcome));
    }

    private ReplayJobAuthority authority() {
        return new ReplayJobAuthority(jdbc, transactions);
    }

    private static long revisionOf(final String jobId) {
        return jdbc.sql("select revision from replay_processing_job where job_id = :id")
                .param("id", jobId).query(Long.class).single();
    }

    private static int reportedAttempt(final String jobId) {
        return jdbc.sql("select reported_attempt from replay_processing_job where job_id = :id")
                .param("id", jobId).query(Integer.class).single();
    }

    private static ReplayProcessingJob.Status statusOf(final String jobId) {
        return ReplayProcessingJob.Status.valueOf(jdbc.sql("select status from replay_processing_job where job_id = :id")
                .param("id", jobId).query(String.class).single());
    }
}
