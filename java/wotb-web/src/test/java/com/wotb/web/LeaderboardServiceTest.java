package com.wotb.web;

import com.wotb.core.model.Battle;
import com.wotb.core.model.PlayerResult;
import com.wotb.core.ref.Tankopedia;
import com.wotb.web.entity.LeaderboardRecord;
import com.wotb.web.repository.LeaderboardRecordRepository;
import com.wotb.web.service.LeaderboardService;
import org.junit.jupiter.api.Test;

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
 * 录像者匹配 + 去重逻辑单元测试 (mock repository, 无数据库, 任何环境可跑)。
 * 真实 Flyway/validate/落库由手动 postgres 集成验证覆盖。
 */
class LeaderboardServiceTest {

    private final Tankopedia tankopedia = Tankopedia.load();

    private static Battle battle(final String arena, final String recorderNick, final long recAcc) {
        final Battle b = new Battle();
        b.arenaId = arena;
        b.mapName = "rockfield";
        b.recorder = recorderNick;
        b.arenaBonusType = 1;   // 默认随机战斗 (1=随机, 2=训练房)
        b.version = "11.18.0";
        b.startTime = 1719849600000L;  // 2024-07-01T12:00:00Z

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
        other.damageDealt = 9000;   // 队友伤害更高, 但不应被记录 (只记录录像者)
        players.add(other);
        b.players = players;
        return b;
    }

    @Test
    void savesOnlyRecorderWhenNew() {
        final LeaderboardRecordRepository repo = mock(LeaderboardRecordRepository.class);
        when(repo.findByArenaIdAndAccountId(eq("arenaA"), eq(111L))).thenReturn(Optional.empty());
        final LeaderboardService service = new LeaderboardService(repo);

        service.recordRecorder(battle("arenaA", "Recorder1", 111L), tankopedia);

        final var captor = org.mockito.ArgumentCaptor.forClass(LeaderboardRecord.class);
        verify(repo).save(captor.capture());
        final LeaderboardRecord saved = captor.getValue();
        assertEquals(111L, saved.getAccountId(), "应只记录录像者本人");
        assertEquals("Recorder1", saved.getNickname());
        assertEquals(3200, saved.getDamageDealt());
        assertEquals("arenaA", saved.getArenaId());
        assertEquals("11.18.0", saved.getVersion());
        assertNotNull(saved.getBattleTime(), "battleTime 应从 startTime 转换");
        assertEquals(OffsetDateTime.of(2024, 7, 1, 12, 0, 0, 0, ZoneOffset.UTC),
                saved.getBattleTime());
    }

    @Test
    void skipsNonRandomBattleModes() {
        final LeaderboardRecordRepository repo = mock(LeaderboardRecordRepository.class);
        final LeaderboardService service = new LeaderboardService(repo);

        // 训练房(2)/娱乐/联赛等 (非 1) 以及未知模式 (null) 都不计入
        for (final Integer bonus : new Integer[]{null, 2, 3, 7, 22}) {
            final Battle b = battle("arena-" + bonus, "Recorder1", 111L);
            b.arenaBonusType = bonus;
            service.recordRecorder(b, tankopedia);
        }

        verify(repo, never()).findByArenaIdAndAccountId(any(), anyLong());
        verify(repo, never()).save(any());
    }

    @Test
    void skipsWhenAlreadyExists() {
        final LeaderboardRecordRepository repo = mock(LeaderboardRecordRepository.class);
        when(repo.findByArenaIdAndAccountId(eq("arenaA"), eq(111L)))
                .thenReturn(Optional.of(new LeaderboardRecord()));
        final LeaderboardService service = new LeaderboardService(repo);

        service.recordRecorder(battle("arenaA", "Recorder1", 111L), tankopedia);

        verify(repo, never()).save(any());
    }

    @Test
    void skipsWhenRecorderNotAmongPlayers() {
        final LeaderboardRecordRepository repo = mock(LeaderboardRecordRepository.class);
        final LeaderboardService service = new LeaderboardService(repo);

        final Battle b = battle("arenaA", "Recorder1", 111L);
        b.recorder = "NotInRoster";
        service.recordRecorder(b, tankopedia);

        verify(repo, never()).findByArenaIdAndAccountId(any(), anyLong());
        verify(repo, never()).save(any());
    }

    @Test
    void skipsWhenNoRecorderName() {
        final LeaderboardRecordRepository repo = mock(LeaderboardRecordRepository.class);
        final LeaderboardService service = new LeaderboardService(repo);

        final Battle b = battle("arenaA", "Recorder1", 111L);
        b.recorder = "";
        service.recordRecorder(b, tankopedia);

        verify(repo, never()).save(any());
    }
}
