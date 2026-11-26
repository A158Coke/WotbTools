package com.wotb.web;

import com.wotb.core.model.Battle;
import com.wotb.core.ref.Tankopedia;
import com.wotb.web.hof.dto.ReplayFileMeta;
import com.wotb.web.hof.entity.HallOfFameRecord;
import com.wotb.web.hof.service.RecordOutcome;
import java.nio.file.Files;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;
import org.junit.jupiter.api.Test;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.test.annotation.DirtiesContext;
import org.testcontainers.junit.jupiter.Testcontainers;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;

@Testcontainers(disabledWithoutDocker = true)
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.MOCK)
@DirtiesContext(classMode = DirtiesContext.ClassMode.AFTER_CLASS)
class HallOfFameConcurrencyIntegrationTest extends WebApiIntegrationTestSupport {

    @Test
    void concurrentAttachDifferentHashesHasSingleWinnerAndNoOverwrite() throws Exception {
        final String arena = "ra-diff-" + UUID.randomUUID().toString().substring(0, 8);
        final HallOfFameRecord row = new HallOfFameRecord();
        row.setArenaId(arena);
        row.setAccountId(111L);
        row.setNickname("Racer");
        row.setTankId(6481L);
        row.setTankName("FV4005");
        row.setBattleType("RANDOM");
        row.setArenaBonusType(1);
        row.setDamageDealt(100);
        hallOfFameRecordRepository.saveAndFlush(row);

        final String hashA = "a".repeat(64);
        final String hashB = "b".repeat(64);
        final Map<RecordOutcome, Integer> counts = concurrentRecordRecorder(
                raceBattle(arena), 2,
                i -> i == 0 ? raceMeta(hashA, "a.wotbreplay") : raceMeta(hashB, "b.wotbreplay"));

        assertEquals(1, counts.getOrDefault(RecordOutcome.ATTACHED, 0), "只有一个 attach winner");
        assertEquals(1, counts.getOrDefault(RecordOutcome.SKIPPED_HASH_CONFLICT, 0), "loser 必须 SKIPPED_HASH_CONFLICT");
        assertEquals(0, counts.getOrDefault(RecordOutcome.IDEMPOTENT, 0));
        final HallOfFameRecord winner = hallOfFameRecordRepository
                .findByArenaIdAndAccountId(arena, 111L).orElseThrow();
        assertTrue(hashA.equals(winner.getReplayHash()) || hashB.equals(winner.getReplayHash()),
                "DB hash 必须为两个 hash 之一且未被覆盖");
    }

    @Test
    void concurrentAttachSameHashIsAttachedPlusIdempotent() throws Exception {
        final String arena = "ra-same-" + UUID.randomUUID().toString().substring(0, 8);
        final HallOfFameRecord row = new HallOfFameRecord();
        row.setArenaId(arena);
        row.setAccountId(111L);
        row.setNickname("Racer");
        row.setTankId(6481L);
        row.setTankName("FV4005");
        row.setBattleType("RANDOM");
        row.setArenaBonusType(1);
        row.setDamageDealt(100);
        hallOfFameRecordRepository.saveAndFlush(row);

        final String hash = "c".repeat(64);
        final Map<RecordOutcome, Integer> counts = concurrentRecordRecorder(
                raceBattle(arena), 2, i -> raceMeta(hash, "same.wotbreplay"));

        assertEquals(1, counts.getOrDefault(RecordOutcome.ATTACHED, 0));
        assertEquals(1, counts.getOrDefault(RecordOutcome.IDEMPOTENT, 0));
        final HallOfFameRecord winner = hallOfFameRecordRepository
                .findByArenaIdAndAccountId(arena, 111L).orElseThrow();
        assertEquals(hash, winner.getReplayHash());
    }

    @Test
    void concurrentInsertDifferentHashesCreatesOneRowAndLoserConflict() throws Exception {
        final String arena = "ri-diff-" + UUID.randomUUID().toString().substring(0, 8);
        final String hashA = "d".repeat(64);
        final String hashB = "e".repeat(64);
        final Map<RecordOutcome, Integer> counts = concurrentRecordRecorder(
                raceBattle(arena), 2,
                i -> i == 0 ? raceMeta(hashA, "d.wotbreplay") : raceMeta(hashB, "e.wotbreplay"));

        assertEquals(1, counts.getOrDefault(RecordOutcome.SAVED, 0), "只有一个 SAVED");
        assertEquals(1, counts.getOrDefault(RecordOutcome.SKIPPED_HASH_CONFLICT, 0),
                "loser 必须在 re-read winner 后 SKIPPED_HASH_CONFLICT，不得无条件 IDEMPOTENT");
        assertEquals(1, hallOfFameRecordRepository.findAll().stream()
                .filter(r -> arena.equals(r.getArenaId())).count());
    }

    @Test
    void concurrentInsertSameHashCreatesOneRowAndLoserIdempotent() throws Exception {
        final String arena = "ri-same-" + UUID.randomUUID().toString().substring(0, 8);
        final String hash = "f".repeat(64);
        final Map<RecordOutcome, Integer> counts = concurrentRecordRecorder(
                raceBattle(arena), 2, i -> raceMeta(hash, "same.wotbreplay"));

        assertEquals(1, counts.getOrDefault(RecordOutcome.SAVED, 0));
        assertEquals(1, counts.getOrDefault(RecordOutcome.IDEMPOTENT, 0));
        assertEquals(1, hallOfFameRecordRepository.findAll().stream()
                .filter(r -> arena.equals(r.getArenaId())).count());
        final HallOfFameRecord winner = hallOfFameRecordRepository
                .findByArenaIdAndAccountId(arena, 111L).orElseThrow();
        assertEquals(hash, winner.getReplayHash());
    }
    @Test
    void concurrentDeleteAndUploadSameHashMaintainsFileInvariant() throws Exception {
        loginAs(ADMIN_SUB, "admin-user");
        final byte[] bytes = "race-replay-bytes".getBytes();
        final String hash = storeReplayBytes(bytes);
        try {
            for (int round = 0; round < 5; round++) {
                final String victimArena = "race-del-" + round + "-" + UUID.randomUUID().toString().substring(0, 8);
                final HallOfFameRecord victim = hofRecord(victimArena, 111L, "Victim", 6481L, "FV4005",
                        "RANDOM", 1, 7000);
                victim.setReplayHash(hash);
                hallOfFameRecordRepository.saveAndFlush(victim);

                final ExecutorService pool = Executors.newFixedThreadPool(2);
                final CountDownLatch start = new CountDownLatch(1);
                try {
                    final Future<?> del = pool.submit(() -> {
                        loginAs(ADMIN_SUB, "admin-user");
                        start.await();
                        hallOfFameAdminService.deleteEntry(victim.getId());
                        return null;
                    });
                    final Future<?> up = pool.submit(() -> {
                        start.await();
                        final Battle b = raceBattle(victimArena + "-new");
                        return replayHashLock.runWithLockResult(hash, () -> {
                            hallOfFameReplayStorage.store(bytes, hash);
                            return hallOfFameService.recordRecorder(b, Tankopedia.load(),
                                    new ReplayFileMeta(hash, "up.wotbreplay", bytes.length, "up-user"));
                        });
                    });
                    start.countDown();
                    del.get(30, TimeUnit.SECONDS);
                    up.get(30, TimeUnit.SECONDS);
                } finally {
                    pool.shutdownNow();
                }

                final long refs = hallOfFameRecordRepository.countByReplayHash(hash);
                final boolean fileExists = Files.exists(REPLAY_DIR.resolve(hash + ".wotbreplay"));
                assertTrue(refs == 0 || fileExists,
                        "round=" + round + " 禁止 dangling reference: refs=" + refs + " fileExists=" + fileExists);
                final int roundId = round;
                final List<HallOfFameRecord> roundRows = hallOfFameRecordRepository.findAll().stream()
                        .filter(x -> x.getArenaId().startsWith("race-del-" + roundId + "-")).toList();
                hallOfFameRecordRepository.deleteAll(roundRows);
                hallOfFameRecordRepository.flush();
            }
        } finally {
            SecurityContextHolder.clearContext();
        }
    }
}
