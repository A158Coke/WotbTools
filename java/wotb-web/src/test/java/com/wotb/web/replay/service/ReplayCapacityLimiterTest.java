package com.wotb.web.replay.service;

import com.wotb.web.replay.exception.ReplayBusyException;
import org.junit.jupiter.api.Test;

import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

class ReplayCapacityLimiterTest {

    @Test
    void rejectsWorkWhenAllPermitsAreInUse() throws Exception {
        final ReplayCapacityLimiter limiter = new ReplayCapacityLimiter(1);
        final ExecutorService executor = Executors.newSingleThreadExecutor();
        final CountDownLatch entered = new CountDownLatch(1);
        final CountDownLatch release = new CountDownLatch(1);
        try {
            final Future<String> first = executor.submit(() -> limiter.execute(() -> {
                entered.countDown();
                if (!release.await(5, TimeUnit.SECONDS)) {
                    throw new IllegalStateException("TEST_TIMEOUT");
                }
                return "done";
            }));
            assertTrue(entered.await(5, TimeUnit.SECONDS));

            final ReplayBusyException error = assertThrows(ReplayBusyException.class,
                    () -> limiter.execute(() -> "second"));

            assertEquals("REPLAY_BUSY", error.getMessage());
            release.countDown();
            assertEquals("done", first.get(5, TimeUnit.SECONDS));
        } finally {
            release.countDown();
            executor.shutdownNow();
        }
    }
}
