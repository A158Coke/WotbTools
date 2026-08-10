package com.wotb.web.replay.controller;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.doAnswer;
import static org.mockito.Mockito.doReturn;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.spy;
import static org.mockito.Mockito.timeout;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;

import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicReference;

import com.wotb.core.processing.DefaultReplayProcessingFacade;
import com.wotb.web.replay.ai.AiReplayAnalysisService;
import com.wotb.web.replay.ai.AiReplayReviewService;
import com.wotb.web.replay.ai.AiReviewWorkerExecutor;
import com.wotb.web.replay.ai.gateway.AiCancellationRegistry;
import com.wotb.web.replay.dto.AnalyzeResponse;
import com.wotb.web.replay.exception.AiReviewBusyException;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.mock.web.MockMultipartFile;
import org.springframework.web.multipart.MultipartFile;

/**
 * Worker saturation 与 queued cancellation 回归测试：
 * <ul>
 *   <li><b>#10 saturation</b>：workers=1, queue=1 → Task A 占 worker、Task B 进 queue、
 *       Task C 被拒绝（{@link AiReviewBusyException} 503），Task C 绝不在 caller/request
 *       thread 执行，cancellation registry 不泄漏；</li>
 *   <li><b>#11 queued cancellation</b>：Task A 占 worker、Task B 进 queue 后被取消 →
 *       Task B 获取 worker 后不调 {@code analyzeStreaming}（不继续 Replay parse），
 *       直接 complete emitter 并清理。</li>
 * </ul>
 */
class AiReviewWorkerSaturationTest {

    private DefaultReplayProcessingFacade processingFacade;
    private AiReplayAnalysisService aiService;
    private AiReplayReviewService reviewService;
    private AiCancellationRegistry cancellationRegistry;
    private AiReviewWorkerExecutor workerExecutor;
    private ReconstructionController controller;

    @BeforeEach
    void setUp() {
        processingFacade = mock(DefaultReplayProcessingFacade.class);
        aiService = mock(AiReplayAnalysisService.class);
        reviewService = spy(new AiReplayReviewService(processingFacade, aiService));
        cancellationRegistry = spy(new AiCancellationRegistry());
    }

    @AfterEach
    void tearDown() {
        if (workerExecutor != null) {
            workerExecutor.close();
        }
    }

    // ---- #10 worker saturation ----

    @Test
    void thirdRequestIsRejectedWhenOneWorkerAndOneQueueSlotAreFull() throws Exception {
        // workers=1, queue=1: max 2 tasks (1 running + 1 queued), 3rd rejected.
        workerExecutor = new AiReviewWorkerExecutor(1, 1);
        controller = new ReconstructionController(
                processingFacade, reviewService, cancellationRegistry, workerExecutor);

        // Task A occupies the single worker (blocking latch).
        final CountDownLatch taskAStarted = new CountDownLatch(1);
        final CountDownLatch releaseTaskA = new CountDownLatch(1);
        doAnswer(invocation -> {
            taskAStarted.countDown();
            releaseTaskA.await(10, TimeUnit.SECONDS);
            return new AnalyzeResponse("a");
        }).when(reviewService).analyzeStreaming(any(), any(), any());

        // Task A: occupies the worker.
        final ReconstructionControllerStreamingTest.RecordingEmitter emitterA =
                new ReconstructionControllerStreamingTest.RecordingEmitter(
                        ReconstructionController.SSE_TIMEOUT_MS);
        final ReconstructionController controllerSpyA = spy(controller);
        doReturn(emitterA).when(controllerSpyA).newAnalyzeEmitter();
        controllerSpyA.analyze(replayFiles(), "zh", "task-A");
        assertTrue(taskAStarted.await(5, TimeUnit.SECONDS), "Task A must start on the worker");

        // Task B: enters the queue (worker busy, queue has capacity=1).
        final ReconstructionControllerStreamingTest.RecordingEmitter emitterB =
                new ReconstructionControllerStreamingTest.RecordingEmitter(
                        ReconstructionController.SSE_TIMEOUT_MS);
        final ReconstructionController controllerSpyB = spy(controller);
        doReturn(emitterB).when(controllerSpyB).newAnalyzeEmitter();
        controllerSpyB.analyze(replayFiles(), "zh", "task-B");

        // Task C: workers + queue full → RejectedExecutionException → AiReviewBusyException.
        final ReconstructionControllerStreamingTest.RecordingEmitter emitterC =
                new ReconstructionControllerStreamingTest.RecordingEmitter(
                        ReconstructionController.SSE_TIMEOUT_MS);
        final ReconstructionController controllerSpyC = spy(controller);
        doReturn(emitterC).when(controllerSpyC).newAnalyzeEmitter();

        final AtomicReference<String> callerThreadName = new AtomicReference<>();
        final Thread testThread = Thread.currentThread();
        try {
            controllerSpyC.analyze(replayFiles(), "zh", "task-C");
            // If no exception, the task ran in the caller thread (CallerRunsPolicy bug).
            callerThreadName.set(testThread.getName());
        } catch (final AiReviewBusyException e) {
            // Expected: 503 AI_REVIEW_BUSY
            callerThreadName.set("rejected");
        }

        assertEquals("rejected", callerThreadName.get(),
                "Task C must be rejected with AiReviewBusyException, not run in caller thread");

        // Cancellation registry cleanup: rejected request must not leak.
        verify(cancellationRegistry, timeout(2000)).unregister("task-C");
        // The emitter for task-C must never have received events (no worker executed it).
        assertNull(emitterC.awaitEvent(500, TimeUnit.MILLISECONDS),
                "rejected task emitter must never receive events");

        // Release Task A so the test can clean up.
        releaseTaskA.countDown();
    }

    @Test
    void callerRunsPolicyMustNotExist() throws Exception {
        // AbortPolicy means RejectedExecutionException, not caller-thread execution.
        // This is implicitly verified by the saturation test above; here we verify
        // the executor type directly by checking that a 1/1 pool rejects the 3rd task.
        workerExecutor = new AiReviewWorkerExecutor(1, 1);
        controller = new ReconstructionController(
                processingFacade, reviewService, cancellationRegistry, workerExecutor);

        final CountDownLatch holdWorker = new CountDownLatch(1);
        doAnswer(invocation -> {
            holdWorker.await(10, TimeUnit.SECONDS);
            return new AnalyzeResponse("hold");
        }).when(reviewService).analyzeStreaming(any(), any(), any());

        // Occupy worker + queue.
        final ReconstructionController spyA = spy(controller);
        doReturn(new ReconstructionControllerStreamingTest.RecordingEmitter(
                ReconstructionController.SSE_TIMEOUT_MS)).when(spyA).newAnalyzeEmitter();
        spyA.analyze(replayFiles(), "zh", "occ-A");

        final ReconstructionController spyB = spy(controller);
        doReturn(new ReconstructionControllerStreamingTest.RecordingEmitter(
                ReconstructionController.SSE_TIMEOUT_MS)).when(spyB).newAnalyzeEmitter();
        spyB.analyze(replayFiles(), "zh", "occ-B");

        // Third submit must throw AiReviewBusyException (AbortPolicy), not run in caller.
        final ReconstructionController spyC = spy(controller);
        doReturn(new ReconstructionControllerStreamingTest.RecordingEmitter(
                ReconstructionController.SSE_TIMEOUT_MS)).when(spyC).newAnalyzeEmitter();
        assertThrows(AiReviewBusyException.class,
                () -> spyC.analyze(replayFiles(), "zh", "occ-C"));

        holdWorker.countDown();
    }

    // ---- #11 queued cancellation ----

    @Test
    void cancelledQueuedTaskDoesNotCallAnalyzeStreamingWhenPickedUp() throws Exception {
        // worker=1, queue=2: Task A occupies worker, Task B sits in queue.
        workerExecutor = new AiReviewWorkerExecutor(1, 2);
        controller = new ReconstructionController(
                processingFacade, reviewService, cancellationRegistry, workerExecutor);

        // Task A occupies the worker until released.
        final CountDownLatch taskAStarted = new CountDownLatch(1);
        final CountDownLatch releaseTaskA = new CountDownLatch(1);
        doAnswer(invocation -> {
            taskAStarted.countDown();
            releaseTaskA.await(10, TimeUnit.SECONDS);
            return new AnalyzeResponse("a");
        }).when(reviewService).analyzeStreaming(any(), any(), any());

        // Task A: occupy the worker.
        final ReconstructionControllerStreamingTest.RecordingEmitter emitterA =
                new ReconstructionControllerStreamingTest.RecordingEmitter(
                        ReconstructionController.SSE_TIMEOUT_MS);
        final ReconstructionController spyA = spy(controller);
        doReturn(emitterA).when(spyA).newAnalyzeEmitter();
        spyA.analyze(replayFiles(), "zh", "cancel-A");
        assertTrue(taskAStarted.await(5, TimeUnit.SECONDS), "Task A must start");

        // Task B: enters the queue.
        final ReconstructionControllerStreamingTest.RecordingEmitter emitterB =
                new ReconstructionControllerStreamingTest.RecordingEmitter(
                        ReconstructionController.SSE_TIMEOUT_MS);
        final ReconstructionController spyB = spy(controller);
        doReturn(emitterB).when(spyB).newAnalyzeEmitter();
        spyB.analyze(replayFiles(), "zh", "cancel-B");

        // Cancel Task B while it is queued (cancel endpoint / client disconnect).
        assertTrue(cancellationRegistry.cancel("cancel-B"),
                "Task B must be registered and cancellable while queued");

        // Release Task A → worker picks up Task B.
        releaseTaskA.countDown();

        // Task B's emitter must complete (worker entry check → quietComplete).
        // Wait for the emitter to be completed by polling for completion via event queue:
        // since cancelled tasks don't emit events, we verify via analyzeStreaming never
        // being called for cancel-B. We use a timeout-based verification.
        //
        // The key assertion: analyzeStreaming is never called for the cancelled task.
        // Since Task A already called analyzeStreaming once, we verify it was called
        // exactly once (for Task A only), not twice.
        verify(reviewService, timeout(5000).times(1)).analyzeStreaming(any(), any(), any());
        // After waiting a bit more, it must still be exactly 1 (Task B never called).
        Thread.sleep(500);
        verify(reviewService, times(1)).analyzeStreaming(any(), any(), any());

        // Cancellation registry: Task B must be unregistered after worker completes it.
        verify(cancellationRegistry, timeout(5000)).unregister("cancel-B");
    }

    // ---- helpers ----

    private static MultipartFile[] replayFiles() {
        return new MultipartFile[]{new MockMultipartFile(
                "files", "saturation.wotbreplay", "application/octet-stream", new byte[]{1})};
    }
}
