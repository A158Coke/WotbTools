package com.wotb.core.replay.feature;

import com.wotb.core.replay.event.DecodeConfidence;

import java.util.List;

import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;


/**
 * PlaybackCombatReconstruction 单测：
 * 权威 HP loss 推导 + 攻击者 attribution 边界 + 击毁/击杀推导。
 */
class PlaybackCombatReconstructionTest extends PlaybackCombatReconstructionFixture {
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

    @Test
    void unsupportedVariantDoesNotAffectLossAttribution() {
        // unsupported 变体不产生精确伤害数字：不计入 damageEventCount、并阻止该窗口 attribution
        // （掉血窗口仍由 Type-7 sample 推导；无 direct DAMAGE 时 inWindow=0、attacker 必为 null）
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

    // ---- PR #107 第 4 轮：unsupported 变体同时阻止 HP-loss attribution（不只在 killer 阶段）----
    @Test
    void unsupportedVariantInLossWindowBlocksAttribution() {
        // 掉血窗口 (10.2, 12.0] 内：direct DAMAGE（entity2）+ 同一受害者的 unsupported 变体
        // → 掉血数值事实保留、attacker=null、attackerReliable=false（不得把该掉血归给 direct）
        final var result = derive(List.of(
                hp(1, START + 10.2f, 1, 3189, true, DecodeConfidence.EXACT),
                hp(2, START + 12.0f, 1, 2812, true, DecodeConfidence.EXACT),
                dmg(3, START + 11.5f, 2, 1, 767),
                unsup(4, START + 11.7f, 3, 1)));
        final PlaybackCombatReconstruction.Loss loss = result.lossesOf(1001L).get(0);
        assertEquals(377, loss.hpLoss(), "unsupported 冲突不影响掉血数值事实");
        assertEquals(1, loss.damageEventCount(), "direct DAMAGE 仍计入 damageEventCount");
        assertNull(loss.attackerAccountId(), "窗口内 unsupported 变体 → 不得归属给 direct 攻击者");
        assertFalse(loss.attackerReliable());
    }

    @Test
    void unsupportedVariantWithUnresolvedVictimBlocksAttribution() {
        // unsupported 证据 victim 无法解析（entity 0 → 无映射）→ 任何窗口内存在它即 fail-closed：
        // 掉血保留、attacker=null（不得静默当成「没有冲突」）
        final var result = derive(List.of(
                hp(1, START + 10.2f, 1, 3189, true, DecodeConfidence.EXACT),
                hp(2, START + 12.0f, 1, 2812, true, DecodeConfidence.EXACT),
                dmg(3, START + 11.5f, 2, 1, 767),
                unsup(4, START + 11.7f, 3, 0)));
        final PlaybackCombatReconstruction.Loss loss = result.lossesOf(1001L).get(0);
        assertEquals(377, loss.hpLoss());
        assertNull(loss.attackerAccountId(), "victim 无法解析的 unsupported 证据 → 归属 fail-closed");
        assertFalse(loss.attackerReliable());
    }

    @Test
    void unsupportedOutsideLossWindowDoesNotBlockAttribution() {
        // unsupported 变体在掉血窗口之前（9.0）→ 不构成冲突；窗口内唯一 direct attacker 仍可归属
        final var result = derive(List.of(
                hp(1, START + 10.2f, 1, 3189, true, DecodeConfidence.EXACT),
                hp(2, START + 12.0f, 1, 2812, true, DecodeConfidence.EXACT),
                dmg(3, START + 11.5f, 2, 1, 767),
                unsup(4, START + 9.0f, 3, 1)));
        final PlaybackCombatReconstruction.Loss loss = result.lossesOf(1001L).get(0);
        assertEquals(2002L, loss.attackerAccountId(), "窗口外 unsupported 不得误伤窗口内唯一可信攻击者");
        assertTrue(loss.attackerReliable());
    }

    @Test
    void observedHpLossAtIsNullInDirectPlusUnsupportedWindow() {
        // 窗口内恰好一条 direct DAMAGE 但存在 unsupported 变体 → damageEventCount==1 但
        // attackerReliable=false → observedHpLossAt 必须 null（不得把掉血挂到该 direct 通知）
        final var result = derive(List.of(
                hp(1, START + 10.2f, 1, 3189, true, DecodeConfidence.EXACT),
                hp(2, START + 12.0f, 1, 2812, true, DecodeConfidence.EXACT),
                dmg(3, START + 11.5f, 2, 1, 767),
                unsup(4, START + 11.7f, 3, 1)));
        assertNull(PlaybackCombatReconstruction.observedHpLossAt(result, 1001L, 11.5),
                "direct+unsupported 冲突窗口：不得把掉血归给单条 direct DAMAGE");
    }

    @Test
    void observedHpLossAtReturnsValueForSingleReliableNotification() {
        // 对照：窗口内唯一 direct DAMAGE、无 unsupported、attacker 可解析 → 精确归属可暴露
        final var result = derive(List.of(
                hp(1, START + 10.2f, 1, 3189, true, DecodeConfidence.EXACT),
                hp(2, START + 12.0f, 1, 2812, true, DecodeConfidence.EXACT),
                dmg(3, START + 11.5f, 2, 1, 767)));
        // Loss 窗口是 battle-relative 时间（START 已由 derive 减掉）；dmg@11.5 在 (10.2, 12.0] 内
        assertEquals(377, PlaybackCombatReconstruction.observedHpLossAt(result, 1001L, 11.5));
        assertNull(PlaybackCombatReconstruction.observedHpLossAt(result, 1001L, 9.0),
                "窗口外事件不得暴露掉血");
    }

    // ---- PR #107 第 5 轮：短体 / zero-raw damage-method 变体参与 attribution fail-closed ----
    @Test
    void shortVariantInLossWindowBlocksAttribution() {
        // 短体变体（SHORT_DAMAGE_VARIANT：解码层 victim=outer entityId、attacker 未知）+
        // direct DAMAGE 落入同一掉血窗口 → 掉血事实保留、attacker=null、attackerReliable=false、
        // observedHpLoss=null（不得把掉血挂到单条 direct DAMAGE）
        final var result = derive(List.of(
                hp(1, START + 10.2f, 1, 3189, true, DecodeConfidence.EXACT),
                hp(2, START + 12.0f, 1, 2812, true, DecodeConfidence.EXACT),
                dmg(3, START + 11.5f, 2, 1, 767),
                unsupV(4, START + 11.7f, 0, 1, "SHORT_DAMAGE_VARIANT")));
        final PlaybackCombatReconstruction.Loss loss = result.lossesOf(1001L).get(0);
        assertEquals(377, loss.hpLoss(), "unsupported 冲突不影响掉血数值事实");
        assertNull(loss.attackerAccountId(), "窗口内短体变体 → 不得归属给 direct 攻击者");
        assertFalse(loss.attackerReliable());
        assertNull(PlaybackCombatReconstruction.observedHpLossAt(result, 1001L, 11.5),
                "short+direct 冲突窗口：不得把掉血挂到单条 direct DAMAGE");
    }

    @Test
    void zeroRawDamageInLossWindowBlocksAttribution() {
        // direct raw=0（ZERO_RAW_DAMAGE 冲突证据）+ direct DAMAGE 同一掉血窗口 →
        // 掉血保留、attacker=null、observedHpLoss=null（raw=0 不得当「无伤害」）
        final var result = derive(List.of(
                hp(1, START + 10.2f, 1, 3189, true, DecodeConfidence.EXACT),
                hp(2, START + 12.0f, 1, 2812, true, DecodeConfidence.EXACT),
                dmg(3, START + 11.5f, 2, 1, 767),
                unsupV(4, START + 11.6f, 3, 1, "ZERO_RAW_DAMAGE")));
        final PlaybackCombatReconstruction.Loss loss = result.lossesOf(1001L).get(0);
        assertEquals(377, loss.hpLoss());
        assertNull(loss.attackerAccountId(), "窗口内 zero-raw 冲突证据 → 归属 fail-closed");
        assertFalse(loss.attackerReliable());
        assertNull(PlaybackCombatReconstruction.observedHpLossAt(result, 1001L, 11.5),
                "zero-raw+direct 冲突窗口：不得把掉血挂到单条 direct DAMAGE");
    }

    @Test
    void unsupportedAtWindowBoundaryLeftOpenDoesNotBlockRightClosedBlocks() {
        // 窗口 (10.2, 12.0] 左开右闭：unsupported 恰在 fromSec（10.2，左开排除）→ 不冲突、
        // 唯一 direct attacker 仍可归属；恰在 toSec（12.0，右闭包含）→ 冲突 → 归属 fail-closed
        final var atLeft = derive(List.of(
                hp(1, START + 10.2f, 1, 3189, true, DecodeConfidence.EXACT),
                hp(2, START + 12.0f, 1, 2812, true, DecodeConfidence.EXACT),
                dmg(3, START + 11.5f, 2, 1, 767),
                unsupV(4, START + 10.2f, 0, 1, "SHORT_DAMAGE_VARIANT")));
        final PlaybackCombatReconstruction.Loss left = atLeft.lossesOf(1001L).get(0);
        assertEquals(2002L, left.attackerAccountId(), "左开边界上的 unsupported 不属于本窗口 → 不冲突");
        assertTrue(left.attackerReliable());
        final var atRight = derive(List.of(
                hp(1, START + 10.2f, 1, 3189, true, DecodeConfidence.EXACT),
                hp(2, START + 12.0f, 1, 2812, true, DecodeConfidence.EXACT),
                dmg(3, START + 11.5f, 2, 1, 767),
                unsupV(4, START + 12.0f, 0, 1, "ZERO_RAW_DAMAGE")));
        final PlaybackCombatReconstruction.Loss right = atRight.lossesOf(1001L).get(0);
        assertNull(right.attackerAccountId(), "右闭边界上的 unsupported 属于本窗口 → 冲突 fail-closed");
        assertFalse(right.attackerReliable());
    }

    // ---- PR #107 第 6 轮：victim 无法解析的 direct DAMAGE 进入 unresolved conflict（不得静默 continue） ----
    @Test
    void directDamageWithUnresolvedVictimInLossWindowBlocksAttribution() {
        // direct DAMAGE victimEid=0（无法映射）落入掉血窗口 + 另一条正常 direct DAMAGE →
        // 掉血事实保留、attacker=null、attackerReliable=false、observedHpLoss=null
        final var result = derive(List.of(
                hp(1, START + 10.2f, 1, 3189, true, DecodeConfidence.EXACT),
                hp(2, START + 12.0f, 1, 2812, true, DecodeConfidence.EXACT),
                dmg(3, START + 11.5f, 2, 1, 767),
                dmg(4, START + 11.7f, 3, 0, 500)));
        final PlaybackCombatReconstruction.Loss loss = result.lossesOf(1001L).get(0);
        assertEquals(377, loss.hpLoss(), "unresolved-victim DAMAGE 不影响掉血数值事实");
        assertNull(loss.attackerAccountId(), "victim 无法解析的 direct DAMAGE → 不得归属给另一条 direct");
        assertFalse(loss.attackerReliable());
        assertNull(PlaybackCombatReconstruction.observedHpLossAt(result, 1001L, 11.5),
                "冲突窗口：不得把掉血挂到单条 direct DAMAGE");
    }

    @Test
    void directDamageWithUnmappedVictimInLossWindowBlocksAttribution() {
        // direct DAMAGE victimEid=999（实体存在但无映射，最终无法解析）→ 同样进 unresolved conflict
        final var result = derive(List.of(
                hp(1, START + 10.2f, 1, 3189, true, DecodeConfidence.EXACT),
                hp(2, START + 12.0f, 1, 2812, true, DecodeConfidence.EXACT),
                dmg(3, START + 11.5f, 2, 1, 767),
                dmg(4, START + 11.7f, 3, 999, 500)));
        final PlaybackCombatReconstruction.Loss loss = result.lossesOf(1001L).get(0);
        assertEquals(377, loss.hpLoss());
        assertNull(loss.attackerAccountId(), "victim 最终无法映射的 direct DAMAGE → 归属 fail-closed");
        assertFalse(loss.attackerReliable());
    }
}
