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
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * 录像者匹配 + 去重 + replay metadata 原子状态机单元测试 (mock repository, 无数据库, 任何环境可跑)。
 * 状态机：新建 → SAVED；已有 hash NULL → 原子 conditional UPDATE attach（唯一 winner，败者 re-read 分类）；
 * 同 hash → IDEMPOTENT；异 hash → SKIPPED_HASH_CONFLICT（绝不覆盖）；insert unique race 后 re-read 分类。
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

    // ── eligibility / preflight（P1：写文件前确定 SKIPPED）────────────────────

    @Test
    void eligibilityFlagsUnsupportedBattleTypeAndUnknownRecorder() {
        final LeaderboardRecordRepository repo = mock(LeaderboardRecordRepository.class);
        final LeaderboardService service = service(repo);

        assertEquals(RecordOutcome.SKIPPED_UNSUPPORTED_BATTLE_TYPE,
                service.eligibility(nonRandom()));
        assertEquals(RecordOutcome.SKIPPED_UNKNOWN_RECORDER,
                service.eligibility(unknownRecorder()));
        assertEquals(RecordOutcome.SAVED,
                service.eligibility(battle("arenaA", "Recorder1", 111L)));
        verify(repo, never()).findByArenaIdAndAccountId(any(), anyLong());
    }

    /** 单一事实源 policy：仅随机战（1）支持；训练房(2)/联赛(4)/未证明模式(8)/未知 一律不支持。 */
    @Test
    void supportedBattleTypesPolicyAcceptsOnlyRandom() {
        assertTrue(LeaderboardService.isLeaderboardSupportedBattleType(1));
        assertFalse(LeaderboardService.isLeaderboardSupportedBattleType(null));
        assertFalse(LeaderboardService.isLeaderboardSupportedBattleType(2));
        assertFalse(LeaderboardService.isLeaderboardSupportedBattleType(4));
        assertFalse(LeaderboardService.isLeaderboardSupportedBattleType(8));
        assertFalse(LeaderboardService.isLeaderboardSupportedBattleType(0));
        assertFalse(LeaderboardService.isLeaderboardSupportedBattleType(99));
    }

    @Test
    void preflightDetectsHashConflictAndIdempotent() {
        final LeaderboardRecordRepository repo = mock(LeaderboardRecordRepository.class);
        final LeaderboardService service = service(repo);

        final LeaderboardRecord withHash1 = new LeaderboardRecord();
        withHash1.setReplayHash(SHA_1);
        when(repo.findByArenaIdAndAccountId(eq("arenaA"), eq(111L)))
                .thenReturn(Optional.of(withHash1));
        assertEquals(Optional.of(RecordOutcome.IDEMPOTENT),
                service.preflightReplay(battle("arenaA", "Recorder1", 111L), meta(SHA_1)));
        assertEquals(Optional.of(RecordOutcome.SKIPPED_HASH_CONFLICT),
                service.preflightReplay(battle("arenaA", "Recorder1", 111L), meta(SHA_2)));

        final LeaderboardRecord withNullHash = new LeaderboardRecord();
        when(repo.findByArenaIdAndAccountId(eq("arenaB"), eq(111L)))
                .thenReturn(Optional.of(withNullHash));
        assertEquals(Optional.empty(),
                service.preflightReplay(battle("arenaB", "Recorder1", 111L), meta(SHA_1)));

        when(repo.findByArenaIdAndAccountId(eq("arenaC"), eq(111L)))
                .thenReturn(Optional.empty());
        assertEquals(Optional.empty(),
                service.preflightReplay(battle("arenaC", "Recorder1", 111L), meta(SHA_1)));
    }

    // ── 新建 ────────────────────────────────────────────────────────────────

    @Test
    void savesOnlyRecorderWhenNew() {
        final LeaderboardRecordRepository repo = mock(LeaderboardRecordRepository.class);
        when(repo.findByArenaIdAndAccountId(eq("arenaA"), eq(111L))).thenReturn(Optional.empty());
        final LeaderboardService service = service(repo);

        assertEquals(RecordOutcome.SAVED,
                service.recordRecorder(battle("arenaA", "Recorder1", 111L), tankopedia, meta(SHA_1)));

        final var captor = org.mockito.ArgumentCaptor.forClass(LeaderboardRecord.class);
        verify(repo).saveAndFlush(captor.capture());
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
        verify(repo).saveAndFlush(captor.capture());
        final LeaderboardRecord saved = captor.getValue();
        assertEquals(SHA_1, saved.getReplayHash());
        assertEquals("battle.wotbreplay", saved.getReplayFileName());
        assertEquals(128L, saved.getReplaySize());
        assertEquals("kc-user", saved.getReplayUploadedBy());
    }

    @Test
    void skipsUnsupportedBattleModes() {
        final LeaderboardRecordRepository repo = mock(LeaderboardRecordRepository.class);
        final LeaderboardService service = service(repo);

        // 训练房(2)、联赛/锦标赛(3/4/7)、未证明模式(8)、未知(null/22) 一律不入库
        for (final Integer bonus : new Integer[]{null, 2, 3, 4, 7, 8, 22}) {
            final Battle b = battle("arena-" + bonus, "Recorder1", 111L);
            b.arenaBonusType = bonus;
            assertEquals(RecordOutcome.SKIPPED_UNSUPPORTED_BATTLE_TYPE,
                    service.recordRecorder(b, tankopedia, meta(SHA_1)));
        }

        verify(repo, never()).findByArenaIdAndAccountId(any(), anyLong());
        verify(repo, never()).saveAndFlush(any());
    }

    /** recordRecorder 最终 DB gate 与 eligibility 同一 policy：随机战(1) 正常入库。 */
    @Test
    void recordRecorderAcceptsRandomBattleType() {
        final LeaderboardRecordRepository repo = mock(LeaderboardRecordRepository.class);
        when(repo.findByArenaIdAndAccountId(eq("arenaA"), eq(111L))).thenReturn(Optional.empty());
        final LeaderboardService service = service(repo);

        assertEquals(RecordOutcome.SAVED,
                service.recordRecorder(battle("arenaA", "Recorder1", 111L), tankopedia, meta(SHA_1)));
    }

    @Test
    void skipsWhenRecorderNotAmongPlayers() {
        final LeaderboardRecordRepository repo = mock(LeaderboardRecordRepository.class);
        final LeaderboardService service = service(repo);

        assertEquals(RecordOutcome.SKIPPED_UNKNOWN_RECORDER,
                service.recordRecorder(unknownRecorder(), tankopedia, meta(SHA_1)));

        verify(repo, never()).findByArenaIdAndAccountId(any(), anyLong());
        verify(repo, never()).saveAndFlush(any());
    }

    @Test
    void skipsWhenNoRecorderName() {
        final LeaderboardRecordRepository repo = mock(LeaderboardRecordRepository.class);
        final LeaderboardService service = service(repo);

        final Battle b = battle("arenaA", "Recorder1", 111L);
        b.recorder = "";
        assertEquals(RecordOutcome.SKIPPED_UNKNOWN_RECORDER,
                service.recordRecorder(b, tankopedia, meta(SHA_1)));

        verify(repo, never()).saveAndFlush(any());
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
        verify(repo).saveAndFlush(captor.capture());
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
        verify(repo).saveAndFlush(captor.capture());
        assertNull(captor.getValue().getReplayHash());
    }

    // ── 已有记录：attach / idempotent / conflict（DB 原子）────────────────────

    @Test
    void attachesWhenExistingRecordHasNoHash() {
        final LeaderboardRecordRepository repo = mock(LeaderboardRecordRepository.class);
        final LeaderboardRecord existing = mock(LeaderboardRecord.class);
        when(existing.getId()).thenReturn(1L);
        when(repo.findByArenaIdAndAccountId(eq("arenaA"), eq(111L)))
                .thenReturn(Optional.of(existing));
        when(repo.attachReplayMetadata(anyLong(), eq(SHA_1),
                eq("battle.wotbreplay"), eq(128L), eq("kc-user"))).thenReturn(1);
        final LeaderboardService service = service(repo);

        assertEquals(RecordOutcome.ATTACHED,
                service.recordRecorder(battle("arenaA", "Recorder1", 111L), tankopedia, meta(SHA_1)));

        verify(repo).attachReplayMetadata(anyLong(), anyString(), anyString(), anyLong(), anyString());
        verify(repo, never()).saveAndFlush(any());
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

        verify(repo, never()).attachReplayMetadata(anyLong(), anyString(), anyString(), anyLong(), anyString());
        verify(repo, never()).saveAndFlush(any());
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

        verify(repo, never()).attachReplayMetadata(anyLong(), anyString(), anyString(), anyLong(), anyString());
        verify(repo, never()).saveAndFlush(any());
        // 绝不覆盖已有 hash / 文件名
        assertEquals(SHA_1, existing.getReplayHash());
        assertEquals("old.wotbreplay", existing.getReplayFileName());
    }

    // ── 并发竞态：attach 败者 / insert 败者 re-read 后重新分类 ────────────────

    @Test
    void attachRaceLoserConflictWhenOtherHashWon() {
        final LeaderboardRecordRepository repo = mock(LeaderboardRecordRepository.class);
        final LeaderboardRecord existing = mock(LeaderboardRecord.class);
        when(existing.getId()).thenReturn(1L);
        when(repo.findByArenaIdAndAccountId(eq("arenaA"), eq(111L)))
                .thenReturn(Optional.of(existing));
        when(repo.attachReplayMetadata(anyLong(), anyString(), anyString(), anyLong(), anyString()))
                .thenReturn(0);
        final LeaderboardRecord winner = new LeaderboardRecord();
        winner.setReplayHash(SHA_1);
        when(repo.findByArenaIdAndAccountId(eq("arenaA"), eq(111L)))
                .thenReturn(Optional.of(existing), Optional.of(winner));
        final LeaderboardService service = service(repo);

        assertEquals(RecordOutcome.SKIPPED_HASH_CONFLICT,
                service.recordRecorder(battle("arenaA", "Recorder1", 111L), tankopedia, meta(SHA_2)));
    }

    @Test
    void attachRaceLoserIdempotentWhenSameHashWon() {
        final LeaderboardRecordRepository repo = mock(LeaderboardRecordRepository.class);
        final LeaderboardRecord existing = mock(LeaderboardRecord.class);
        when(existing.getId()).thenReturn(1L);
        when(repo.findByArenaIdAndAccountId(eq("arenaA"), eq(111L)))
                .thenReturn(Optional.of(existing));
        when(repo.attachReplayMetadata(anyLong(), anyString(), anyString(), anyLong(), anyString()))
                .thenReturn(0);
        final LeaderboardRecord winner = new LeaderboardRecord();
        winner.setReplayHash(SHA_1);
        when(repo.findByArenaIdAndAccountId(eq("arenaA"), eq(111L)))
                .thenReturn(Optional.of(existing), Optional.of(winner));
        final LeaderboardService service = service(repo);

        assertEquals(RecordOutcome.IDEMPOTENT,
                service.recordRecorder(battle("arenaA", "Recorder1", 111L), tankopedia, meta(SHA_1)));
    }

    @Test
    void insertRaceLoserConflictWhenOtherHashWon() {
        final LeaderboardRecordRepository repo = mock(LeaderboardRecordRepository.class);
        when(repo.findByArenaIdAndAccountId(eq("arenaA"), eq(111L))).thenReturn(Optional.empty());
        when(repo.saveAndFlush(any())).thenThrow(new DataIntegrityViolationException("dup"));
        final LeaderboardRecord winner = new LeaderboardRecord();
        winner.setReplayHash(SHA_1);
        when(repo.findByArenaIdAndAccountId(eq("arenaA"), eq(111L)))
                .thenReturn(Optional.empty(), Optional.of(winner));
        final LeaderboardService service = service(repo);

        assertEquals(RecordOutcome.SKIPPED_HASH_CONFLICT,
                service.recordRecorder(battle("arenaA", "Recorder1", 111L), tankopedia, meta(SHA_2)));
    }

    @Test
    void insertRaceLoserIdempotentWhenSameHashWon() {
        final LeaderboardRecordRepository repo = mock(LeaderboardRecordRepository.class);
        when(repo.findByArenaIdAndAccountId(eq("arenaA"), eq(111L))).thenReturn(Optional.empty());
        when(repo.saveAndFlush(any())).thenThrow(new DataIntegrityViolationException("dup"));
        final LeaderboardRecord winner = new LeaderboardRecord();
        winner.setReplayHash(SHA_1);
        when(repo.findByArenaIdAndAccountId(eq("arenaA"), eq(111L)))
                .thenReturn(Optional.empty(), Optional.of(winner));
        final LeaderboardService service = service(repo);

        assertEquals(RecordOutcome.IDEMPOTENT,
                service.recordRecorder(battle("arenaA", "Recorder1", 111L), tankopedia, meta(SHA_1)));
    }

    private static Battle nonRandom() {
        final Battle b = battle("arena-nr", "Recorder1", 111L);
        b.arenaBonusType = 2;
        return b;
    }

    private static Battle unknownRecorder() {
        final Battle b = battle("arena-ur", "Recorder1", 111L);
        b.recorder = "NotInRoster";
        return b;
    }
}
