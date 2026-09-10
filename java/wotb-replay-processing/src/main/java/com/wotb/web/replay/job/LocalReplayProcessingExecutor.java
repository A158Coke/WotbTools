package com.wotb.web.replay.job;

import com.wotb.contracts.ReplayProcessingRequest;
import com.wotb.contracts.ReplayProcessingSource;
import com.wotb.core.model.Battle;
import com.wotb.core.model.Source;
import com.wotb.core.parse.Replays;
import com.wotb.core.replay.processing.DefaultReplayProcessingFacade;
import com.wotb.core.replay.processing.ReplayProcessingLifecycle;
import com.wotb.core.replay.processing.ReplayProcessingOptions;
import com.wotb.core.replay.processing.ReplayProcessingResult;
import com.wotb.core.replay.processing.ReplayProcessingSourceOutcome;
import com.wotb.web.replay.ai.BattlePlaybackProjector;
import com.wotb.web.replay.ai.MapOverviewBuilder;
import com.wotb.web.replay.dto.BattlePlaybackDataset;
import io.micrometer.core.instrument.MeterRegistry;
import io.micrometer.core.instrument.Timer;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;
import org.springframework.util.StringUtils;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;

/** Executes one value-addressed source and writes its deterministic derived artifacts. */
@Component
public class LocalReplayProcessingExecutor {

    private static final Logger LOGGER = LoggerFactory.getLogger(LocalReplayProcessingExecutor.class);
    private final DefaultReplayProcessingFacade processingFacade;
    private final Path processingJobRoot;
    private final ReplayProcessingLifecycle lifecycle;
    private final MeterRegistry meterRegistry;
    private final ReplayProcessingCancellationRegistry cancellationRegistry;

    @Autowired
    public LocalReplayProcessingExecutor(
            final DefaultReplayProcessingFacade processingFacade,
            @Value("${wotb.replay.processing-job.dir:${java.io.tmpdir}/wotb-replay-processing-jobs}")
            final String processingJobDir,
            final ReplayProcessingLifecycle lifecycle,
            @Autowired(required = false) final MeterRegistry meterRegistry,
            final ReplayProcessingCancellationRegistry cancellationRegistry) {
        this(processingFacade, Path.of(processingJobDir), lifecycle, meterRegistry, cancellationRegistry);
    }

    /** Test constructor. */
    public LocalReplayProcessingExecutor(final DefaultReplayProcessingFacade processingFacade,
                                         final Path processingJobRoot,
                                         final ReplayProcessingLifecycle lifecycle,
                                         final MeterRegistry meterRegistry) {
        this(processingFacade, processingJobRoot, lifecycle, meterRegistry,
                new ReplayProcessingCancellationRegistry());
    }

    LocalReplayProcessingExecutor(final DefaultReplayProcessingFacade processingFacade,
                                  final Path processingJobRoot,
                                  final ReplayProcessingLifecycle lifecycle,
                                  final MeterRegistry meterRegistry,
                                  final ReplayProcessingCancellationRegistry cancellationRegistry) {
        this.processingFacade = processingFacade;
        this.processingJobRoot = processingJobRoot;
        this.lifecycle = lifecycle;
        this.meterRegistry = meterRegistry;
        this.cancellationRegistry = cancellationRegistry;
    }

    public void process(final ReplayProcessingRequest request, final int sourceIndex) {
        final ReplayProcessingSource source = request.sources().stream()
                .filter(candidate -> candidate.sourceIndex() == sourceIndex)
                .findFirst().orElseThrow(() -> new IllegalArgumentException("SOURCE_NOT_FOUND"));
        if (cancellationRegistry.isCancelled(request.jobId())) {
            return;
        }
        lifecycle.sourceStarted(request.jobId(), sourceIndex, source.sourceName());
        Replays.ParsedEntry entry;
        boolean success = false;
        try {
            final Path input = processingJobRoot.resolve(request.jobId()).resolve("input")
                    .resolve(sourceIndex + "__" + source.sourceName());
            final ReplayProcessingResult result = processFullResultTracked(
                    new Source(source.sourceName(), Files.readAllBytes(input)));
            writeArtifacts(request.jobId(), sourceIndex, source.sourceName(), result.battle(), result);
            entry = new Replays.ParsedEntry(sourceIndex, source.sourceName(), result.battle(), null);
            success = true;
        } catch (final IOException e) {
            LOGGER.warn("event=processing_job_storage_failed jobId={} sourceIndex={} sourceName={}",
                    request.jobId(), sourceIndex, source.sourceName(), e);
            entry = new Replays.ParsedEntry(sourceIndex, source.sourceName(), null,
                    "PROCESSING_JOB_STORAGE_UNAVAILABLE");
        } catch (final Exception e) {
            final String errorCode = e instanceof ReplayProcessingSourceException sourceError
                    ? sourceError.errorCode() : "REPLAY_PROCESSING_FAILED";
            final String message = StringUtils.hasText(e.getMessage()) ? e.getMessage() : errorCode;
            final String failure = errorCode.equals(message) ? errorCode : errorCode + ": " + message;
            LOGGER.warn("event=processing_job_source_failed jobId={} sourceIndex={} sourceName={} errorCode={} error={}",
                    request.jobId(), sourceIndex, source.sourceName(), errorCode, message);
            entry = new Replays.ParsedEntry(sourceIndex, source.sourceName(), null, failure);
        }
        lifecycle.sourceCompleted(new ReplayProcessingSourceOutcome(
                request.jobId(), sourceIndex, source.sourceName(), entry, success));
    }

    private ReplayProcessingResult processFullResultTracked(final Source source) {
        if (meterRegistry == null) return processFullResult(source);
        final Timer.Sample sample = Timer.start(meterRegistry);
        try {
            return processFullResult(source);
        } finally {
            sample.stop(Timer.builder("wotb_replay_processing_file_duration_seconds")
                    .description("单个 replay full processing 耗时").publishPercentileHistogram()
                    .register(meterRegistry));
        }
    }

    private ReplayProcessingResult processFullResult(final Source source) {
        final ReplayProcessingResult result = processingFacade.process(source, ReplayProcessingOptions.full());
        if (meterRegistry != null) meterRegistry.counter("wotb_replay_full_processing_total").increment();
        if (result.battle() == null) {
            final String code = result.error() != null && StringUtils.hasText(result.error().code())
                    ? result.error().code() : "REPLAY_PROCESSING_FAILED";
            final String message = result.error() != null && StringUtils.hasText(result.error().message())
                    ? result.error().message() : "REPLAY_PROCESSING_FAILED";
            throw new ReplayProcessingSourceException(code, message);
        }
        return result;
    }

    private void writeArtifacts(final String jobId, final int sourceIndex, final String sourceName,
                                final Battle battle, final ReplayProcessingResult result) throws IOException {
        final Path jobDir = processingJobRoot.resolve(jobId);
        ReplayArtifactWriter.writeMapOverview(jobDir, sourceIndex, MapOverviewBuilder.build(battle, result.reconstruction()));
        final V2BuildOutcome v2 = buildBattlePlaybackV2(battle, result);
        if (v2.dataset() != null) {
            ReplayArtifactWriter.writeBattlePlaybackV2(jobDir, sourceIndex, v2.dataset());
            LOGGER.info("event=processing_job_v2_available jobId={} sourceIndex={} sourceName={}",
                    jobId, sourceIndex, sourceName);
        } else if (v2.failure() != null) {
            LOGGER.error("event=processing_job_v2_error jobId={} sourceIndex={} sourceName={} reason={}",
                    jobId, sourceIndex, sourceName, v2.reason(), v2.failure());
        } else {
            LOGGER.info("event=processing_job_v2_unavailable jobId={} sourceIndex={} sourceName={} reason={}",
                    jobId, sourceIndex, sourceName, v2.reason());
        }
        ReplayArtifactWriter.writeAiFacts(jobDir, sourceIndex, result);
    }

    static V2BuildOutcome buildBattlePlaybackV2(final Battle battle, final ReplayProcessingResult result) {
        if (battle == null || result == null || result.reconstruction() == null) return V2BuildOutcome.unavailable("NO_RECONSTRUCTION");
        final var recorder = battle.recorderResult();
        if (recorder == null) return V2BuildOutcome.unavailable("RECORDER_MISSING");
        final com.wotb.core.replay.timeline.BattleTimelineResult timeline;
        try {
            timeline = com.wotb.core.replay.timeline.BattleTimelineBuilder.build(battle, result.reconstruction(),
                    com.wotb.core.replay.timeline.TimelinePerspective.personal(
                            recorder.accountId > 0 ? recorder.accountId : null, recorder.team));
        } catch (final RuntimeException e) {
            return V2BuildOutcome.error("TIMELINE_BUILD_ERROR", e);
        }
        if (timeline == null || !timeline.usable()) return V2BuildOutcome.unavailable("TIMELINE_NOT_USABLE");
        try {
            final var mapping = com.wotb.core.replay.processing.TeamEntityMapper.resolve(battle, result.reconstruction());
            final BattlePlaybackDataset dataset = BattlePlaybackProjector.project(battle, timeline.timeline(), mapping,
                    recorder.accountId > 0 ? recorder.accountId : null);
            return dataset == null ? V2BuildOutcome.unavailable("PROJECTION_EMPTY") : V2BuildOutcome.available(dataset);
        } catch (final RuntimeException e) {
            return V2BuildOutcome.error("PROJECTOR_ERROR", e);
        }
    }

    record V2BuildOutcome(BattlePlaybackDataset dataset, String reason, RuntimeException failure) {
        static V2BuildOutcome available(final BattlePlaybackDataset dataset) { return new V2BuildOutcome(dataset, null, null); }
        static V2BuildOutcome unavailable(final String reason) { return new V2BuildOutcome(null, reason, null); }
        static V2BuildOutcome error(final String reason, final RuntimeException failure) { return new V2BuildOutcome(null, reason, failure); }
    }

    private static final class ReplayProcessingSourceException extends RuntimeException {
        private final String errorCode;
        ReplayProcessingSourceException(final String errorCode, final String message) { super(message); this.errorCode = errorCode; }
        String errorCode() { return errorCode; }
    }
}
