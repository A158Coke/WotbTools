package com.wotb.web.replay.job;

import com.wotb.contracts.ReplayProcessingRequest;
import com.wotb.contracts.ReplayProcessingSource;
import com.wotb.core.model.Source;
import com.wotb.core.parse.Replays;
import com.wotb.core.replay.processing.DefaultReplayProcessingFacade;
import com.wotb.core.replay.processing.ReplayProcessingLifecycle;
import com.wotb.core.replay.processing.ReplayProcessingOptions;
import com.wotb.core.replay.processing.ReplayProcessingResult;
import com.wotb.core.replay.processing.ReplayProcessingSourceOutcome;
import io.micrometer.core.instrument.MeterRegistry;
import io.micrometer.core.instrument.Timer;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.List;

/**
 * 本地（单 JVM）worker 适配：从 job 目录读输入字节，把 canonical 解析与 artifact 生成交给存储无关的
 * {@link ReplayProcessingSourceRunner}，artifact 落到 {@link ReplayArtifactFileSink}。
 *
 * <p>执行体本身（含错误分类）在 runner；本类只保留本地特有的四件事：job 目录布局、取消登记表
 * （{@code ReplayProcessingCancellationRegistry}）、Micrometer 采集、以及本地输入读取失败的既有
 * error code（{@code PROCESSING_JOB_STORAGE_UNAVAILABLE}）。</p>
 */
@Component
public class LocalReplayProcessingExecutor {

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
        final List<ReplayProcessingSource> sources = request.sources();
        final String sourceName = sources.stream()
                .filter(candidate -> candidate.sourceIndex() == sourceIndex)
                .map(ReplayProcessingSource::sourceName)
                .findFirst().orElseThrow(() -> new IllegalArgumentException("SOURCE_NOT_FOUND"));
        if (cancellationRegistry.isCancelled(request.jobId())) {
            return;
        }
        final byte[] replayBytes;
        try {
            final Path input = processingJobRoot.resolve(request.jobId()).resolve("input")
                    .resolve(sourceIndex + "__" + sourceName);
            replayBytes = Files.readAllBytes(input);
        } catch (final IOException e) {
            // 输入读取失败发生在 canonical 解析之前（本地 job 目录特有），保持既有 error code。
            lifecycle.sourceStarted(request.jobId(), sourceIndex, sourceName);
            lifecycle.sourceCompleted(new ReplayProcessingSourceOutcome(
                    request.jobId(), sourceIndex, sourceName,
                    new Replays.ParsedEntry(sourceIndex, sourceName, null,
                            ReplayProcessingSourceRunner.failureMessage(
                                    request.jobId(), sourceIndex, sourceName, e)),
                    false));
            return;
        }
        runner(request.jobId()).processSource(request.jobId(), sourceIndex, sourceName,
                trackedProcessing(sourceName, replayBytes));
    }

    /**
     * sink 绑定到<b>本次 job 目录</b>（{@code <root>/<jobId>/derived/r<index>}，与输入布局
     * {@code <root>/<jobId>/input} 同级）；runner 本身无状态。
     */
    private ReplayProcessingSourceRunner runner(final String jobId) {
        return new ReplayProcessingSourceRunner(
                new ReplayArtifactFileSink(processingJobRoot.resolve(jobId)), lifecycle);
    }

    /** canonical 解析 + Micrometer 计时/计数（指标语义不变，只覆盖 facade 调用）。 */
    private java.util.function.Supplier<ReplayProcessingResult> trackedProcessing(final String sourceName,
                                                                                 final byte[] replayBytes) {
        return () -> {
            if (meterRegistry == null) {
                return ReplayProcessingSourceRunner.requireBattle(processingFacade.process(
                        new Source(sourceName, replayBytes), ReplayProcessingOptions.full()));
            }
            final Timer.Sample sample = Timer.start(meterRegistry);
            try {
                return ReplayProcessingSourceRunner.requireBattle(processingFacade.process(
                        new Source(sourceName, replayBytes), ReplayProcessingOptions.full()));
            } finally {
                sample.stop(Timer.builder("wotb_replay_processing_file_duration_seconds")
                        .description("单个 replay full processing 耗时").publishPercentileHistogram()
                        .register(meterRegistry));
                meterRegistry.counter("wotb_replay_full_processing_total").increment();
            }
        };
    }
}
