package com.wotb.web.replayfile;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;

import static org.junit.jupiter.api.Assertions.assertArrayEquals;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

class HallOfFameReplayStorageTest {

    private static final String SHA = "c".repeat(64);

    private HallOfFameReplayStorage storage(final Path dir) {
        return storage(dir, 0L);
    }

    private HallOfFameReplayStorage storage(final Path dir, final long minFreeBytes) {
        return new HallOfFameReplayStorage(dir.toString(), minFreeBytes);
    }

    @Test
    void storeCreatesContentAddressedFile(@TempDir final Path dir) throws IOException {
        final var r = storage(dir).store(new byte[]{1, 2, 3}, SHA);
        assertTrue(r.created());
        assertTrue(Files.exists(dir.resolve(SHA + ".wotbreplay")));
        assertArrayEquals(new byte[]{1, 2, 3}, Files.readAllBytes(r.path()));
        try (var s = Files.list(dir.resolve(".tmp"))) {
            assertEquals(0, s.count());
        }
    }

    @Test
    void storeSameHashIsIdempotentAndNeverOverwrites(@TempDir final Path dir) throws IOException {
        final var storage = storage(dir);
        assertTrue(storage.store(new byte[]{1, 2, 3}, SHA).created());
        final var r2 = storage.store(new byte[]{1, 2, 3}, SHA);
        assertFalse(r2.created());
        assertArrayEquals(new byte[]{1, 2, 3}, Files.readAllBytes(r2.path()));
    }

    @Test
    void concurrentSameHashStoreNeverExposesPartialFile(@TempDir final Path dir) throws Exception {
        final var storage = storage(dir);
        final int threads = 8;
        final ExecutorService pool = Executors.newFixedThreadPool(threads);
        final CountDownLatch start = new CountDownLatch(1);
        final byte[] data = new byte[4096];
        Arrays.fill(data, (byte) 7);
        try {
            final List<Future<Boolean>> futures = new ArrayList<>();
            for (int i = 0; i < threads; i++) {
                futures.add(pool.submit(() -> {
                    start.await();
                    return storage.store(data, SHA).created();
                }));
            }
            start.countDown();
            long creators = 0;
            for (final Future<Boolean> f : futures) {
                if (f.get(10, TimeUnit.SECONDS)) creators++;
            }
            assertTrue(creators >= 1, "至少一个请求原子发布成功");
            assertArrayEquals(data, Files.readAllBytes(dir.resolve(SHA + ".wotbreplay")));
            try (var s = Files.list(dir.resolve(".tmp"))) {
                assertEquals(0, s.count());
            }
        } finally {
            pool.shutdownNow();
        }
    }

    @Test
    void atomicMoveUnsupportedSurfacesAsStorageErrorAndCleansTmp(@TempDir final Path dir) throws IOException {
        final var storage = org.mockito.Mockito.spy(storage(dir));
        org.mockito.Mockito.doThrow(new java.nio.file.AtomicMoveNotSupportedException(
                        "tmp", "target", "unsupported"))
                .when(storage).moveAtomically(org.mockito.ArgumentMatchers.any(),
                        org.mockito.ArgumentMatchers.any());

        final HallOfFameStorageException e = assertThrows(HallOfFameStorageException.class,
                () -> storage.store(new byte[]{1}, SHA));
        assertEquals("REPLAY_STORAGE_ERROR", e.getCode());
        assertFalse(Files.exists(dir.resolve(SHA + ".wotbreplay")));
        try (var s = Files.list(dir.resolve(".tmp"))) {
            assertEquals(0, s.count());
        }
    }

    @Test
    void loadReturnsEmptyWhenMissing(@TempDir final Path dir) {
        assertTrue(storage(dir).load(SHA).isEmpty());
    }

    @Test
    void loadReturnsFileWhenPresent(@TempDir final Path dir) throws IOException {
        final var storage = storage(dir);
        storage.store(new byte[]{9}, SHA);
        assertTrue(storage.load(SHA).isPresent());
        assertEquals(dir.resolve(SHA + ".wotbreplay"), storage.load(SHA).orElseThrow());
    }

    @Test
    void loadRejectsPathEscapingBaseDir(@TempDir final Path dir) {
        final var storage = storage(dir);
        assertThrows(HallOfFameStorageException.class, () -> storage.load("../../x"));
    }

    @Test
    void storeFailsWhenSpaceBelowReserveIncludingIncomingSize(@TempDir final Path dir) {
        final var storage = storage(dir, Long.MAX_VALUE);
        final HallOfFameStorageException e = assertThrows(HallOfFameStorageException.class,
                () -> storage.store(new byte[]{1}, SHA));
        assertEquals("REPLAY_STORAGE_FULL", e.getCode());
        assertFalse(Files.exists(dir.resolve(SHA + ".wotbreplay")));
    }

    @Test
    void deleteRemovesFileBestEffort(@TempDir final Path dir) {
        final var storage = storage(dir);
        storage.store(new byte[]{1}, SHA);
        storage.delete(SHA);
        assertTrue(storage.load(SHA).isEmpty());
        storage.delete("d".repeat(64));
    }
}