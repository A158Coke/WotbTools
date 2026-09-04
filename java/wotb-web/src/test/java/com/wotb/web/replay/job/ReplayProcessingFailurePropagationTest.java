package com.wotb.web.replay.job;

import com.wotb.core.model.Source;
import com.wotb.core.replay.processing.DefaultReplayProcessingFacade;
import com.wotb.core.replay.processing.ReplayProcessingCapabilities;
import com.wotb.core.replay.processing.ReplayProcessingDiagnostics;
import com.wotb.core.replay.processing.ReplayProcessingError;
import com.wotb.core.replay.processing.ReplayProcessingOptions;
import com.wotb.core.replay.processing.ReplayProcessingResult;
import com.wotb.core.replay.processing.ReplayProcessingStatus;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.mock.web.MockMultipartFile;
import org.springframework.web.multipart.MultipartFile;

import java.nio.file.Files;
import java.nio.file.Path;
import java.util.concurrent.TimeUnit;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

/** Regression for facade FAILED results losing their source-level error details. */
class ReplayProcessingFailurePropagationTest {

    private Path tmpDir;
    private ReplayProcessingJobStore store;
    private ReplayParseScheduler scheduler;
    private DefaultReplayProcessingFacade facade;
    private ReplayProcessingJobService service;

    @BeforeEach
    void setUp() throws Exception {
        tmpDir = Files.createTempDirectory("wotb-processing-failure-propagation-test");
        store = new ReplayProcessingJobStore(tmpDir, 60);
        scheduler = new ReplayParseScheduler(1, 20);
        facade = mock(DefaultReplayProcessingFacade.class);
        service = new ReplayProcessingJobService(facade, store, scheduler, null);
    }

    @AfterEach
    void tearDown() throws Exception {
        scheduler.close();
        store.close();
        if (tmpDir != null && Files.exists(tmpDir)) {
            try (var paths = Files.walk(tmpDir)) {
                paths.sorted(java.util.Comparator.reverseOrder())
                        .forEach(path -> {
                            try {
                                Files.deleteIfExists(path);
                            } catch (Exception ignored) {
                                // best-effort test cleanup
                            }
                        });
            }
        }
    }

    @Test
    void facadeFailedResultPreservesStructuredSourceError() throws Exception {
        when(facade.process(any(Source.class), eq(ReplayProcessingOptions.full())))
                .thenReturn(new ReplayProcessingResult(
                        "11.20.wotbreplay",
                        ReplayProcessingStatus.FAILED,
                        null,
                        null,
                        null,
                        ReplayProcessingDiagnostics.summaryOnly(false),
                        ReplayProcessingCapabilities.NONE,
                        ReplayProcessingError.of(
                                "SUMMARY_PARSE_FAILED",
                                "Invalid replay data: dead combatant settlement invariant"),
                        null));

        final String jobId = service.createJob(new MultipartFile[]{
                new MockMultipartFile(
                        "files",
                        "11.20.wotbreplay",
                        "application/octet-stream",
                        new byte[]{1, 2, 3})
        });

        final ReplayProcessingJob.Snapshot snapshot = awaitTerminal(jobId);

        assertEquals(ReplayProcessingJob.Status.FAILED, snapshot.status());
        assertEquals("NO_VALID_REPLAYS", snapshot.errorCode(),
                "batch-level zero-valid contract remains stable");
        assertEquals(1, snapshot.parseFailed());
        assertEquals(0, snapshot.parseSucceeded());
        assertEquals(1, snapshot.sources().size());

        final ReplayProcessingJob.SourceState source = snapshot.sources().getFirst();
        assertEquals(ReplayProcessingJob.SourceStatus.FAILED, source.status());
        assertTrue(source.failureMessage().contains("SUMMARY_PARSE_FAILED"),
                "source failure must retain the facade error code");
        assertTrue(source.failureMessage().contains("Invalid replay data"),
                "source failure must retain the facade diagnostic message");
    }

    private ReplayProcessingJob.Snapshot awaitTerminal(final String jobId) throws Exception {
        final long deadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(10);
        while (System.nanoTime() < deadline) {
            final ReplayProcessingJob.Snapshot snapshot = service.status(jobId);
            if (snapshot.status() == ReplayProcessingJob.Status.READY
                    || snapshot.status() == ReplayProcessingJob.Status.FAILED
                    || snapshot.status() == ReplayProcessingJob.Status.CANCELLED) {
                return snapshot;
            }
            Thread.sleep(10);
        }
        throw new AssertionError("processing job did not reach a terminal state");
    }
}
