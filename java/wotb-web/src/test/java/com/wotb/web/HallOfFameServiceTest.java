package com.wotb.web;

import com.wotb.core.model.Battle;
import com.wotb.core.model.PlayerResult;
import com.wotb.core.ref.Tankopedia;
import com.wotb.web.hof.dto.ReplayFileMeta;
import com.wotb.web.hof.entity.HallOfFameRecord;
import com.wotb.web.hof.repository.HallOfFameRecordRepository;
import com.wotb.web.hof.repository.HofVehicleProjection;
import com.wotb.web.hof.service.HallOfFameRecordMapper;
import com.wotb.web.hof.service.HallOfFameService;
import com.wotb.web.hof.policy.HallOfFameBattleTypePolicy;
import com.wotb.web.hof.service.RecordOutcome;
import com.wotb.web.replayfile.HallOfFameReplayStorage;
import org.junit.jupiter.api.Test;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;

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
class HallOfFameServiceTest {

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

    private static HallOfFameService service(final HallOfFameRecordRepository repo) {
        return new HallOfFameService(repo, mock(HallOfFameRecordMapper.class),
                mock(HallOfFameReplayStorage.class));
    }

    private static ReplayFileMeta meta(final String sha) {
        return new ReplayFileMeta(sha, "battle.wotbreplay", 128L, "kc-user");
    }

    @Test
    void vehicleOptionsUseReadableMetadataAndKeepUnknownLegacyVehicles() {
        final HallOfFameRecordRepository repo = mock(HallOfFameRecordRepository.class);
        final HofVehicleProjection known = mock(HofVehicleProjection.class);
        when(known.getTankId()).thenReturn(385L); // Progetto 65, Tier X European medium
        when(known.getTankName()).thenReturn("Progetto 65");
        final HofVehicleProjection unknown = mock(HofVehicleProjection.class);
        when(unknown.getTankId()).thenReturn(999_999L);
        when(unknown.getTankName()).thenReturn("Legacy Tank");
        when(repo.findVehicleOptions()).thenReturn(List.of(known, unknown));

        final var options = service(repo).vehicleOptions();

        assertEquals(2, options.size());
        assertEquals("Progetto 65", options.get(0).tankName());
        assertEquals("EUROPE", options.get(0).nation());
        assertEquals("MEDIUM_TANK", options.get(0).type());
        assertEquals(Integer.valueOf(10), options.get(0).tier());
        assertEquals("Legacy Tank", options.get(1).tankName());
        assertEquals("OTHER", options.get(1).nation());
        assertEquals("OTHER", options.get(1).type());
        assertNull(options.get(1).tier());
    }

    @Test
    void categoryFiltersIndependentlyQueryMatchingVehicleIntersection() {
        final HallOfFameRecordRepository repo = mock(HallOfFameRecordRepository.class);
        final HofVehicleProjection europeMedium = mock(HofVehicleProjection.class);
        when(europeMedium.getTankId()).thenReturn(385L);
        when(europeMedium.getTankName()).thenReturn("Progetto 65");
        final HofVehicleProjection franceLight = mock(HofVehicleProjection.class);
        when(franceLight.getTankId()).thenReturn(3649L);
        when(franceLight.getTankName()).thenReturn("B-C 25 t");
        when(repo.findVehicleOptions()).thenReturn(List.of(europeMedium, franceLight));
        when(repo.searchByVehicleIds(any(), any(), any(), any(), any(Pageable.class)))
                .thenReturn(Page.empty());

        service(repo).search(null, null, " europe ", "medium_tank", 10,
                null, 1, 50);

        verify(repo).searchByVehicleIds(any(), any(), eq(List.of(385L)), any(), any(Pageable.class));
        verify(repo, never()).search(any(), any(), any(), any(Pageable.class));
    }

    // ── eligibility / preflight（P1：写文件前确定 SKIPPED）────────────────────

    @Test
    void eligibilityFlagsUnsupportedBattleTypeAndUnknownRecorder() {
        final HallOfFameRecordRepository repo = mock(HallOfFameRecordRepository.class);
        final HallOfFameService service = service(repo);

        assertEquals(RecordOutcome.SKIPPED_UNSUPPORTED_BATTLE_TYPE,
                service.eligibility(nonRandom()));
        assertEquals(RecordOutcome.SKIPPED_UNKNOWN_RECORDER,
                service.eligibility(unknownRecorder()));
        assertEquals(RecordOutcome.SAVED,
                service.eligibility(battle("arenaA", "Recorder1", 111L)));
        // Rating=7 与 Random 同为支持的战斗模式
        final Battle rating = battle("arena-rating", "Recorder1", 111L);
        rating.arenaBonusType = 7;
        assertEquals(RecordOutcome.SAVED, service.eligibility(rating));
        verify(repo, never()).findByArenaIdAndAccountId(any(), anyLong());
    }

    /** eligibility 对不支持模式（训练房/联赛/Mad Games/未知）一律 SKIPPED_UNSUPPORTED_BATTLE_TYPE。 */
    @Test
    void eligibilityRejectsUnsupportedBattleTypes() {
        final HallOfFameRecordRepository repo = mock(HallOfFameRecordRepository.class);
        final HallOfFameService service = service(repo);

        for (final Integer bonus : new Integer[]{null, 2, 4, 8, 999}) {
            final Battle b = battle("arena-elig-" + bonus, "Recorder1", 111L);
            b.arenaBonusType = bonus;
            assertEquals(RecordOutcome.SKIPPED_UNSUPPORTED_BATTLE_TYPE,
                    service.eligibility(b), "arenaBonusType=" + bonus);
        }
    }

    /**
     * 单一事实源 policy：RANDOM(1) 与 RATING(7) 支持（Rating=7 依据 Jylpah/blitz-tools
     * BattleCategorizationList._battle_modes 外部证据，与 1/2/4 真实样本映射一致）；
     * 训练房(2)/联赛(4)/快速锦标赛(5)/Mad Games(8)/未知(null/0/999) 一律不支持。
     */
    @Test
    void supportedBattleTypesPolicyAcceptsRandomAndRating() {
        assertTrue(HallOfFameBattleTypePolicy.isSupported(1));
        assertTrue(HallOfFameBattleTypePolicy.isSupported(7));
        assertFalse(HallOfFameBattleTypePolicy.isSupported(null));
        assertFalse(HallOfFameBattleTypePolicy.isSupported(2));
        assertFalse(HallOfFameBattleTypePolicy.isSupported(4));
        assertFalse(HallOfFameBattleTypePolicy.isSupported(5));
        assertFalse(HallOfFameBattleTypePolicy.isSupported(8));
        assertFalse(HallOfFameBattleTypePolicy.isSupported(0));
        assertFalse(HallOfFameBattleTypePolicy.isSupported(999));
    }

    @Test
    void preflightDetectsHashConflictAndIdempotent() {
        final HallOfFameRecordRepository repo = mock(HallOfFameRecordRepository.class);
        final HallOfFameService service = service(repo);

        final HallOfFameRecord withHash1 = new HallOfFameRecord();
        withHash1.setReplayHash(SHA_1);
        when(repo.findByArenaIdAndAccountId(eq("arenaA"), eq(111L)))
                .thenReturn(Optional.of(withHash1));
        assertEquals(Optional.of(RecordOutcome.IDEMPOTENT),
                service.preflightReplay(battle("arenaA", "Recorder1", 111L), meta(SHA_1)));
        assertEquals(Optional.of(RecordOutcome.SKIPPED_HASH_CONFLICT),
                service.preflightReplay(battle("arenaA", "Recorder1", 111L), meta(SHA_2)));

        final HallOfFameRecord withNullHash = new HallOfFameRecord();
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
        final HallOfFameRecordRepository repo = mock(HallOfFameRecordRepository.class);
        when(repo.findByArenaIdAndAccountId(eq("arenaA"), eq(111L))).thenReturn(Optional.empty());
        final HallOfFameService service = service(repo);

        assertEquals(RecordOutcome.SAVED,
                service.recordRecorder(battle("arenaA", "Recorder1", 111L), tankopedia, meta(SHA_1)));

        final var captor = org.mockito.ArgumentCaptor.forClass(HallOfFameRecord.class);
        verify(repo).saveAndFlush(captor.capture());
        final HallOfFameRecord saved = captor.getValue();
        assertEquals(111L, saved.getAccountId());
        assertEquals("Recorder1", saved.getNickname());
        assertEquals(3200, saved.getDamageDealt());
        assertEquals("arenaA", saved.getArenaId());
        assertEquals("11.18.0", saved.getVersion());
        assertEquals("RANDOM", saved.getBattleType());
        assertEquals(1, saved.getArenaBonusType());
        assertNotNull(saved.getBattleTime());
        assertEquals(OffsetDateTime.of(2024, 7, 1, 12, 0, 0, 0, ZoneOffset.UTC),
                saved.getBattleTime());
    }

    @Test
    void savesReplayMetaOnNewRecord() {
        final HallOfFameRecordRepository repo = mock(HallOfFameRecordRepository.class);
        when(repo.findByArenaIdAndAccountId(eq("arenaA"), eq(111L))).thenReturn(Optional.empty());
        final HallOfFameService service = service(repo);

        service.recordRecorder(battle("arenaA", "Recorder1", 111L), tankopedia, meta(SHA_1));

        final var captor = org.mockito.ArgumentCaptor.forClass(HallOfFameRecord.class);
        verify(repo).saveAndFlush(captor.capture());
        final HallOfFameRecord saved = captor.getValue();
        assertEquals(SHA_1, saved.getReplayHash());
        assertEquals("battle.wotbreplay", saved.getReplayFileName());
        assertEquals(128L, saved.getReplaySize());
        assertEquals("kc-user", saved.getReplayUploadedBy());
    }

    @Test
    void skipsUnsupportedBattleModes() {
        final HallOfFameRecordRepository repo = mock(HallOfFameRecordRepository.class);
        final HallOfFameService service = service(repo);

        // 训练房(2)、联赛/锦标赛(3/4)、快速锦标赛(5)、Mad Games(8)、未知(null/22/999) 一律不入库
        for (final Integer bonus : new Integer[]{null, 2, 3, 4, 5, 8, 22, 999}) {
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
        final HallOfFameRecordRepository repo = mock(HallOfFameRecordRepository.class);
        when(repo.findByArenaIdAndAccountId(eq("arenaA"), eq(111L))).thenReturn(Optional.empty());
        final HallOfFameService service = service(repo);

        assertEquals(RecordOutcome.SAVED,
                service.recordRecorder(battle("arenaA", "Recorder1", 111L), tankopedia, meta(SHA_1)));
    }

    /** recordRecorder 最终 DB gate 不得再次拒绝 Rating(7)：与 eligibility 共用同一 policy。 */
    @Test
    void recordRecorderFinalGateAllowsRatingBattleType() {
        final HallOfFameRecordRepository repo = mock(HallOfFameRecordRepository.class);
        when(repo.findByArenaIdAndAccountId(eq("arena-rating"), eq(111L))).thenReturn(Optional.empty());
        final HallOfFameService service = service(repo);

        final Battle rating = battle("arena-rating", "Recorder1", 111L);
        rating.arenaBonusType = 7;
        assertEquals(RecordOutcome.SAVED,
                service.recordRecorder(rating, tankopedia, meta(SHA_1)));

        final var captor = org.mockito.ArgumentCaptor.forClass(HallOfFameRecord.class);
        verify(repo).saveAndFlush(captor.capture());
        assertEquals("arena-rating", captor.getValue().getArenaId());
    }

    @Test
    void skipsWhenRecorderNotAmongPlayers() {
        final HallOfFameRecordRepository repo = mock(HallOfFameRecordRepository.class);
        final HallOfFameService service = service(repo);

        assertEquals(RecordOutcome.SKIPPED_UNKNOWN_RECORDER,
                service.recordRecorder(unknownRecorder(), tankopedia, meta(SHA_1)));

        verify(repo, never()).findByArenaIdAndAccountId(any(), anyLong());
        verify(repo, never()).saveAndFlush(any());
    }

    @Test
    void skipsWhenNoRecorderName() {
        final HallOfFameRecordRepository repo = mock(HallOfFameRecordRepository.class);
        final HallOfFameService service = service(repo);

        final Battle b = battle("arenaA", "Recorder1", 111L);
        b.recorder = "";
        assertEquals(RecordOutcome.SKIPPED_UNKNOWN_RECORDER,
                service.recordRecorder(b, tankopedia, meta(SHA_1)));

        verify(repo, never()).saveAndFlush(any());
    }

    @Test
    void savesNullVersionWhenVersionWhitespace() {
        final HallOfFameRecordRepository repo = mock(HallOfFameRecordRepository.class);
        when(repo.findByArenaIdAndAccountId(eq("arenaA"), eq(111L))).thenReturn(Optional.empty());
        final HallOfFameService service = service(repo);
        final Battle battle = battle("arenaA", "Recorder1", 111L);
        battle.version = "   ";

        assertEquals(RecordOutcome.SAVED,
                service.recordRecorder(battle, tankopedia, meta(SHA_1)));

        final var captor = org.mockito.ArgumentCaptor.forClass(HallOfFameRecord.class);
        verify(repo).saveAndFlush(captor.capture());
        assertNull(captor.getValue().getVersion());
    }

    @Test
    void skipsWhenMetaNullStillSavesWithoutReplayColumns() {
        final HallOfFameRecordRepository repo = mock(HallOfFameRecordRepository.class);
        when(repo.findByArenaIdAndAccountId(eq("arenaA"), eq(111L))).thenReturn(Optional.empty());
        final HallOfFameService service = service(repo);

        assertEquals(RecordOutcome.SAVED,
                service.recordRecorder(battle("arenaA", "Recorder1", 111L), tankopedia, null));

        final var captor = org.mockito.ArgumentCaptor.forClass(HallOfFameRecord.class);
        verify(repo).saveAndFlush(captor.capture());
        assertNull(captor.getValue().getReplayHash());
    }

    // ── 已有记录：attach / idempotent / conflict（DB 原子）────────────────────

    @Test
    void attachesWhenExistingRecordHasNoHash() {
        final HallOfFameRecordRepository repo = mock(HallOfFameRecordRepository.class);
        final HallOfFameRecord existing = mock(HallOfFameRecord.class);
        when(existing.getId()).thenReturn(1L);
        when(repo.findByArenaIdAndAccountId(eq("arenaA"), eq(111L)))
                .thenReturn(Optional.of(existing));
        when(repo.attachReplayMetadata(anyLong(), eq(SHA_1),
                eq("battle.wotbreplay"), eq(128L), eq("kc-user"))).thenReturn(1);
        final HallOfFameService service = service(repo);

        assertEquals(RecordOutcome.ATTACHED,
                service.recordRecorder(battle("arenaA", "Recorder1", 111L), tankopedia, meta(SHA_1)));

        verify(repo).attachReplayMetadata(anyLong(), anyString(), anyString(), anyLong(), anyString());
        verify(repo, never()).saveAndFlush(any());
    }

    @Test
    void idempotentWhenSameHash() {
        final HallOfFameRecordRepository repo = mock(HallOfFameRecordRepository.class);
        final HallOfFameRecord existing = new HallOfFameRecord();
        existing.setReplayHash(SHA_1);
        when(repo.findByArenaIdAndAccountId(eq("arenaA"), eq(111L)))
                .thenReturn(Optional.of(existing));
        final HallOfFameService service = service(repo);

        assertEquals(RecordOutcome.IDEMPOTENT,
                service.recordRecorder(battle("arenaA", "Recorder1", 111L), tankopedia, meta(SHA_1)));

        verify(repo, never()).attachReplayMetadata(anyLong(), anyString(), anyString(), anyLong(), anyString());
        verify(repo, never()).saveAndFlush(any());
    }

    @Test
    void conflictWhenDifferentHashKeepsExisting() {
        final HallOfFameRecordRepository repo = mock(HallOfFameRecordRepository.class);
        final HallOfFameRecord existing = new HallOfFameRecord();
        existing.setReplayHash(SHA_1);
        existing.setReplayFileName("old.wotbreplay");
        when(repo.findByArenaIdAndAccountId(eq("arenaA"), eq(111L)))
                .thenReturn(Optional.of(existing));
        final HallOfFameService service = service(repo);

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
        final HallOfFameRecordRepository repo = mock(HallOfFameRecordRepository.class);
        final HallOfFameRecord existing = mock(HallOfFameRecord.class);
        when(existing.getId()).thenReturn(1L);
        when(repo.findByArenaIdAndAccountId(eq("arenaA"), eq(111L)))
                .thenReturn(Optional.of(existing));
        when(repo.attachReplayMetadata(anyLong(), anyString(), anyString(), anyLong(), anyString()))
                .thenReturn(0);
        final HallOfFameRecord winner = new HallOfFameRecord();
        winner.setReplayHash(SHA_1);
        when(repo.findByArenaIdAndAccountId(eq("arenaA"), eq(111L)))
                .thenReturn(Optional.of(existing), Optional.of(winner));
        final HallOfFameService service = service(repo);

        assertEquals(RecordOutcome.SKIPPED_HASH_CONFLICT,
                service.recordRecorder(battle("arenaA", "Recorder1", 111L), tankopedia, meta(SHA_2)));
    }

    @Test
    void attachRaceLoserIdempotentWhenSameHashWon() {
        final HallOfFameRecordRepository repo = mock(HallOfFameRecordRepository.class);
        final HallOfFameRecord existing = mock(HallOfFameRecord.class);
        when(existing.getId()).thenReturn(1L);
        when(repo.findByArenaIdAndAccountId(eq("arenaA"), eq(111L)))
                .thenReturn(Optional.of(existing));
        when(repo.attachReplayMetadata(anyLong(), anyString(), anyString(), anyLong(), anyString()))
                .thenReturn(0);
        final HallOfFameRecord winner = new HallOfFameRecord();
        winner.setReplayHash(SHA_1);
        when(repo.findByArenaIdAndAccountId(eq("arenaA"), eq(111L)))
                .thenReturn(Optional.of(existing), Optional.of(winner));
        final HallOfFameService service = service(repo);

        assertEquals(RecordOutcome.IDEMPOTENT,
                service.recordRecorder(battle("arenaA", "Recorder1", 111L), tankopedia, meta(SHA_1)));
    }

    @Test
    void insertRaceLoserConflictWhenOtherHashWon() {
        final HallOfFameRecordRepository repo = mock(HallOfFameRecordRepository.class);
        when(repo.findByArenaIdAndAccountId(eq("arenaA"), eq(111L))).thenReturn(Optional.empty());
        when(repo.saveAndFlush(any())).thenThrow(new DataIntegrityViolationException("dup"));
        final HallOfFameRecord winner = new HallOfFameRecord();
        winner.setReplayHash(SHA_1);
        when(repo.findByArenaIdAndAccountId(eq("arenaA"), eq(111L)))
                .thenReturn(Optional.empty(), Optional.of(winner));
        final HallOfFameService service = service(repo);

        assertEquals(RecordOutcome.SKIPPED_HASH_CONFLICT,
                service.recordRecorder(battle("arenaA", "Recorder1", 111L), tankopedia, meta(SHA_2)));
    }

    @Test
    void insertRaceLoserIdempotentWhenSameHashWon() {
        final HallOfFameRecordRepository repo = mock(HallOfFameRecordRepository.class);
        when(repo.findByArenaIdAndAccountId(eq("arenaA"), eq(111L))).thenReturn(Optional.empty());
        when(repo.saveAndFlush(any())).thenThrow(new DataIntegrityViolationException("dup"));
        final HallOfFameRecord winner = new HallOfFameRecord();
        winner.setReplayHash(SHA_1);
        when(repo.findByArenaIdAndAccountId(eq("arenaA"), eq(111L)))
                .thenReturn(Optional.empty(), Optional.of(winner));
        final HallOfFameService service = service(repo);

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
