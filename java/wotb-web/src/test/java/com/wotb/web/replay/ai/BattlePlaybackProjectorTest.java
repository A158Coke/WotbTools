package com.wotb.web.replay.ai;

import com.wotb.core.model.Battle;
import com.wotb.core.model.PlayerResult;
import com.wotb.core.parse.ReplayParser;
import com.wotb.core.replay.processing.TeamEntityMapper;
import com.wotb.core.replay.processing.TeamEntityMapping;
import com.wotb.core.replay.reconstruction.ReplayReconstruction;
import com.wotb.core.replay.reconstruction.ReplayReconstructionService;
import com.wotb.core.replay.timeline.BattleTimeline;
import com.wotb.core.replay.timeline.BattleTimelineBuilder;
import com.wotb.core.replay.timeline.BattleTimelineResult;
import com.wotb.core.replay.timeline.TimelineError;
import com.wotb.core.replay.timeline.TimelinePerspective;
import com.wotb.web.replay.dto.BattlePlaybackDataset;
import org.junit.jupiter.api.Test;

import java.nio.file.Files;
import java.nio.file.Path;
import java.util.stream.Stream;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * BattlePlaybackProjector V2：从 canonical timeline + facts 稀疏投影到
 * {@link BattlePlaybackDataset}。真实夹具验证 —— timeline 可用时必须产出可用 dataset。
 */
class BattlePlaybackProjectorTest {

    private static Path fixture() throws Exception {
        final Path dir = Path.of(System.getProperty("user.dir"), "..", "..", "common", "fixtures", "replays")
                .normalize();
        try (Stream<Path> s = Files.list(dir)) {
            return s.filter(p -> p.getFileName().toString().contains("random-battle-example"))
                    .findFirst().orElseThrow();
        }
    }

    @Test
    void projectorProducesV2DatasetFromCanonicalTimeline() throws Exception {
        final byte[] bytes = Files.readAllBytes(fixture());
        final Battle battle = ReplayParser.parse(bytes);
        final ReplayReconstruction recon = new ReplayReconstructionService().reconstruct(bytes);
        final PlayerResult recorder = battle.recorderResult();
        assertNotNull(recorder);

        final BattleTimelineResult tl = BattleTimelineBuilder.build(
                battle, recon, TimelinePerspective.personal(
                        recorder.accountId > 0 ? recorder.accountId : null, recorder.team));
        if (recon.battleStartRawClockSec() == null) {
            assertFalse(tl.usable(), "no battle-start authority => fail-closed: " + tl.validation().errors());
            assertTrue(tl.validation().errors().contains(TimelineError.TIMELINE_CLOCK_UNRESOLVED));
            return;
        }
        assertTrue(tl.usable(), "real replay must build timeline: " + tl.validation().errors());
        final BattleTimeline timeline = tl.timeline();
        final TeamEntityMapping mapping = TeamEntityMapper.resolve(battle, recon);
        final Long recorderId = recorder.accountId > 0 ? recorder.accountId : null;

        final BattlePlaybackDataset ds = BattlePlaybackProjector.project(battle, timeline, mapping, recorderId);
        assertNotNull(ds, "V2 dataset must build on fixture");
        assertTrue(ds.durationSec() > 0);
        assertTrue(ds.vehicles().size() > 0, "at least one vehicle track");
        assertEquals(battle.players.size(), ds.vehicles().size(),
                "all #301 actual combatants projected as vehicle tracks");

        // 每辆车：identity + position segments + health transitions（canonical projection）
        for (final BattlePlaybackDataset.VehiclePlaybackTrack v : ds.vehicles()) {
            assertTrue(v.accountId() > 0);
            assertFalse(v.positionSegments().isEmpty(), "vehicle must have observed position segments");
        }
    }

    @Test
    void recorderWinsAsFriendlyTeamAnchor() throws Exception {
        final byte[] bytes = Files.readAllBytes(fixture());
        final Battle battle = ReplayParser.parse(bytes);
        final ReplayReconstruction recon = new ReplayReconstructionService().reconstruct(bytes);
        final PlayerResult recorder = battle.recorderResult();
        final BattleTimelineResult tl = BattleTimelineBuilder.build(
                battle, recon, TimelinePerspective.personal(
                        recorder.accountId > 0 ? recorder.accountId : null, recorder.team));
        if (!tl.usable()) {
            return;
        }
        final TeamEntityMapping mapping = TeamEntityMapper.resolve(battle, recon);
        final Long recorderId = recorder.accountId > 0 ? recorder.accountId : null;
        final BattlePlaybackDataset ds = BattlePlaybackProjector.project(
                battle, tl.timeline(), mapping, recorderId);
        assertNotNull(ds);
        assertEquals(recorder.team, ds.friendlyTeam().intValue(), "friendlyTeam must be recorder team");
        assertEquals(recorder.accountId, ds.recorderAccountId().longValue());
        // recorder vehicle is marked friendly=true
        assertTrue(ds.vehicles().stream()
                .filter(v -> v.accountId() == recorder.accountId)
                .findFirst().orElseThrow().friendly());
    }
}
