package com.wotb.web.replay.controller;

import com.wotb.core.processing.DefaultReplayProcessingFacade;
import com.wotb.web.replay.MapOverviewQueryService;
import com.wotb.web.replay.ReplayLegacyEndpoints;
import com.wotb.web.replay.ai.AiReplayReviewService;
import com.wotb.web.replay.ai.AiReviewWorkerExecutor;
import com.wotb.web.replay.ai.gateway.AiCancellationRegistry;
import com.wotb.web.replay.job.ReplayExportJobService;
import com.wotb.web.replay.job.ReplayParseScheduler;
import com.wotb.web.replay.service.ReplayService;
import org.junit.jupiter.api.Test;
import org.springframework.http.HttpStatus;
import org.springframework.mock.web.MockMultipartFile;
import org.springframework.web.multipart.MultipartFile;
import org.springframework.web.server.ResponseStatusException;

import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicInteger;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verifyNoInteractions;

/**
 * BLOCKER 2 架构/契约测试：ReplayParseScheduler 是唯一 full-processing CPU budget
 * authority——public/anonymous 与 authenticated 的 legacy 同步端点一律稳定 410
 * {@code REPLAY_LEGACY_DEPRECATED}，绝不创建 scheduler 之外的 full processing；
 * 控制器/服务不再持有 processingFacade，不存在第二套 ReplayCapacityLimiter 并行
 * 处理同一 Replay Processing 产品域。
 */
class ReplayLegacyEndpointContractTest {

    private static final String GONE = ReplayLegacyEndpoints.DEPRECATED_ERROR;

    @FunctionalInterface
    private interface ThrowingRunnable {
        void run() throws Exception;
    }

    private static ResponseStatusException goneOf(final ThrowingRunnable call) {
        final ResponseStatusException e = assertThrows(ResponseStatusException.class, () -> {
            try {
                call.run();
            } catch (final ResponseStatusException ex) {
                throw ex;
            } catch (final Exception ex) {
                throw new RuntimeException(ex);
            }
        });
        assertEquals(HttpStatus.GONE, e.getStatusCode());
        assertEquals(GONE, e.getReason(), "legacy 端点必须返回稳定废弃错误码");
        return e;
    }

    @Test
    void anonymousPreviewAndExportReturnStableGoneWithoutServiceCall() {
        final ReplayService service = mock(ReplayService.class);
        final ReplayController controller = new ReplayController(service);
        final MultipartFile[] files = new MultipartFile[0];

        goneOf(() -> controller.preview(files));
        goneOf(() -> controller.export(files, "aggregate"));
        verifyNoInteractions(service);
    }

    @Test
    void authenticatedLegacyEndpointsReturnStableGoneWithoutAnyFullProcessing() {
        final AiReplayReviewService reviewService = mock(AiReplayReviewService.class);
        final AiCancellationRegistry registry = mock(AiCancellationRegistry.class);
        final AiReviewWorkerExecutor workerExecutor = mock(AiReviewWorkerExecutor.class);
        final MapOverviewQueryService mapOverviewService = mock(MapOverviewQueryService.class);
        final ReconstructionController controller = new ReconstructionController(
                reviewService, registry, workerExecutor, mapOverviewService);
        final MultipartFile[] files = new MultipartFile[0];

        goneOf(() -> controller.analyze(files, "zh", null));
        goneOf(() -> controller.reconstructBatch(files));
        goneOf(() -> controller.process(files, true));
        goneOf(() -> controller.mapOverview(files));
        // analyze multipart 不得走到 reviewService；map-overview multipart 不得走到 query service。
        verifyNoInteractions(reviewService, registry, workerExecutor, mapOverviewService);
    }

    @Test
    void exportJobWithoutProcessingJobIdReturnsStableGone() {
        final ReplayExportJobService service = new ReplayExportJobService(null, null, null, null);
        final ResponseStatusException e = assertThrows(ResponseStatusException.class,
                () -> service.createJob(new MultipartFile[]{file()}, "aggregate", null, (String) null));
        assertEquals(HttpStatus.GONE, e.getStatusCode());
        assertEquals(GONE, e.getReason());
    }

    @Test
    void publicReplayControllersDoNotHoldProcessingFacade() {
        for (final Class<?> c : List.of(ReplayController.class, ReconstructionController.class, ReplayService.class)) {
            assertFalse(Arrays.stream(c.getDeclaredFields())
                            .anyMatch(f -> f.getType() == DefaultReplayProcessingFacade.class),
                    c.getSimpleName() + " 不得直接依赖 processingFacade（full processing 唯一入口 = ReplayParseScheduler）");
        }
    }

    @Test
    void legacyFullProcessingMethodsAreRemovedFromProductionSurface() {
        assertNoMethod(ReplayService.class, "preview");
        assertNoMethod(ReplayService.class, "export");
        assertNoMethod(AiReplayReviewService.class, "analyzeStreaming");
        assertNoMethod(MapOverviewQueryService.class, "buildOverview");
    }

    @Test
    void concurrentLegacyCallsAllReturnGoneAndSchedulerStaysIdle() throws Exception {
        final ReplayController replayController = new ReplayController(mock(ReplayService.class));
        final ReconstructionController reconController = new ReconstructionController(
                mock(AiReplayReviewService.class),
                mock(AiCancellationRegistry.class),
                mock(AiReviewWorkerExecutor.class),
                mock(MapOverviewQueryService.class));
        final ReplayExportJobService exportService = new ReplayExportJobService(null, null, null, null);
        final ReplayParseScheduler scheduler = new ReplayParseScheduler(2, 200);
        try {
            final int calls = 200;
            final int endpoints = 6;
            final CountDownLatch start = new CountDownLatch(1);
            final AtomicInteger gone = new AtomicInteger();
            final ExecutorService pool = Executors.newFixedThreadPool(8);
            final List<Future<?>> futures = new ArrayList<>();
            final MultipartFile[] files = new MultipartFile[0];
            for (int i = 0; i < calls; i++) {
                futures.add(pool.submit(() -> {
                    start.await();
                    try {
                        replayController.preview(files);
                    } catch (final ResponseStatusException e) {
                        if (isGone(e)) gone.incrementAndGet();
                    }
                    try {
                        replayController.export(files, "aggregate");
                    } catch (final ResponseStatusException e) {
                        if (isGone(e)) gone.incrementAndGet();
                    }
                    try {
                        reconController.analyze(files, "zh", null);
                    } catch (final ResponseStatusException e) {
                        if (isGone(e)) gone.incrementAndGet();
                    }
                    try {
                        reconController.reconstructBatch(files);
                    } catch (final ResponseStatusException e) {
                        if (isGone(e)) gone.incrementAndGet();
                    }
                    try {
                        reconController.process(files, false);
                    } catch (final ResponseStatusException e) {
                        if (isGone(e)) gone.incrementAndGet();
                    }
                    try {
                        exportService.createJob(files, "aggregate", null, (String) null);
                    } catch (final ResponseStatusException e) {
                        if (isGone(e)) gone.incrementAndGet();
                    }
                    return null;
                }));
            }
            start.countDown();
            for (final Future<?> f : futures) {
                f.get(15, TimeUnit.SECONDS);
            }
            pool.shutdown();
            assertTrue(pool.awaitTermination(10, TimeUnit.SECONDS));
            assertEquals((long) calls * endpoints, gone.get(),
                    "并发调用不同 replay API 时全部必须稳定 410（零 full processing 进入 scheduler 之外）");
            assertEquals(0, scheduler.activeSources(), "scheduler 不得被 legacy 调用激活");
            assertEquals(0, scheduler.queuedSources());
            assertEquals(0, scheduler.queuedJobs());
        } finally {
            scheduler.close();
        }
    }

    private static boolean isGone(final ResponseStatusException e) {
        return e.getStatusCode() == HttpStatus.GONE && GONE.equals(e.getReason());
    }

    private static void assertNoMethod(final Class<?> type, final String name) {
        assertFalse(Arrays.stream(type.getMethods()).anyMatch(m -> m.getName().equals(name)),
                type.getSimpleName() + "." + name + "() 已随 legacy 端点删除");
    }

    private static MultipartFile file() {
        return new MockMultipartFile("files", "a.wotbreplay", "application/octet-stream", new byte[]{1});
    }
}
