package com.wotb.web;

import com.wotb.core.model.Battle;
import com.wotb.core.model.PlayerResult;
import com.wotb.core.ref.Tankopedia;
import com.wotb.web.leaderboard.entity.LeaderboardRecord;
import com.wotb.web.leaderboard.repository.LeaderboardRecordRepository;
import com.wotb.web.leaderboard.service.LeaderboardRecordMapper;
import com.wotb.web.leaderboard.service.LeaderboardService;
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
 */
class LeaderboardServiceTest {

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

    @Test
    void savesOnlyRecorderWhenNew() {
        final LeaderboardRecordRepository repo = mock(LeaderboardRecordRepository.class);
        when(repo.findByArenaIdAndAccountId(eq("arenaA"), eq(111L))).thenReturn(Optional.empty());
        final LeaderboardService service = new LeaderboardService(repo, mock(LeaderboardRecordMapper.class));

        service.recordRecorder(battle("arenaA", "Recorder1", 111L), tankopedia);

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
    void skipsNonRandomBattleModes() {
        final LeaderboardRecordRepository repo = mock(LeaderboardRecordRepository.class);
        final LeaderboardService service = new LeaderboardService(repo, mock(LeaderboardRecordMapper.class));

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
        final LeaderboardService service = new LeaderboardService(repo, mock(LeaderboardRecordMapper.class));

        service.recordRecorder(battle("arenaA", "Recorder1", 111L), tankopedia);

        verify(repo, never()).save(any());
    }

    @Test
    void skipsWhenRecorderNotAmongPlayers() {
        final LeaderboardRecordRepository repo = mock(LeaderboardRecordRepository.class);
        final LeaderboardService service = new LeaderboardService(repo, mock(LeaderboardRecordMapper.class));

        final Battle b = battle("arenaA", "Recorder1", 111L);
        b.recorder = "NotInRoster";
        service.recordRecorder(b, tankopedia);

        verify(repo, never()).findByArenaIdAndAccountId(any(), anyLong());
        verify(repo, never()).save(any());
    }

    @Test
    void skipsWhenNoRecorderName() {
        final LeaderboardRecordRepository repo = mock(LeaderboardRecordRepository.class);
        final LeaderboardService service = new LeaderboardService(repo, mock(LeaderboardRecordMapper.class));

        final Battle b = battle("arenaA", "Recorder1", 111L);
        b.recorder = "";
        service.recordRecorder(b, tankopedia);

        verify(repo, never()).save(any());
    }

    @Test
    void savesNullVersionWhenVersionWhitespace() {
        final LeaderboardRecordRepository repo = mock(LeaderboardRecordRepository.class);
        when(repo.findByArenaIdAndAccountId(eq("arenaA"), eq(111L))).thenReturn(Optional.empty());
        final LeaderboardService service = new LeaderboardService(repo, mock(LeaderboardRecordMapper.class));
        final Battle battle = battle("arenaA", "Recorder1", 111L);
        battle.version = "   ";

        service.recordRecorder(battle, tankopedia);

        final var captor = org.mockito.ArgumentCaptor.forClass(LeaderboardRecord.class);
        verify(repo).save(captor.capture());
        assertNull(captor.getValue().getVersion());
    }
}
