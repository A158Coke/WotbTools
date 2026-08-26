package com.wotb.web.replay.service;

import com.wotb.core.model.Battle;
import com.wotb.core.model.PlayerResult;
import com.wotb.web.replay.dto.RatingV2Response;
import com.wotb.web.replay.job.ProcessedDataset;
import com.wotb.web.replay.job.ReplayProcessingJobService;
import org.junit.jupiter.api.Test;

import java.util.List;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

class RatingV2AdminServiceTest {

    @Test
    void computesOnlyFromTheExistingReadyDataset() {
        final ReplayProcessingJobService jobs = mock(ReplayProcessingJobService.class);
        final Battle battle = new Battle();
        battle.players = List.of(player(1, 1, 2100), player(2, 2, 100));
        final ProcessedDataset dataset = new ProcessedDataset(
                List.of(battle), List.of("gray.wotbreplay"),
                List.<String[]>of(new String[]{"duplicate.wotbreplay", "DUPLICATE"}),
                List.<String[]>of(new String[]{"failed.wotbreplay", "REPLAY_PROCESSING_FAILED"}), null, null);
        when(jobs.readyDataset("ready-job")).thenReturn(dataset);

        final RatingV2Response result = new RatingV2AdminService(jobs).analyzeReadyJob("ready-job");

        verify(jobs).readyDataset("ready-job");
        assertEquals(2, result.rows().size());
        assertEquals(1, result.duplicates().size());
        assertEquals(1, result.failures().size());
        assertTrue(result.columns().stream().anyMatch(column -> column.key().equals("rating")));
        assertTrue(result.columns().stream().noneMatch(column -> column.key().equals("account_id")));
    }

    private static PlayerResult player(final long accountId, final int team, final int damage) {
        final PlayerResult player = new PlayerResult();
        player.accountId = accountId;
        player.nickname = "p" + accountId;
        player.team = team;
        player.tankId = 4481L;
        player.damageDealt = damage;
        player.survived = true;
        return player;
    }
}
