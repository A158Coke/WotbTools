package com.wotb.core.replay.feature;

import com.wotb.core.processing.TeamEntityIdentity;
import com.wotb.core.processing.TeamEntityMapping;
import com.wotb.core.replay.event.DamageEvent;
import com.wotb.core.replay.event.DecodeConfidence;
import com.wotb.core.replay.event.HealthChangedEvent;
import com.wotb.core.replay.event.ReplayTimestamp;
import com.wotb.core.replay.event.UnsupportedDamageEvent;
import org.junit.jupiter.api.Test;

import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * PlaybackCombatReconstruction 单测（docs/current-plan.md §12/§13/§15/§42）：
 * 权威 HP loss 推导 + 攻击者 attribution 边界 + 击毁/击杀推导。
 */
class PlaybackCombatReconstructionTest {

    private static final double START = 1000.0;
    private static final double DURATION = 200.0;

    private final TeamEntityMapping mapping = new TeamEntityMapping(
            Map.of(
                    1, new TeamEntityIdentity(1, 1001, "A", 1, "T1", 1, DecodeConfidence.EXACT),
                    2, new TeamEntityIdentity(2, 2002, "B", 2, "T2", 2, DecodeConfidence.EXACT),
                    3, new TeamEntityIdentity(3, 3003, "C", 3, "T3", 2, DecodeConfidence.EXACT),
                    4, new TeamEntityIdentity(4, 4004, "D", 4, "T4", 2, DecodeConfidence.EXACT)),
            Map.of(
                    1001L, List.of(1),
                    2002L, List.of(2),
                    3003L, List.of(3),
                    4004L, List.of(4)),
            0, List.of());

    private static HealthChangedEvent hp(final int seq, final double rawSec, final int entity,
                                         final Integer hp, final Boolean alive, final DecodeConfidence conf) {
        return new HealthChangedEvent(seq, new ReplayTimestamp((float) rawSec, null), 7, conf,
                entity, hp, null, alive);
    }

    private static DamageEvent dmg(final int seq, final double rawSec, final int attacker,
                                   final int victim, final int rawDamage) {
        return new DamageEvent(seq, new ReplayTimestamp((float) rawSec, null), 8,
                DecodeConfidence.EXACT, attacker, victim, null, null, rawDamage, false);
    }

    /** 结构合法但语义未解码的伤害方法变体（火灾/撞击等；attacker=0 → 身份无法解析）。 */
    private static UnsupportedDamageEvent unsup(final int seq, final double rawSec,
                                                final int attacker, final int victim) {
        return new UnsupportedDamageEvent(seq, new ReplayTimestamp((float) rawSec, null), 8,
                DecodeConfidence.PARTIAL, attacker, victim, null, null, "DAMAGE_METHOD_VARIANT");
    }

    private PlaybackCombatReconstruction.Result derive(final List<com.wotb.core.replay.event.ReplayEvent> events) {
        return PlaybackCombatReconstruction.derive(events, mapping, START, DURATION);
    }

    @Test
    void singleAttackerWindowAttributedLoss() {
        // entity1: 3189 @10.2 -> 2812 @12.0；窗口 (10.2, 12.0] 内唯一 DAMAGE（attacker=entity2 @11.5）
        final var result = derive(List.of(
                hp(1, START + 10.2f, 1, 3189, true, DecodeConfidence.EXACT),
                hp(2, START + 12.0f, 1, 2812, true, DecodeConfidence.EXACT),
                dmg(3, START + 11.5f, 2, 1, 767)));
        final List<PlaybackCombatReconstruction.Loss> losses = result.lossesOf(1001L);
        assertEquals(1, losses.size());
        final PlaybackCombatReconstruction.Loss loss = losses.get(0);
        assertEquals(377, loss.hpLoss());
        assertEquals(2002L, loss.attackerAccountId());
        assertTrue(loss.attackerReliable());
        assertEquals(1, loss.damageEventCount());
        assertEquals(10.2, loss.fromSec(), 1e-3); // float 原始时钟 → 精度容差
        assertEquals(12.0, loss.toSec(), 1e-3);
        assertTrue(result.destroyed().isEmpty());
    }

    @Test
    void mixedAttackersUnattributedButLossRecorded() {
        // entity1: 3189 @10.2 -> 2812 @12.0；窗口内两个不同攻击者（entity2 @11.5、entity3 @11.8）
        final var result = derive(List.of(
                hp(1, START + 10.2f, 1, 3189, true, DecodeConfidence.EXACT),
                hp(2, START + 12.0f, 1, 2812, true, DecodeConfidence.EXACT),
                dmg(3, START + 11.5f, 2, 1, 500),
                dmg(4, START + 11.8f, 3, 1, 500)));
        final PlaybackCombatReconstruction.Loss loss = result.lossesOf(1001L).get(0);
        assertEquals(377, loss.hpLoss());
        assertNull(loss.attackerAccountId());
        assertFalse(loss.attackerReliable());
        assertEquals(2, loss.damageEventCount());
    }

    @Test
    void sameAttackerMultipleNotificationsStillReliable() {
        // entity1: 3189 @10.2 -> 2812 @12.0；窗口内两条 DAMAGE 均来自 entity2
        final var result = derive(List.of(
                hp(1, START + 10.2f, 1, 3189, true, DecodeConfidence.EXACT),
                hp(2, START + 12.0f, 1, 2812, true, DecodeConfidence.EXACT),
                dmg(3, START + 11.5f, 2, 1, 400),
                dmg(4, START + 11.9f, 2, 1, 367)));
        final PlaybackCombatReconstruction.Loss loss = result.lossesOf(1001L).get(0);
        assertEquals(2002L, loss.attackerAccountId());
        assertTrue(loss.attackerReliable());
        assertEquals(2, loss.damageEventCount());
    }

    @Test
    void noNotificationLossRecordedWithoutAttacker() {
        // entity1 掉血但窗口内无 DAMAGE 通知（火灾/撞击/通知缺失）→ 掉血事实保留，attacker null
        final var result = derive(List.of(
                hp(1, START + 10.2f, 1, 3189, true, DecodeConfidence.EXACT),
                hp(2, START + 12.0f, 1, 2812, true, DecodeConfidence.EXACT)));
        final PlaybackCombatReconstruction.Loss loss = result.lossesOf(1001L).get(0);
        assertEquals(377, loss.hpLoss());
        assertNull(loss.attackerAccountId());
        assertFalse(loss.attackerReliable());
        assertEquals(0, loss.damageEventCount());
    }

    @Test
    void hpIncreaseIgnored() {
        // HP 单调非增：上升样本不产生 loss
        final var result = derive(List.of(
                hp(1, START + 10.2f, 1, 2812, true, DecodeConfidence.EXACT),
                hp(2, START + 12.0f, 1, 3189, true, DecodeConfidence.EXACT)));
        assertTrue(result.lossesOf(1001L).isEmpty());
    }

    @Test
    void sentinelAndPartialIgnored() {
        // PARTIAL 置信度 / 非法 HP 不进入样本
        final var result = derive(List.of(
                hp(1, START + 10.2f, 1, 3189, true, DecodeConfidence.PARTIAL),
                hp(2, START + 11.0f, 1, 0xFFFD, false, DecodeConfidence.EXACT),
                hp(3, START + 12.0f, 1, 2812, true, DecodeConfidence.EXACT)));
        assertTrue(result.lossesOf(1001L).isEmpty());
        assertTrue(result.destroyed().isEmpty());
    }

    @Test
    void destroyedWithKillerFromLethalDamage() {
        // entity1: 242 @30.0 -> 0 @31.0（alive=false）；最近 DAMAGE @30.8 attacker=entity2
        final var result = derive(List.of(
                hp(1, START + 30.0f, 1, 242, true, DecodeConfidence.EXACT),
                hp(2, START + 31.0f, 1, 0, false, DecodeConfidence.EXACT),
                dmg(3, START + 30.8f, 2, 1, 767)));
        assertEquals(1, result.destroyed().size());
        final PlaybackCombatReconstruction.Destroyed d = result.destroyed().get(0);
        assertEquals(1001L, d.victimAccountId());
        assertEquals(2002L, d.killerAccountId());
        assertEquals(31.0, d.timeSec(), 1e-6);
        // 掉血也计入（242 -> 0）
        final PlaybackCombatReconstruction.Loss loss = result.lossesOf(1001L).get(0);
        assertEquals(242, loss.hpLoss());
    }

    @Test
    void destroyedWithoutKillerWhenNoRecentDamage() {
        // entity1 归零但 0.25s 窗口内无 DAMAGE → killer null
        final var result = derive(List.of(
                hp(1, START + 30.0f, 1, 242, true, DecodeConfidence.EXACT),
                hp(2, START + 31.0f, 1, 0, false, DecodeConfidence.EXACT)));
        assertEquals(1, result.destroyed().size());
        assertNull(result.destroyed().get(0).killerAccountId());
    }

    @Test
    void damageAtWindowEdgeAttributionExclusiveLeft() {
        // DAMAGE 恰在 fromSec（左开）→ 不属于该窗口（属于前一窗口）；恰在 toSec（右闭）→ 属于
        final var result = derive(List.of(
                hp(1, START + 10.2f, 1, 3189, true, DecodeConfidence.EXACT),
                hp(2, START + 12.0f, 1, 2812, true, DecodeConfidence.EXACT),
                dmg(3, START + 10.2f, 2, 1, 999),  // 左开排除
                dmg(4, START + 12.0f, 3, 1, 500))); // 右闭包含
        final PlaybackCombatReconstruction.Loss loss = result.lossesOf(1001L).get(0);
        // 只有右闭的 12.0 在窗口内（左开排除 10.2）→ 唯一攻击者 entity3
        assertEquals(3003L, loss.attackerAccountId());
        assertTrue(loss.attackerReliable());
        assertEquals(1, loss.damageEventCount());
    }

    @Test
    void outOfRangeEventsIgnored() {
        final var result = derive(List.of(
                hp(1, START + 500.0f, 1, 3189, true, DecodeConfidence.EXACT),
                hp(2, START + 510.0f, 1, 2812, true, DecodeConfidence.EXACT)));
        assertTrue(result.lossesOf(1001L).isEmpty());
    }
    // ---- PR #107 Blocker 2：killer attribution fail-closed + 去重 ----

    @Test
    void killedWithTwoDifferentAttackersInWindowHasNoKiller() {
        // entity1 归零；致死窗口内两个不同攻击者（entity2 @30.8、entity3 @30.9）
        // → destroyed 保留、killer null（不得选"最后一个"）
        final var result = derive(List.of(
                hp(1, START + 30.0f, 1, 242, true, DecodeConfidence.EXACT),
                hp(2, START + 31.0f, 1, 0, false, DecodeConfidence.EXACT),
                dmg(3, START + 30.8f, 2, 1, 500),
                dmg(4, START + 30.9f, 3, 1, 500)));
        assertEquals(1, result.destroyed().size());
        final PlaybackCombatReconstruction.Destroyed d = result.destroyed().get(0);
        assertEquals(1001L, d.victimAccountId());
        assertNull(d.killerAccountId(), "窗口内多个不同攻击者 → killer 必须 fail-closed 为 null");
    }

    @Test
    void killedWithUnresolvedAttackerHasNoKiller() {
        // 致死窗口内一条攻击者身份无法解析（attacker entity=999 无映射 → account 0）
        // → destroyed 保留、killer null
        final var result = derive(List.of(
                hp(1, START + 30.0f, 1, 242, true, DecodeConfidence.EXACT),
                hp(2, START + 31.0f, 1, 0, false, DecodeConfidence.EXACT),
                dmg(3, START + 30.8f, 999, 1, 500)));
        assertEquals(1, result.destroyed().size());
        assertNull(result.destroyed().get(0).killerAccountId(),
                "攻击者身份无法解析 → killer 必须为 null");
    }

    @Test
    void killedBySelfCandidateHasNoKiller() {
        // 致死窗口内唯一通知是自伤（attacker == victim）→ killer null
        final var result = derive(List.of(
                hp(1, START + 30.0f, 1, 242, true, DecodeConfidence.EXACT),
                hp(2, START + 31.0f, 1, 0, false, DecodeConfidence.EXACT),
                dmg(3, START + 30.8f, 1, 1, 242)));
        assertEquals(1, result.destroyed().size());
        assertNull(result.destroyed().get(0).killerAccountId(),
                "自伤候选不得作 killer");
    }

    @Test
    void killedWithMixedResolvedAndUnresolvedHasNoKiller() {
        // 窗口内一条已解析（entity2）+ 一条未解析（999）→ 无法证明唯一归属 → killer null
        final var result = derive(List.of(
                hp(1, START + 30.0f, 1, 242, true, DecodeConfidence.EXACT),
                hp(2, START + 31.0f, 1, 0, false, DecodeConfidence.EXACT),
                dmg(3, START + 30.8f, 2, 1, 300),
                dmg(4, START + 30.9f, 999, 1, 300)));
        assertEquals(1, result.destroyed().size());
        assertNull(result.destroyed().get(0).killerAccountId(),
                "存在未解析攻击者 → 无法证明唯一归属 → killer null");
    }

    @Test
    void killedWithSameAttackerMultipleNotificationsResolvesKiller() {
        // 窗口内两条通知均来自同一攻击者（entity2）→ 唯一可信攻击者 → killer 正确
        // （同一攻击者多条一致通知视为可信，契约固定）
        final var result = derive(List.of(
                hp(1, START + 30.0f, 1, 242, true, DecodeConfidence.EXACT),
                hp(2, START + 31.0f, 1, 0, false, DecodeConfidence.EXACT),
                dmg(3, START + 30.75f, 2, 1, 200),
                dmg(4, START + 30.85f, 2, 1, 200)));
        assertEquals(1, result.destroyed().size());
        assertEquals(2002L, result.destroyed().get(0).killerAccountId(),
                "同一攻击者多条一致通知 → 唯一可信 killer");
    }

    @Test
    void killedNoDamageButHpZeroStillDestroyed() {
        // 只有 HP=0（alive=false），无任何 DAMAGE → destroyed 存在、killer null
        final var result = derive(List.of(
                hp(1, START + 30.0f, 1, 242, true, DecodeConfidence.EXACT),
                hp(2, START + 31.0f, 1, 0, false, DecodeConfidence.EXACT)));
        assertEquals(1, result.destroyed().size());
        assertNull(result.destroyed().get(0).killerAccountId());
        assertEquals(31.0, result.destroyed().get(0).timeSec(), 1e-6);
    }

    @Test
    void duplicateHpZeroEventsProduceSingleDestroyed() {
        // 同一 victim 重复 alive=false/HP=0 → 只生成一次 destroyed（保留最早时刻）
        final var result = derive(List.of(
                hp(1, START + 30.0f, 1, 242, true, DecodeConfidence.EXACT),
                hp(2, START + 31.0f, 1, 0, false, DecodeConfidence.EXACT),
                hp(3, START + 31.2f, 1, 0, false, DecodeConfidence.EXACT),
                dmg(4, START + 30.9f, 2, 1, 500)));
        assertEquals(1, result.destroyed().size());
        final PlaybackCombatReconstruction.Destroyed d = result.destroyed().get(0);
        assertEquals(31.0, d.timeSec(), 1e-6);
        assertEquals(2002L, d.killerAccountId());
    }

    @Test
    void duplicateHpZeroLaterEventKeepsEarliestTime() {
        // 事件顺序：先出现较晚的 HP=0，再出现较早的 → 保留最早可信击毁时刻
        final var result = derive(List.of(
                hp(1, START + 31.2f, 1, 0, false, DecodeConfidence.EXACT),
                hp(2, START + 30.0f, 1, 242, true, DecodeConfidence.EXACT),
                hp(3, START + 31.0f, 1, 0, false, DecodeConfidence.EXACT)));
        assertEquals(1, result.destroyed().size());
        assertEquals(31.0, result.destroyed().get(0).timeSec(), 1e-6);
    }

    @Test
    void killerNeverLeaksFromFutureDamage() {
        // 击毁时刻 31.0；另一辆车的 DAMAGE 在 31.0 后（32.0）不得被当作 killer——
        // 且未来事件不得影响该 destroyed 的 killer 归属
        final var result = derive(List.of(
                hp(1, START + 30.0f, 1, 242, true, DecodeConfidence.EXACT),
                hp(2, START + 31.0f, 1, 0, false, DecodeConfidence.EXACT),
                dmg(3, START + 30.8f, 2, 1, 500),
                dmg(4, START + 32.0f, 3, 1, 500)));
        assertEquals(1, result.destroyed().size());
        assertEquals(2002L, result.destroyed().get(0).killerAccountId(),
                "窗口外未来 DAMAGE 不得泄漏为 killer");
    }

    // ---- PR #107 Blocker 5：unsupported damage variant fail-closed + 权威致死窗口 ----

    @Test
    void killedWithUnsupportedVariantAndDirectDamageInWindowHasNoKiller() {
        // 致死窗口内：direct DAMAGE（entity2）+ 同一 victim 的 unsupported 变体（entity2）
        // → 无法排除 unsupported 是真实致死源 → killer 必须 null
        final var result = derive(List.of(
                hp(1, START + 30.0f, 1, 242, true, DecodeConfidence.EXACT),
                hp(2, START + 31.0f, 1, 0, false, DecodeConfidence.EXACT),
                dmg(3, START + 30.8f, 2, 1, 500),
                unsup(4, START + 30.9f, 2, 1)));
        assertEquals(1, result.destroyed().size());
        assertNull(result.destroyed().get(0).killerAccountId(),
                "窗口内存在 unsupported 变体 → killer 必须 fail-closed 为 null");
    }

    @Test
    void killedByUnsupportedLethalVariantWithStaleDirectDamageHasNoKiller() {
        // 真实致死源 = unsupported 变体（火灾/撞击 @30.9，攻击者无法解析）；窗口内还有一条
        // 更早的无关 direct DAMAGE（entity2 @30.7）——不得把该 direct attacker 错判为 killer
        final var result = derive(List.of(
                hp(1, START + 30.0f, 1, 242, true, DecodeConfidence.EXACT),
                hp(2, START + 31.0f, 1, 0, false, DecodeConfidence.EXACT),
                dmg(3, START + 30.7f, 2, 1, 300),
                unsup(4, START + 30.9f, 0, 1)));
        assertEquals(1, result.destroyed().size());
        assertNull(result.destroyed().get(0).killerAccountId(),
                "unsupported lethal 变体 + 前一条无关 direct DAMAGE → killer 必须 null");
    }

    @Test
    void killerBoundToAuthoritativeLethalLossWindowNotFixedQuarterSecond() {
        // 致死 HP-loss 窗口 = (30.0, 31.0]（242 → 0）；direct DAMAGE @30.6 距死亡 0.4s，
        // 超过固定 0.25s 回退窗口但仍在权威致死窗口内 → 唯一可信攻击者 → killer 正确归属
        final var result = derive(List.of(
                hp(1, START + 30.0f, 1, 242, true, DecodeConfidence.EXACT),
                hp(2, START + 31.0f, 1, 0, false, DecodeConfidence.EXACT),
                dmg(3, START + 30.6f, 2, 1, 767)));
        assertEquals(1, result.destroyed().size());
        assertEquals(2002L, result.destroyed().get(0).killerAccountId(),
                "killer 绑定权威致死 HP-loss 窗口而非固定 0.25s 最近通知");
    }

    @Test
    void unsupportedVariantOutsideLethalWindowDoesNotBlockKiller() {
        // unsupported 变体在致死窗口 (30.0, 31.0] 之前（29.5）→ 不在窗口内 → 不构成冲突，
        // 窗口内唯一可信 direct attacker 仍可归属 killer（窗口有界，不过度保守）
        final var result = derive(List.of(
                hp(1, START + 30.0f, 1, 242, true, DecodeConfidence.EXACT),
                hp(2, START + 31.0f, 1, 0, false, DecodeConfidence.EXACT),
                dmg(3, START + 30.8f, 2, 1, 767),
                unsup(4, START + 29.5f, 2, 1)));
        assertEquals(1, result.destroyed().size());
        assertEquals(2002L, result.destroyed().get(0).killerAccountId(),
                "窗口外的 unsupported 变体不得误伤窗口内唯一可信 killer");
    }

    @Test
    void unsupportedVariantDoesNotAffectLossAttribution() {
        // unsupported 变体不产生精确伤害数字：不得进入 Loss（掉血窗口仍由 Type-7 sample 推导）
        final var result = derive(List.of(
                hp(1, START + 10.2f, 1, 3189, true, DecodeConfidence.EXACT),
                hp(2, START + 12.0f, 1, 2812, true, DecodeConfidence.EXACT),
                unsup(3, START + 11.5f, 2, 1)));
        final PlaybackCombatReconstruction.Loss loss = result.lossesOf(1001L).get(0);
        assertEquals(377, loss.hpLoss());
        assertEquals(0, loss.damageEventCount(), "unsupported 变体不计入 damageEventCount");
        assertNull(loss.attackerAccountId(), "unsupported 变体不能 attribution 掉血");
        assertFalse(loss.attackerReliable());
        assertTrue(result.destroyed().isEmpty());
    }
}