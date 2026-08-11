package com.wotb.web.replay.ai;

import com.wotb.web.replay.ai.gateway.AiRequestContext;
import io.micrometer.core.instrument.MeterRegistry;
import jakarta.annotation.PreDestroy;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

import java.util.concurrent.ArrayBlockingQueue;
import java.util.concurrent.ThreadFactory;
import java.util.concurrent.ThreadPoolExecutor;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicInteger;

/**
 * ?? AI Review / SSE worker executor?{@code ReconstructionController.analyze()}
 * ? servlet request ????????????? AI ????????????
 * ????? worker ??????request ?????? {@code SseEmitter}?
 *
 * <p><b>?????V1?2C4G VPS?</b>??? 4 concurrent workers + 4 queued?
 * ?? 8 active/pending?? 9 ????????{@code AI_REVIEW_BUSY} / 503??
 * ??????? {@code AI_REVIEW_WORKER_MAX_CONCURRENT} /
 * {@code AI_REVIEW_WORKER_QUEUE_CAPACITY} ???3/4/6 ??? rebuild??
 * ??????core = max??daemon??????</p>
 *
 * <p><b>????</b>?{@link ThreadPoolExecutor.AbortPolicy}??????
 * {@code RejectedExecutionException}?? Controller ????? 503
 * {@code AI_REVIEW_BUSY}????? {@code CallerRunsPolicy}??? servlet
 * request ???? AI Review????? SSE blocking bug??</p>
 *
 * <p><b>?? deadline?E ???</b>?????????? {@code now + overall-deadline-sec}
 * ??? 400s????? 400s / nginx 420s???? {@link AiRequestContext} ???
 * worker?????????????????????????????? AI_TIMEOUT?</p>
 */
@Component
public class AiReviewWorkerExecutor implements AutoCloseable {

    private static final Logger LOGGER = LoggerFactory.getLogger(AiReviewWorkerExecutor.class);

    static final int DEFAULT_MAX_CONCURRENT = 4;
    static final int DEFAULT_QUEUE_CAPACITY = 4;
    static final long DEFAULT_OVERALL_DEADLINE_SEC = 400;

    private final ThreadPoolExecutor executor;
    private final long overallDeadlineNanos;

    @Autowired(required = false)
    private MeterRegistry meterRegistry;

    /**
     * Spring ?????? {@code wotb.ai.review-worker.max-concurrent} /
     * {@code wotb.ai.review-worker.queue-capacity} /
     * {@code wotb.ai.review-worker.overall-deadline-sec} ??????? 4/4/400??
     * ????????????{@code @Value} ? Spring ??????
     *
     * @param maxConcurrent    worker ????core = max???????????? ? 1
     * @param queueCapacity    ????????? ? 1
     * @param overallDeadlineSec  ???? deadline?????? ? 1
     */
    @Autowired
    public AiReviewWorkerExecutor(
            @Value("${wotb.ai.review-worker.max-concurrent:4}") final int maxConcurrent,
            @Value("${wotb.ai.review-worker.queue-capacity:4}") final int queueCapacity,
            @Value("${wotb.ai.review-worker.overall-deadline-sec:400}") final long overallDeadlineSec) {
        if (maxConcurrent < 1) {
            throw new IllegalArgumentException(
                    "maxConcurrent must be >= 1: " + maxConcurrent);
        }
        if (queueCapacity < 1) {
            throw new IllegalArgumentException(
                    "queueCapacity must be >= 1: " + queueCapacity);
        }
        if (overallDeadlineSec < 1) {
            throw new IllegalArgumentException(
                    "overallDeadlineSec must be >= 1: " + overallDeadlineSec);
        }
        this.overallDeadlineNanos = TimeUnit.SECONDS.toNanos(overallDeadlineSec);
        this.executor = new ThreadPoolExecutor(
                maxConcurrent,
                maxConcurrent,
                0L,
                TimeUnit.MILLISECONDS,
                new ArrayBlockingQueue<>(queueCapacity),
                new NamedDaemonThreadFactory(),
                new ThreadPoolExecutor.AbortPolicy());
    }

    /** ????????????? 4/4/400? */
    public AiReviewWorkerExecutor() {
        this(DEFAULT_MAX_CONCURRENT, DEFAULT_QUEUE_CAPACITY, DEFAULT_OVERALL_DEADLINE_SEC);
    }

    /** ??????????? workers/queue??? deadline ???? 400s? */
    public AiReviewWorkerExecutor(final int maxConcurrent, final int queueCapacity) {
        this(maxConcurrent, queueCapacity, DEFAULT_OVERALL_DEADLINE_SEC);
    }

    /**
     * ?????? workers + queue ???? {@code RejectedExecutionException}
     * ?AbortPolicy??????????? 503 {@code AI_REVIEW_BUSY}?
     *
     * <p>?? deadline ????????now + overall-deadline-sec????
     * {@link AiRequestContext} ??? worker ????????????????
     * ?????????????????? AI_TIMEOUT?</p>
     */
    public void execute(final Runnable task) {
        final long submittedNanos = System.nanoTime();
        executor.execute(() -> {
            final long startNanos = System.nanoTime();
            final long queueWaitMillis = (startNanos - submittedNanos) / 1_000_000L;
            if (queueWaitMillis > 0) {
                LOGGER.debug("AI review worker queue wait {} ms (overall deadline {} s)",
                        queueWaitMillis, TimeUnit.NANOSECONDS.toSeconds(overallDeadlineNanos));
                if (meterRegistry != null) {
                    meterRegistry.timer("wotb_ai_review_queue_wait")
                            .record(startNanos - submittedNanos, TimeUnit.NANOSECONDS);
                }
            }
            AiRequestContext.setOverallDeadline(submittedNanos + overallDeadlineNanos);
            try {
                task.run();
            } finally {
                AiRequestContext.clearOverallDeadline();
            }
        });
    }

    @PreDestroy
    @Override
    public void close() {
        executor.shutdown();
    }

    private static final class NamedDaemonThreadFactory implements ThreadFactory {
        private final AtomicInteger counter = new AtomicInteger();

        @Override
        public Thread newThread(final Runnable runnable) {
            final Thread thread = new Thread(runnable, "wotb-ai-review-worker-" + counter.incrementAndGet());
            thread.setDaemon(true);
            return thread;
        }
    }
}
