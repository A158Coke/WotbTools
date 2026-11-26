package com.wotb.ai.review;

import com.wotb.core.ai.AiTokenEstimator;
import com.wotb.core.ai.ConservativeDeepSeekTokenEstimator;
import com.wotb.core.model.Battle;
import com.wotb.core.model.PlayerResult;
import com.wotb.core.replay.event.DamageEvent;
import com.wotb.core.replay.event.DecodeConfidence;
import com.wotb.core.replay.event.ParticipantMappingEvent;
import com.wotb.core.replay.event.PositionChangedEvent;
import com.wotb.core.replay.event.ReplayEvent;
import com.wotb.core.replay.event.ReplayTimestamp;
import com.wotb.core.replay.feature.BattlePhaseSummary;
import com.wotb.core.replay.feature.CanonicalMapPosition;
import com.wotb.core.replay.feature.MovementSegment;
import com.wotb.core.replay.feature.MovementType;
import com.wotb.core.replay.feature.SingleTeamBattleAnalysisContext;
import com.wotb.core.replay.feature.TeamAggregateResult;
import com.wotb.core.replay.feature.TeamBattleFeatureSet;
import com.wotb.core.replay.feature.TeamEngagementSummary;
import com.wotb.core.replay.feature.TeamFeatureCoverage;
import com.wotb.core.replay.feature.TeamFormationPhase;
import com.wotb.core.replay.feature.TeamMemberFeatureSet;
import com.wotb.core.replay.feature.TeamObservedAggregate;
import com.wotb.core.replay.reconstruction.ReplayCoverage;
import com.wotb.core.replay.reconstruction.ReplayReconstruction;
import com.wotb.core.replay.reconstruction.Vector3;
import org.junit.jupiter.api.Test;

import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.Set;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

abstract class TeamAiPromptBuilderTestSupport {
protected static SingleTeamBattleAnalysisContext contextWithMembers(
            final int memberCount,
            final int nicknameLength
    ) {
        final List<PlayerResult> players = new ArrayList<>();
        for (int index = 0; index < memberCount; index++) {
            final PlayerResult player = new PlayerResult();
            player.accountId = 10_000L + index;
            player.nickname = ("P" + index).repeat(nicknameLength);
            player.team = 1;
            player.damageDealt = 1_000 + index;
            player.survived = true;
            players.add(player);
        }
        return buildContext(players);
    }
    protected static SingleTeamBattleAnalysisContext contextWithNickname(
            final String nickname
    ) {
        final PlayerResult player = new PlayerResult();
        player.accountId = 10_001L;
        player.nickname = nickname;
        player.team = 1;
        player.damageDealt = 1_000;
        player.survived = true;
        return buildContext(List.of(player));
    }
    protected static PlayerResult player(
            final long accountId,
            final String nickname,
            final int team,
            final long tankId
    ) {
        final PlayerResult result = new PlayerResult();
        result.accountId = accountId;
        result.nickname = nickname;
        result.team = team;
        result.tankId = tankId;
        result.damageDealt = 1_000;
        result.survived = true;
        return result;
    }
    protected static SingleTeamBattleAnalysisContext buildContext(
            final List<PlayerResult> players
    ) {
        final Battle battle = new Battle();
        battle.arenaId = "budget-arena";
        battle.mapName = "budget_map";
        battle.arenaBonusType = 2;
        battle.durationS = 300.0;
        battle.winnerTeam = 1;
        battle.players = players;
        battle.recorder = players.getFirst().nickname;
        return TeamContextBuilder.buildSingleTeamContext(battle, null);
    }
    protected static String singleWithPrior(final Battle battle,
                                          final int perspectiveTeam,
                                          final PreBattleStrategicPrior prior) {
        final TeamMemberFeatureSet member = new TeamMemberFeatureSet(
                List.of(perspectiveTeam), 10_000L + perspectiveTeam, "P", 4481L, "Kranvagn", perspectiveTeam,
                DecodeConfidence.EXACT, 1000, 0, 0, 0, 0,
                true, null, List.of(), List.of(), List.of(), List.of());
        final TeamAggregateResult aggregate = new TeamAggregateResult(
                perspectiveTeam, 1000, 0, 0, 0, 0, 1, 0, null, null, null, true);
        final TeamBattleFeatureSet features = new TeamBattleFeatureSet(
                perspectiveTeam, List.of(member), aggregate, TeamObservedAggregate.empty(),
                List.of(), List.of(), List.of(), List.of(),
                TeamFeatureCoverage.empty(), List.of(), true);
        final SingleTeamBattleAnalysisContext context = new SingleTeamBattleAnalysisContext(
                "unit-A", null, "f.wotbreplay", null, battle, perspectiveTeam, features,
                null, List.of(), null);
        return TeamAiPromptBuilder.single(
                context, List.of(), prior, null, Integer.MAX_VALUE).content();
    }
    protected static String between(final String content, final String from, final String to) {
        final int start = content.indexOf(from);
        final int end = content.indexOf(to, start + from.length());
        return end < 0 ? content.substring(start) : content.substring(start, end);
    }
    protected static int occurrences(final String value, final String token) {
        int count = 0;
        int index = 0;
        while ((index = value.indexOf(token, index)) >= 0) {
            count++;
            index += token.length();
        }
        return count;
    }
        protected static SingleTeamBattleAnalysisContext pointsSituationContext() {
            final Battle battle = new Battle();
            battle.mapName = "holland";
            battle.arenaBonusType = 2;
            battle.durationS = 420.0;
            battle.winnerTeam = 1;
            final List<PlayerResult> players = new ArrayList<>();
            for (int index = 0; index < 7; index++) {
                final PlayerResult player = new PlayerResult();
                player.accountId = 10_000L + index;
                player.nickname = "Ally" + index;
                player.team = 1;
                player.survived = false;
                player.deathTimeMillis = 40_000L + index * 5_000L;
            player.settlementLifeTimeSec = 40 + index * 5;
                players.add(player);
            }
            for (int index = 0; index < 7; index++) {
                final PlayerResult player = new PlayerResult();
                player.accountId = 20_000L + index;
                player.nickname = "Enemy" + index;
                player.team = 2;
                player.survived = true;
                players.add(player);
            }
            battle.players = players;
            final SingleTeamBattleAnalysisContext base = contextWithNickname("Player");
            final List<ReplayEvent> events = new ArrayList<>();
            events.add(new ParticipantMappingEvent(1, new ReplayTimestamp(20f, null), 8,
                    DecodeConfidence.EXACT, 10, 10_000L));
            events.add(new ParticipantMappingEvent(2, new ReplayTimestamp(20f, null), 8,
                    DecodeConfidence.EXACT, 20, 20_000L));
            events.add(positionEvent(3, 40f, 10, -80f, 120f));
            events.add(positionEvent(4, 42f, 10, -80f, 0f));
            events.add(positionEvent(5, 44f, 10, -70f, 0f));
            events.add(positionEvent(6, 40f, 20, 0f, 0f));
            events.add(positionEvent(7, 42f, 20, 10f, 0f));
            final ReplayReconstruction recon = new ReplayReconstruction(null, null, 600f, 30f,
                    List.of(), events, List.of(), null, null, null);
            return new SingleTeamBattleAnalysisContext(
                    base.analysisUnitId(), base.battleId(), base.fileName(),
                    base.battleCategory(), battle, 1, base.features(),
                    base.coverage(), base.limitations(), recon);
        }
    protected static PositionChangedEvent positionEvent(final int sequence, final float rawClock,
                                                      final int entityId, final float x, final float z) {
        return new PositionChangedEvent(sequence, new ReplayTimestamp(rawClock, null), 10,
                DecodeConfidence.EXACT, entityId, 0, 0, x, 0f, z,
                0f, 0f, 0f, 0f, 0f, 0f, (byte) 0);
    }
}
