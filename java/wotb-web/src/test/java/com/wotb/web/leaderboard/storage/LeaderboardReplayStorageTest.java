package com.wotb.web.leaderboard.storage;

import com.wotb.web.leaderboard.exception.LeaderboardStorageException;
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

/** 内容寻址存储单元测试（真实文件系统，无 DB，任何环境可跑）。 */
class LeaderboardReplayStorageTest {

    private static final String SHA = "c".repeat(64);

    private LeaderboardReplayStorage storage(final Path dir) {
        return storage(dir, 0L);
    }

    private LeaderboardReplayStorage storage(final Path dir, final long minFreeBytes) {
        return new LeaderboardReplayStorage(dir.toString(), minFreeBytes);
    }

    @Test
    void storeCreatesContentAddressedFile(@TempDir final Path dir) throws IOException {
        final var r = storage(dir).store(new byte[]{1, 2, 3}, SHA);
        assertTrue(r.created());
        assertTrue(Files.exists(dir.resolve(SHA + ".wotbreplay")));
        assertArrayEquals(new byte[]{1, 2, 3}, Files.readAllBytes(r.path()));
        // 临时目录不残留
        try (var s = Files.list(dir.resolve(".tmp"))) {
            assertEquals(0, s.count());
        }
    }

    @Test
    void storeSameHashIsIdempotentAndNeverOverwrites(@TempDir final Path dir) throws IOException {
        final var storage = storage(dir);
        assertTrue(storage.store(new byte[]{1, 2, 3}, SHA).created());
        // 同 hash 再存（内容相同）→ created=false，文件不变
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
            // ATOMIC_MOVE 下 target 已存在的 provider-specific 行为（替换 vs FileAlreadyExists）
            // 取决于平台：允许 1..threads 个 creator，但 final 文件必须完整且内容正确。
            assertTrue(creators >= 1, "至少一个请求原子发布成功");
            // final 文件 byte-for-byte 正确（同 hash 同内容 invariant）
            assertArrayEquals(data, Files.readAllBytes(dir.resolve(SHA + ".wotbreplay")));
            // 无临时文件残留
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

        final LeaderboardStorageException e = assertThrows(LeaderboardStorageException.class,
                () -> storage.store(new byte[]{1}, SHA));
        assertEquals("REPLAY_STORAGE_ERROR", e.getCode());
        // 不 fallback：final 文件不存在、无半文件、tmp 清理
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
        assertThrows(LeaderboardStorageException.class, () -> storage.load("../../x"));
    }

    @Test
    void storeFailsWhenSpaceBelowReserveIncludingIncomingSize(@TempDir final Path dir) {
        // minFreeBytes = Long.MAX_VALUE：任何写入（含 1 字节）都会低于 reserve
        final var storage = storage(dir, Long.MAX_VALUE);
        final LeaderboardStorageException e = assertThrows(LeaderboardStorageException.class,
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
        // 删除不存在的文件不抛错
        storage.delete("d".repeat(64));
    }
}