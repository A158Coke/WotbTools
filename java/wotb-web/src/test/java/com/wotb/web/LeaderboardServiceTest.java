package com.wotb.web;

import com.wotb.core.model.Battle;
import com.wotb.core.model.PlayerResult;
import com.wotb.core.ref.Tankopedia;
import com.wotb.web.leaderboard.dto.ReplayFileMeta;
import com.wotb.web.leaderboard.entity.LeaderboardRecord;
import com.wotb.web.leaderboard.repository.LeaderboardRecordRepository;
import com.wotb.web.leaderboard.service.LeaderboardRecordMapper;
import com.wotb.web.leaderboard.service.LeaderboardService;
import com.wotb.web.leaderboard.service.RecordOutcome;
import com.wotb.web.leaderboard.storage.LeaderboardReplayStorage;
import org.junit.jupiter.api.Test;
import org.springframework.dao.DataIntegrityViolationException;

import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.util.ArrayList;
import java.util.List;
import java.util.Optional;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * 录像者匹配 + 去重 + replay metadata 状态机单元测试 (mock repository, 无数据库, 任何环境可跑)。
 * 状态机：新建 → SAVED；已有 hash NULL → ATTACHED；同 hash → IDEMPOTENT；异 hash → SKIPPED_HASH_CONFLICT。
 */
class LeaderboardServiceTest {

    private static final String SHA_1 = "a".repeat(64);
    private static final String SHA_2 = "b".repeat(64);

    private final Tankopedia tankopedia = Tankopedia.load();

    private static Battle battle(final String arena, final String recorderNick, final long recAcc) {
        final Battle b = new Battle();
        b.arenaId = arena;
        b.mapName = "rockfield";
        b.recorder = recorderNick;
        b.arenaBonusType = 1;
        b.version = "11.18.0";
        b.startTime = 1719835200000L;

        final List<PlayerResult> players = new ArrayList<>();
        final PlayerResult rec = new PlayerResult();
        rec.accountId = recAcc;
        rec.nickname = recorderNick;
        rec.tankId = 6481L;
        rec.damageDealt = 3200;
        players.add(rec);
        final PlayerResult other = new PlayerResult();
        other.accountId = 999L;
        other.nickname = "someone-else";
        other.tankId = 1L;
        other.damageDealt = 9000;
        players.add(other);
        b.players = players;
        return b;
    }

    private static LeaderboardService service(final LeaderboardRecordRepository repo) {
        return new LeaderboardService(repo, mock(LeaderboardRecordMapper.class),
                mock(LeaderboardReplayStorage.class));
    }

    private static ReplayFileMeta meta(final String sha) {
        return new ReplayFileMeta(sha, "battle.wotbreplay", 128L, "kc-user");
    }

    @Test
    void savesOnlyRecorderWhenNew() {
        final LeaderboardRecordRepository repo = mock(LeaderboardRecordRepository.class);
        when(repo.findByArenaIdAndAccountId(eq("arenaA"), eq(111L))).thenReturn(Optional.empty());
        final LeaderboardService service = service(repo);

        assertEquals(RecordOutcome.SAVED,
                service.recordRecorder(battle("arenaA", "Recorder1", 111L), tankopedia, meta(SHA_1)));

        final var captor = org.mockito.ArgumentCaptor.forClass(LeaderboardRecord.class);
        verify(repo).save(captor.capture());
        final LeaderboardRecord saved = captor.getValue();
        assertEquals(111L, saved.getAccountId());
        assertEquals("Recorder1", saved.getNickname());
        assertEquals(3200, saved.getDamageDealt());
        assertEquals("arenaA", saved.getArenaId());
        assertEquals("11.18.0", saved.getVersion());
        assertNotNull(saved.getBattleTime());
        assertEquals(OffsetDateTime.of(2024, 7, 1, 12, 0, 0, 0, ZoneOffset.UTC),
                saved.getBattleTime());
    }

    @Test
    void savesReplayMetaOnNewRecord() {
        final LeaderboardRecordRepository repo = mock(LeaderboardRecordRepository.class);
        when(repo.findByArenaIdAndAccountId(eq("arenaA"), eq(111L))).thenReturn(Optional.empty());
        final LeaderboardService service = service(repo);

        service.recordRecorder(battle("arenaA", "Recorder1", 111L), tankopedia, meta(SHA_1));

        final var captor = org.mockito.ArgumentCaptor.forClass(LeaderboardRecord.class);
        verify(repo).save(captor.capture());
        final LeaderboardRecord saved = captor.getValue();
        assertEquals(SHA_1, saved.getReplayHash());
        assertEquals("battle.wotbreplay", saved.getReplayFileName());
        assertEquals(128L, saved.getReplaySize());
        assertEquals("kc-user", saved.getReplayUploadedBy());
    }

    @Test
    void skipsNonRandomBattleModes() {
        final LeaderboardRecordRepository repo = mock(LeaderboardRecordRepository.class);
        final LeaderboardService service = service(repo);

        for (final Integer bonus : new Integer[]{null, 2, 3, 7, 22}) {
            final Battle b = battle("arena-" + bonus, "Recorder1", 111L);
            b.arenaBonusType = bonus;
            assertEquals(RecordOutcome.SKIPPED_NON_RANDOM,
                    service.recordRecorder(b, tankopedia, meta(SHA_1)));
        }

        verify(repo, never()).findByArenaIdAndAccountId(any(), anyLong());
        verify(repo, never()).save(any());
    }

    @Test
    void attachesWhenExistingRecordHasNoHash() {
        final LeaderboardRecordRepository repo = mock(LeaderboardRecordRepository.class);
        final LeaderboardRecord existing = new LeaderboardRecord();
        when(repo.findByArenaIdAndAccountId(eq("arenaA"), eq(111L)))
                .thenReturn(Optional.of(existing));
        final LeaderboardService service = service(repo);

        assertEquals(RecordOutcome.ATTACHED,
                service.recordRecorder(battle("arenaA", "Recorder1", 111L), tankopedia, meta(SHA_1)));

        verify(repo).save(existing);
        assertEquals(SHA_1, existing.getReplayHash());
        assertEquals("battle.wotbreplay", existing.getReplayFileName());
    }

    @Test
    void idempotentWhenSameHash() {
        final LeaderboardRecordRepository repo = mock(LeaderboardRecordRepository.class);
        final LeaderboardRecord existing = new LeaderboardRecord();
        existing.setReplayHash(SHA_1);
        when(repo.findByArenaIdAndAccountId(eq("arenaA"), eq(111L)))
                .thenReturn(Optional.of(existing));
        final LeaderboardService service = service(repo);

        assertEquals(RecordOutcome.IDEMPOTENT,
                service.recordRecorder(battle("arenaA", "Recorder1", 111L), tankopedia, meta(SHA_1)));

        verify(repo, never()).save(any());
    }

    @Test
    void conflictWhenDifferentHashKeepsExisting() {
        final LeaderboardRecordRepository repo = mock(LeaderboardRecordRepository.class);
        final LeaderboardRecord existing = new LeaderboardRecord();
        existing.setReplayHash(SHA_1);
        existing.setReplayFileName("old.wotbreplay");
        when(repo.findByArenaIdAndAccountId(eq("arenaA"), eq(111L)))
                .thenReturn(Optional.of(existing));
        final LeaderboardService service = service(repo);

        assertEquals(RecordOutcome.SKIPPED_HASH_CONFLICT,
                service.recordRecorder(battle("arenaA", "Recorder1", 111L), tankopedia, meta(SHA_2)));

        verify(repo, never()).save(any());
        // 绝不覆盖已有 hash / 文件名
        assertEquals(SHA_1, existing.getReplayHash());
        assertEquals("old.wotbreplay", existing.getReplayFileName());
    }

    @Test
    void concurrentInsertConflictReturnsIdempotent() {
        final LeaderboardRecordRepository repo = mock(LeaderboardRecordRepository.class);
        when(repo.findByArenaIdAndAccountId(eq("arenaA"), eq(111L))).thenReturn(Optional.empty());
        when(repo.save(any())).thenThrow(new DataIntegrityViolationException("dup"));
        final LeaderboardService service = service(repo);

        assertEquals(RecordOutcome.IDEMPOTENT,
                service.recordRecorder(battle("arenaA", "Recorder1", 111L), tankopedia, meta(SHA_1)));
    }

    @Test
    void skipsWhenRecorderNotAmongPlayers() {
        final LeaderboardRecordRepository repo = mock(LeaderboardRecordRepository.class);
        final LeaderboardService service = service(repo);

        final Battle b = battle("arenaA", "Recorder1", 111L);
        b.recorder = "NotInRoster";
        assertEquals(RecordOutcome.SKIPPED_UNKNOWN_RECORDER,
                service.recordRecorder(b, tankopedia, meta(SHA_1)));

        verify(repo, never()).findByArenaIdAndAccountId(any(), anyLong());
        verify(repo, never()).save(any());
    }

    @Test
    void skipsWhenNoRecorderName() {
        final LeaderboardRecordRepository repo = mock(LeaderboardRecordRepository.class);
        final LeaderboardService service = service(repo);

        final Battle b = battle("arenaA", "Recorder1", 111L);
        b.recorder = "";
        assertEquals(RecordOutcome.SKIPPED_UNKNOWN_RECORDER,
                service.recordRecorder(b, tankopedia, meta(SHA_1)));

        verify(repo, never()).save(any());
    }

    @Test
    void savesNullVersionWhenVersionWhitespace() {
        final LeaderboardRecordRepository repo = mock(LeaderboardRecordRepository.class);
        when(repo.findByArenaIdAndAccountId(eq("arenaA"), eq(111L))).thenReturn(Optional.empty());
        final LeaderboardService service = service(repo);
        final Battle battle = battle("arenaA", "Recorder1", 111L);
        battle.version = "   ";

        assertEquals(RecordOutcome.SAVED,
                service.recordRecorder(battle, tankopedia, meta(SHA_1)));

        final var captor = org.mockito.ArgumentCaptor.forClass(LeaderboardRecord.class);
        verify(repo).save(captor.capture());
        assertNull(captor.getValue().getVersion());
    }

    @Test
    void skipsWhenMetaNullStillSavesWithoutReplayColumns() {
        final LeaderboardRecordRepository repo = mock(LeaderboardRecordRepository.class);
        when(repo.findByArenaIdAndAccountId(eq("arenaA"), eq(111L))).thenReturn(Optional.empty());
        final LeaderboardService service = service(repo);

        assertEquals(RecordOutcome.SAVED,
                service.recordRecorder(battle("arenaA", "Recorder1", 111L), tankopedia, null));

        final var captor = org.mockito.ArgumentCaptor.forClass(LeaderboardRecord.class);
        verify(repo).save(captor.capture());
        assertNull(captor.getValue().getReplayHash());
    }
}
