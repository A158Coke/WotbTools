package com.wotb.parserworker.worker;

import com.wotb.broker.rabbitmq.ParserFailedMessage;
import com.wotb.broker.rabbitmq.ParserMessageCodec;
import com.wotb.broker.rabbitmq.ParserRequestMessage;
import com.wotb.broker.rabbitmq.ParserRequestSource;
import com.wotb.broker.rabbitmq.ParserResultMessage;
import com.wotb.broker.rabbitmq.ParserSourceOutcome;
import com.wotb.broker.rabbitmq.ParserSourceStatus;
import com.wotb.contracts.ObjectKey;
import com.wotb.contracts.ObjectStorage;
import com.wotb.core.model.Source;
import com.wotb.core.replay.processing.DefaultReplayProcessingFacade;
import com.wotb.core.replay.processing.ReplayProcessingLifecycle;
import com.wotb.core.replay.processing.ReplayProcessingOptions;
import com.wotb.core.replay.processing.ReplayProcessingResult;
import com.wotb.core.replay.processing.ReplayProcessingSourceOutcome;
import com.wotb.storage.ObjectStorageKeys;
import com.wotb.web.replay.job.ReplayProcessingSourceRunner;
import io.micrometer.core.instrument.MeterRegistry;
import io.micrometer.core.instrument.Timer;
import java.io.ByteArrayInputStream;
import java.io.IOException;
import java.io.InputStream;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.Objects;
import java.util.UUID;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

/**
 * Handles one decoded {@code parser.request}: read every source from object storage, run the
 * canonical parser, persist the derived artifacts and the canonical dataset, then publish the
 * confirmed outcome envelope.
 *
 * <p>This class owns no transport or acknowledgement semantics: it publishes an outcome, parks an
 * undecodable delivery, or throws. {@link ParserRequestListener} turns a normal return into
 * {@code basicAck} and a throw into {@code basicNack(requeue=false)}.</p>
 *
 * <p><b>Error split.</b> A source whose canonical parse fails is a <em>business</em> failure: the
 * outcome envelope reports {@code FAILED} with the stable error code and the request is
 * acknowledged — retrying the same bytes cannot change the result. Infrastructure failures (object
 * storage unavailable, broker confirmation lost) throw, so the existing retry/DLQ topology decides
 * what happens next; the worker keeps no retry state machine of its own.</p>
 *
 * <p><b>Statelessness.</b> No job state is cached. A redelivered request re-runs every source of
 * the envelope, and every write is an idempotent overwrite because the keys are derived purely from
 * {@code (jobId, sourceIndex)}.</p>
 */
public class ParserRequestHandler {

    private static final Logger LOG = LoggerFactory.getLogger(ParserRequestHandler.class);

    /** Content type of every JSON object this handler writes. */
    private static final String CONTENT_TYPE = "application/json";

    /** Input prefix below the job directory; the full layout is owned by ObjectStorageKeys. */
    private static final String INPUT_PREFIX = "input/";

    /** Dataset prefix below the job directory. */
    private static final String RESULT_PREFIX = "result/source-";

    /**
     * The canonical runner's stable code for a sink {@code IOException} (see
     * {@code ReplayProcessingSourceRunner.failureMessage}). The runner collapses the exception into
     * its error code, so the code is the only handle the worker has on "the write failed, the replay
     * was fine" — and that distinction is the whole difference between a retryable infrastructure
     * failure and a terminal per-source verdict.
     */
    static final String STORAGE_UNAVAILABLE_CODE = "PROCESSING_JOB_STORAGE_UNAVAILABLE";

    private final ObjectStorage storage;
    private final DefaultReplayProcessingFacade processingFacade;
    private final ReplayProcessingLifecycle lifecycle;
    private final RabbitParserOutcomePublisher outcomePublisher;
    private final MeterRegistry meterRegistry;

    public ParserRequestHandler(final ObjectStorage storage,
                                final DefaultReplayProcessingFacade processingFacade,
                                final ReplayProcessingLifecycle lifecycle,
                                final RabbitParserOutcomePublisher outcomePublisher,
                                final MeterRegistry meterRegistry) {
        this.storage = Objects.requireNonNull(storage, "storage");
        this.processingFacade = Objects.requireNonNull(processingFacade, "processingFacade");
        this.lifecycle = Objects.requireNonNull(lifecycle, "lifecycle");
        this.outcomePublisher = Objects.requireNonNull(outcomePublisher, "outcomePublisher");
        this.meterRegistry = meterRegistry;
    }

    /**
     * Processes one request and publishes its outcome.
     *
     * @throws IOException                   object storage is unavailable (infrastructure failure)
     * @throws ParserOutcomePublishException the outcome did not reach a confirmed broker state
     */
    public void handle(final ParserRequestMessage request) throws IOException {
        final ParserRequestMessage envelope = Objects.requireNonNull(request, "request");
        final String jobId = envelope.jobId();
        final ReplayProcessingSourceRunner runner =
                new ReplayProcessingSourceRunner(new ParserArtifactSink(storage, jobId), lifecycle);
        final List<ParserSourceOutcome> outcomes = new ArrayList<>();
        for (final ParserRequestSource source : envelope.sources()) {
            outcomes.add(processSource(runner, jobId, source.sourceIndex(), source.sourceName()));
        }
        outcomePublisher.publishResult(new ParserResultMessage(
                ParserMessageCodec.SCHEMA_VERSION,
                UUID.randomUUID().toString(),
                jobId,
                envelope.attempt(),
                Instant.now(),
                outcomes));
    }

    /**
     * Reports a whole-attempt failure that produced no per-source outcome (for example the worker
     * could not reach object storage). The caller publishes it before rejecting the request, so the
     * control plane learns <em>why</em> the rejected delivery exists instead of finding a job that
     * silently stalled.
     *
     * @param retryable the worker's own judgement, and it must agree with what the caller does next:
     *                  a retryable failure is rejected without requeue, so the request re-enters the
     *                  broker-side retry loop, while a terminal one is parked on the DLQ. Reporting
     *                  {@code false} for a delivery that is being retried would tell the control
     *                  plane the attempt is final while the broker keeps re-delivering it.
     */
    public void publishFailed(final ParserRequestMessage request, final String errorCode,
                              final boolean retryable) {
        final ParserRequestMessage envelope = Objects.requireNonNull(request, "request");
        outcomePublisher.publishFailed(new ParserFailedMessage(
                ParserMessageCodec.SCHEMA_VERSION,
                UUID.randomUUID().toString(),
                envelope.jobId(),
                envelope.attempt(),
                Instant.now(),
                errorCode,
                retryable));
    }

    /**
     * Parks a delivery the worker calls terminal on the DLQ path, verbatim.
     *
     * <p>Two failures are terminal for the worker: a body it cannot decode (no {@code jobId} or
     * {@code attempt} exists to report, and re-delivering the same bytes can never succeed), and a
     * request whose report could not be delivered (the transport redelivers it, but the raw delivery
     * is parked so an operator can see what never settled). Both preserve the original bytes so an
     * operator can diagnose the delivery and re-publish it deliberately.</p>
     */
    public void parkTerminalRequest(final byte[] rawBody) {
        outcomePublisher.parkTerminal(Objects.requireNonNull(rawBody, "rawBody"));
    }

    /**
     * The wire code for every infrastructure <em>work</em> failure: the worker could not reach the
     * object storage a source needs, on a read or on an artifact write. It is deliberately the only
     * one — outcome publish uncertainty is not a work failure and must never be reported as another
     * semantic outcome (see {@code ParserRequestListener}).
     */
    public static final String STORAGE_UNAVAILABLE_WIRE_CODE = "PARSER_WORKER_STORAGE_UNAVAILABLE";

    /**
     * Reads one source from object storage and runs the canonical parser into the worker's
     * object-storage artifact sink.
     */
    private ParserSourceOutcome processSource(final ReplayProcessingSourceRunner runner,
                                              final String jobId,
                                              final int sourceIndex,
                                              final String sourceName) throws IOException {
        final byte[] replayBytes;
        try (InputStream stream = storage.get(inputKey(jobId, sourceIndex, sourceName))) {
            replayBytes = stream.readAllBytes();
        }
        LOG.info("event=parser_worker_input_read jobId={} sourceIndex={} bytes={}",
                jobId, sourceIndex, replayBytes.length);

        final ReplayProcessingSourceOutcome outcome = runner.processSource(
                jobId, sourceIndex, sourceName,
                () -> ReplayProcessingSourceRunner.requireBattle(
                        trackedProcessing(sourceName, replayBytes)));
        if (outcome.entry().failed()) {
            final String code = errorCode(outcome.entry().failureMessage());
            if (STORAGE_UNAVAILABLE_CODE.equals(code)) {
                // The replay was readable and the parse succeeded; only the artifact write failed.
                // That is infrastructure, not a property of the bytes, so it must leave through the
                // retryable parser.failed path instead of becoming a terminal per-source FAILED.
                LOG.error("event=parser_worker_artifact_storage_failed jobId={} sourceIndex={} sourceName={}",
                        jobId, sourceIndex, sourceName);
                throw new ParserArtifactStorageException(code, outcome.entry().failureMessage());
            }
            LOG.warn("event=parser_worker_source_failed jobId={} sourceIndex={} sourceName={} failure={}",
                    jobId, sourceIndex, sourceName, outcome.entry().failureMessage());
            return new ParserSourceOutcome(sourceIndex, sourceName, ParserSourceStatus.FAILED, code);
        }
        writeDataset(jobId, sourceIndex, sourceName, outcome);
        return new ParserSourceOutcome(sourceIndex, sourceName, ParserSourceStatus.READY, null);
    }

    /**
     * Canonical parse with the same Micrometer semantics the local control plane uses for one replay
     * file: the timer covers the facade call only.
     */
    private ReplayProcessingResult trackedProcessing(final String sourceName, final byte[] replayBytes) {
        final Source source = new Source(sourceName, replayBytes);
        if (meterRegistry == null) {
            return processingFacade.process(source, ReplayProcessingOptions.full());
        }
        final Timer.Sample sample = Timer.start(meterRegistry);
        try {
            return processingFacade.process(source, ReplayProcessingOptions.full());
        } finally {
            sample.stop(Timer.builder("wotb_replay_processing_file_duration_seconds")
                    .description("单个 replay full processing 耗时").publishPercentileHistogram()
                    .register(meterRegistry));
            meterRegistry.counter("wotb_replay_full_processing_total").increment();
        }
    }

    /**
     * Persists the canonical per-source dataset (PR F reads it; the local control plane keeps the
     * equivalent {@code ProcessedDataset} in memory).
     *
     * <p>Written only after the artifact sink returned, so a READY outcome always means every object
     * of that source exists. Like the artifacts it is an idempotent overwrite.</p>
     */
    private void writeDataset(final String jobId,
                              final int sourceIndex,
                              final String sourceName,
                              final ReplayProcessingSourceOutcome outcome) throws IOException {
        final ParserSourceDataset dataset = new ParserSourceDataset(
                ParserSourceDataset.SCHEMA_VERSION,
                sourceIndex,
                sourceName,
                List.of(outcome.entry().battle()),
                List.of(sourceName),
                List.of(inputKey(jobId, sourceIndex, sourceName).value()),
                List.of(),
                List.of(),
                null,
                null);
        final byte[] body = dataset.toBytes();
        storage.put(ObjectStorageKeys.tempJobObject(jobId, RESULT_PREFIX + sourceIndex + ".json"),
                new ByteArrayInputStream(body), body.length, CONTENT_TYPE);
        LOG.info("event=parser_worker_dataset_written jobId={} sourceIndex={} bytes={}",
                jobId, sourceIndex, body.length);
    }

    private static ObjectKey inputKey(final String jobId, final int sourceIndex, final String sourceName) {
        return ObjectStorageKeys.tempJobObject(jobId, INPUT_PREFIX + sourceIndex + "/" + sourceName);
    }

    /**
     * Turns a failure message into the stable low-cardinality code of the wire contract: the runner
     * writes either {@code CODE} or {@code CODE: detail}.
     */
    static String errorCode(final String failureMessage) {
        if (failureMessage == null || failureMessage.isBlank()) {
            return "REPLAY_PROCESSING_FAILED";
        }
        final int separator = failureMessage.indexOf(": ");
        final String code = separator > 0 ? failureMessage.substring(0, separator) : failureMessage;
        return code.isBlank() ? "REPLAY_PROCESSING_FAILED" : code;
    }
}
