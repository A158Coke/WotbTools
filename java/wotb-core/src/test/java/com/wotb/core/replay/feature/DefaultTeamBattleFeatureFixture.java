package com.wotb.core.replay.feature;

import com.wotb.core.model.Battle;
import com.wotb.core.model.PlayerResult;
import com.wotb.core.replay.event.DamageEvent;
import com.wotb.core.replay.event.DecodeConfidence;
import com.wotb.core.replay.event.HealthChangedEvent;
import com.wotb.core.replay.event.ParticipantMappingEvent;
import com.wotb.core.replay.event.PositionChangedEvent;
import com.wotb.core.replay.event.ReplayEvent;
import com.wotb.core.replay.event.ReplayTimestamp;
import com.wotb.core.replay.processing.TeamPerspectiveResolution;
import com.wotb.core.replay.processing.TeamPerspectiveResolver;
import com.wotb.core.replay.reconstruction.BattleParticipant;
import com.wotb.core.replay.reconstruction.ReplayCoverage;
import com.wotb.core.replay.reconstruction.ReplayReconstruction;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;

abstract class DefaultTeamBattleFeatureFixture {

    protected final DefaultTeamBattleFeatureExtractor extractor =
            new DefaultTeamBattleFeatureExtractor();







    protected TeamBattleFeatureSet extractWithStart(
            final Fixture fixture,
            final List<? extends ReplayEvent> events,
            final Float battleStartRaw
    ) {
        final ReplayCoverage coverage = new ReplayCoverage(events.size(), events.size(), 0, 0, 0, 1.0, Map.of());
        final ReplayReconstruction reconstruction = new ReplayReconstruction(
                null, null, 300f, battleStartRaw,
                fixture.participants(), List.copyOf(events), List.of(), null,
                coverage, null);
        final TeamPerspectiveResolution perspective =
                TeamPerspectiveResolver.resolve(fixture.battle(), reconstruction);
        return extractor.extract(fixture.battle(), reconstruction, perspective);
    }

    protected int formationClusters(final Fixture fixture, final float distance) {
        final List<ReplayEvent> events = List.of(
                mapping(1, 10, 100L),
                mapping(2, 11, 101L),
                position(3, 5f, 10, 0f, 0f),
                position(4, 5f, 11, distance, 0f));
        return extract(fixture, events)
                .formationPhases()
                .getFirst()
                .clusterCount();
    }

    /** Two-position version with separate raw X coordinates. */
    protected int formationClusters(final Fixture fixture, final float rawX1, final float rawX2) {
        final List<ReplayEvent> events = List.of(
                mapping(1, 10, 100L),
                mapping(2, 11, 101L),
                position(3, 5f, 10, rawX1, 0f),
                position(4, 5f, 11, rawX2, 0f));
        return extract(fixture, events)
                .formationPhases()
                .getFirst()
                .clusterCount();
    }

    protected TeamBattleFeatureSet extract(
            final Fixture fixture,
            final List<? extends ReplayEvent> events
    ) {
        final ReplayReconstruction reconstruction = reconstruction(fixture, events);
        final TeamPerspectiveResolution perspective =
                TeamPerspectiveResolver.resolve(fixture.battle(), reconstruction);
        return extractor.extract(fixture.battle(), reconstruction, perspective);
    }

    protected static Fixture fixture() {
        final PlayerResult allyOne = player(100L, "AllyOne", 1, 400, 100, true, 0);
        final PlayerResult allyTwo = player(101L, "AllyTwo", 1, 300, 200, false, 30_000);
        final PlayerResult enemy = player(200L, "Enemy", 2, 600, 300, true, 0);
        final Battle battle = new Battle();
        battle.arenaId = "arena-team";
        battle.arenaBonusType = 2;
        battle.mapName = "test-map";
        battle.durationS = 120.0;
        battle.winnerTeam = 1;
        battle.recorder = "AllyOne";
        // 完整结算阵容（2v1 训练房）：允许 SURVIVOR_SETTLEMENT / 全歼判定
        battle.rosterComplete = true;
        battle.players = List.of(allyOne, allyTwo, enemy);

        final List<BattleParticipant> participants = List.of(
                new BattleParticipant(100L, "AllyOne", 1, 1, "a", true),
                new BattleParticipant(101L, "AllyTwo", 1, 2, "b", false),
                new BattleParticipant(200L, "Enemy", 2, 3, "c", false));
        final List<ReplayEvent> events = List.of(
                mapping(1, 10, 100L),
                mapping(2, 11, 101L),
                mapping(3, 20, 200L),
                position(4, 5f, 10, 0f, 0f),
                position(5, 8f, 10, 2.5f, 0f),
                position(6, 5f, 11, 125f, 0f),
                position(7, 8f, 11, 127.5f, 0f),
                position(8, 5f, 20, 250f, 250f),
                damage(9, 20f, 10, 20, 200),
                damage(10, 25f, 20, 11, 150),
                damage(11, 30f, 99, 11, 400),
                health(12, 19f, 20, 900), health(13, 20f, 20, 700),
                health(14, 24f, 11, 800), health(15, 25f, 11, 650),
                health(16, 29f, 11, 650), health(17, 30f, 11, 250));
        return new Fixture(battle, participants, events);
    }

    protected static Fixture fixtureWithSecondEnemy() {
        final Fixture base = fixture();
        final PlayerResult enemyTwo =
                player(201L, "EnemyTwo", 2, 500, 200, true, 0);
        base.battle().players = new ArrayList<>(base.battle().players);
        base.battle().players.add(enemyTwo);
        final List<BattleParticipant> participants =
                new ArrayList<>(base.participants());
        participants.add(new BattleParticipant(
                201L, "EnemyTwo", 2, 4, "d", false));
        return new Fixture(base.battle(), participants, base.events());
    }

    protected static PlayerResult player(
            final long accountId,
            final String nickname,
            final int team,
            final int damageDealt,
            final int damageReceived,
            final boolean survived,
            final long deathTimeMillis
    ) {
        final PlayerResult player = new PlayerResult();
        player.accountId = accountId;
        player.nickname = nickname;
        player.team = team;
        player.damageDealt = damageDealt;
        player.damageReceived = damageReceived;
        player.damageAssisted = 25;
        player.damageBlocked = 50;
        player.kills = 1;
        player.survived = survived;
        player.deathTimeMillis = deathTimeMillis;
        if (!survived) {
            player.settlementLifeTimeSec = deathTimeMillis / 1000.0;
        }
        player.tankId = accountId + 1;
        player.tankName = "tank-" + accountId;
        return player;
    }

    protected static ParticipantMappingEvent mapping(
            final int sequence,
            final int entityId,
            final long accountId
    ) {
        return new ParticipantMappingEvent(
                sequence, new ReplayTimestamp(sequence, null), 8,
                DecodeConfidence.EXACT, entityId, accountId);
    }

    protected static PositionChangedEvent position(
            final int sequence,
            final float time,
            final int entityId,
            final float x,
            final float z
    ) {
        return position(
                sequence, time, entityId, x, z, DecodeConfidence.EXACT);
    }

    protected static PositionChangedEvent position(
            final int sequence,
            final float time,
            final int entityId,
            final float x,
            final float z,
            final DecodeConfidence confidence
    ) {
        return new PositionChangedEvent(
                sequence, new ReplayTimestamp(time, null), 10,
                confidence, entityId, 0, 0,
                x, 0, z, 0, 0, 0, 0, 0, 0, 0);
    }

    protected static PositionChangedEvent positionWithElevation(
            final int sequence,
            final float time,
            final int entityId,
            final float y
    ) {
        return new PositionChangedEvent(
                sequence, new ReplayTimestamp(time, null), 10,
                DecodeConfidence.EXACT, entityId, 0, 0,
                0, y, 0, 0, 0, 0, 0, 0, 0, (byte) 0);
    }

    protected static DamageEvent damage(
            final int sequence,
            final float time,
            final int attacker,
            final int victim,
            final int damage
    ) {
        return new DamageEvent(
                sequence, new ReplayTimestamp(time, null), 8,
                DecodeConfidence.EXACT, attacker, victim,
                null, null, damage, false);
    }

    /** Type-7 propId=3 当前血量（EXACT；掉血推导的数据源）。 */
    protected static HealthChangedEvent health(
            final int sequence,
            final float time,
            final int entityId,
            final int hp
    ) {
        return new HealthChangedEvent(
                sequence, new ReplayTimestamp(time, null), 7,
                DecodeConfidence.EXACT, entityId, hp, null, true);
    }

    protected static ReplayReconstruction reconstruction(
            final Fixture fixture,
            final List<? extends ReplayEvent> events
    ) {
        final ReplayCoverage coverage = new ReplayCoverage(events.size(), events.size(), 0, 0, 0,
                1.0, Map.of());
        return new ReplayReconstruction(
                null, null, 120f, 0f,
                fixture.participants(), List.copyOf(events), List.of(), null,
                coverage, null);
    }

    protected record Fixture(
            Battle battle,
            List<BattleParticipant> participants,
            List<ReplayEvent> events
    ) {
    }
}

