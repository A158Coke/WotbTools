package com.wotb.core.ai;

import com.wotb.core.model.Battle;
import com.wotb.core.model.PlayerResult;
import com.wotb.core.replay.reconstruction.BattleLifecycle;
import com.wotb.core.replay.reconstruction.BattleStateCheckpoint;
import com.wotb.core.replay.reconstruction.BattleStateSnapshot;
import com.wotb.core.replay.reconstruction.ObservationState;
import com.wotb.core.replay.reconstruction.ReplayReconstruction;
import com.wotb.core.replay.reconstruction.Vector3;
import com.wotb.core.replay.reconstruction.VehicleState;
import org.junit.jupiter.api.Test;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * 敌方情报可用性：事件流里的 entityId 必须能解析成
 * 「阵营 + 昵称 + 权威坦克名称 + 结构化车种」，否则位置时间线只是匿名 Entity#id，
 * AI 拿到了敌人的位置和时间却无法归属到具体车辆。
 */
class EntityIdentityResolverTest {

    private static final long HEAVY_TANK_ID = 6145L;   // tankopedia: IS-4 / 重坦 / 10 / 苏联
    private static final long RECORDER_ACCOUNT = 1L;
    private static final long ENEMY_ACCOUNT = 2L;
    private static final int RECORDER_ENTITY = 5;
    private static final int ENEMY_ENTITY = 7;

    @Test
    void resolvesEnemyEntityToSideNicknameTankAndClass() {
        final Battle battle = battle();
        final Map<Integer, String> labels = EntityIdentityResolver.resolveLabels(
                recon(), battle, RECORDER_ACCOUNT);

        final String enemyLabel = labels.get(ENEMY_ENTITY);
        assertTrue(enemyLabel.startsWith("敌方 "), enemyLabel);
        assertTrue(enemyLabel.contains("\"EnemyAce\""), enemyLabel);
        assertTrue(enemyLabel.contains("坦克: \"IS-4\""), enemyLabel);
        assertTrue(enemyLabel.contains("车种: 重坦"), enemyLabel);
        // 结构化车辆事实来自 tankopedia，而不是名称推断
        assertTrue(enemyLabel.contains("等级: 10"), enemyLabel);
        assertTrue(enemyLabel.contains("国家: 苏联"), enemyLabel);
        assertTrue(enemyLabel.contains("炮伤: 420"), enemyLabel);
        assertFalse(enemyLabel.contains("自行火炮"), enemyLabel);
        assertFalse(enemyLabel.contains("SPG"), enemyLabel);
    }

    @Test
    void recorderEntityIsLabelledAsSecondPersonNotAsAnEnemy() {
        final Map<Integer, String> labels = EntityIdentityResolver.resolveLabels(
                recon(), battle(), RECORDER_ACCOUNT);
        // 复盘直接面向玩家本人，实体标签用「你」，不再出现「录像者」
        assertEquals("你", labels.get(RECORDER_ENTITY));
    }

    @Test
    void teammatesAreCalledTeammatesNotFriendly() {
        final PlayerResult teammate = new PlayerResult();
        teammate.accountId = 3L;
        teammate.nickname = "Mate";
        teammate.team = 1;
        teammate.tankId = HEAVY_TANK_ID;
        final Battle battle = new Battle();
        battle.players = List.of(recorder(), teammate);
        battle.recorder = "Recorder";
        battle.winnerTeam = 1;

        final String label = EntityIdentityResolver.label(battle, teammate, RECORDER_ACCOUNT);

        assertTrue(label.startsWith("队友 "), label);
        assertFalse(label.contains("友方"), label);
    }

    @Test
    void legendMapsShortEntityIdsToIdentities() {
        final String legend = EntityIdentityResolver.legend(
                EntityIdentityResolver.resolveLabels(recon(), battle(), RECORDER_ACCOUNT));

        assertTrue(legend.startsWith("# 实体对照: "), legend);
        assertTrue(legend.contains("E" + ENEMY_ENTITY + "=敌方 "), legend);
        assertTrue(legend.contains("E" + RECORDER_ENTITY + "=你"), legend);
        assertTrue(legend.endsWith("\n"), legend);
    }

    @Test
    void unresolvableEntitiesAreOmittedSoCallersCanFallBack() {
        // 名册里没有该 accountId → 不产生标签，调用方回退为中性 E<id>
        final VehicleState stranger = vehicle(99, 4242L, HEAVY_TANK_ID);
        final ReplayReconstruction recon = reconWith(checkpoint(1.0f, stranger));

        final Map<Integer, String> labels =
                EntityIdentityResolver.resolveLabels(recon, battle(), RECORDER_ACCOUNT);

        assertFalse(labels.containsKey(99), labels.toString());
        assertTrue(labels.isEmpty(), labels.toString());
    }

    @Test
    void missingTankopediaFactsAreSimplyOmitted() {
        final PlayerResult enemy = new PlayerResult();
        enemy.accountId = ENEMY_ACCOUNT;
        enemy.nickname = "NoTankData";
        enemy.team = 2;
        enemy.tankId = 999_999_999L;   // tankopedia 无此车
        final Battle battle = new Battle();
        battle.players = List.of(recorder(), enemy);
        battle.recorder = "Recorder";
        battle.winnerTeam = 1;

        final String label = EntityIdentityResolver.label(battle, enemy, RECORDER_ACCOUNT);

        assertTrue(label.contains("车种: 未知"), label);
        assertFalse(label.contains("等级:"), label);
        assertFalse(label.contains("国家:"), label);
    }

    @Test
    void nullReconOrBattleYieldsEmptyLabelsInsteadOfThrowing() {
        assertTrue(EntityIdentityResolver.resolveLabels(null, battle(), RECORDER_ACCOUNT).isEmpty());
        assertTrue(EntityIdentityResolver.resolveLabels(recon(), null, RECORDER_ACCOUNT).isEmpty());
        assertEquals("", EntityIdentityResolver.legend(Map.of()));
    }

    // ---- fixtures ----

    private static PlayerResult recorder() {
        final PlayerResult p = new PlayerResult();
        p.accountId = RECORDER_ACCOUNT;
        p.nickname = "Recorder";
        p.team = 1;
        p.survived = true;
        return p;
    }

    private static PlayerResult enemyAce() {
        final PlayerResult p = new PlayerResult();
        p.accountId = ENEMY_ACCOUNT;
        p.nickname = "EnemyAce";
        p.team = 2;
        p.tankId = HEAVY_TANK_ID;
        p.damageDealt = 2_100;
        p.survived = true;
        return p;
    }

    private static Battle battle() {
        final Battle battle = new Battle();
        battle.players = List.of(recorder(), enemyAce());
        battle.recorder = "Recorder";
        battle.winnerTeam = 1;
        return battle;
    }

    @Test
    void sideIsUnknownWhenTheRecorderCannotBeResolved() {
        final Battle battle = new Battle();
        battle.players = List.of(recorder(), enemyAce());
        battle.winnerTeam = 1;   // 未设置 recorder → 录像者队伍不可知

        final String label = EntityIdentityResolver.label(battle, enemyAce(), RECORDER_ACCOUNT);

        // 不臆断阵营：无法确定时诚实输出「未知阵营」
        assertTrue(label.startsWith("未知阵营 "), label);
    }

    private static VehicleState vehicle(final int entityId, final long accountId, final long tankId) {
        final VehicleState vs = new VehicleState(entityId, 1.0f);
        vs.setAccountId(accountId);
        vs.setLastObservedAt(1.0f);
        vs.setPosition(new Vector3(0f, 0f, 0f));
        vs.setObservationState(ObservationState.OBSERVED);
        vs.setTankId((int) tankId);
        return vs;
    }

    private static BattleStateCheckpoint checkpoint(final float clock, final VehicleState... vehicles) {
        final Map<Integer, VehicleState> byEntityId = new LinkedHashMap<>();
        final Map<Long, Integer> byAccountId = new LinkedHashMap<>();
        for (final VehicleState vs : vehicles) {
            byEntityId.put(vs.entityId(), vs);
            if (vs.accountId() != null) {
                byAccountId.put(vs.accountId(), vs.entityId());
            }
        }
        return new BattleStateCheckpoint(clock, 0, new BattleStateSnapshot(
                clock, clock, BattleLifecycle.IN_PROGRESS,
                byEntityId, byAccountId, List.of(), false, null));
    }

    private static ReplayReconstruction recon() {
        return reconWith(checkpoint(1.0f,
                vehicle(RECORDER_ENTITY, RECORDER_ACCOUNT, 1L),
                vehicle(ENEMY_ENTITY, ENEMY_ACCOUNT, HEAVY_TANK_ID)));
    }

    private static ReplayReconstruction reconWith(final BattleStateCheckpoint... checkpoints) {
        return new ReplayReconstruction(
                null, null, 300f, 0f, List.of(), List.of(),
                List.of(checkpoints), null, null, null);
    }
}
