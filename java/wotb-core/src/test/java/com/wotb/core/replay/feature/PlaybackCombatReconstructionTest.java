package com.wotb.core.replay.feature;

import com.wotb.core.replay.event.DecodeConfidence;

import java.util.List;

import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;


class PlaybackCombatReconstructionTest extends PlaybackCombatReconstructionFixture {
    @Test
    void singleAttackerWindowAttributedLoss() {
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
        assertEquals(10.2, loss.fromSec(), 1e-3);
        assertEquals(12.0, loss.toSec(), 1e-3);
        assertTrue(result.destroyed().isEmpty());
    }

    @Test
    void mixedAttackersUnattributedButLossRecorded() {
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
        final var result = derive(List.of(
                hp(1, START + 10.2f, 1, 2812, true, DecodeConfidence.EXACT),
                hp(2, START + 12.0f, 1, 3189, true, DecodeConfidence.EXACT)));
        assertTrue(result.lossesOf(1001L).isEmpty());
    }

    @Test
    void sentinelAndPartialIgnored() {
        final var result = derive(List.of(
                hp(1, START + 10.2f, 1, 3189, true, DecodeConfidence.PARTIAL),
                hp(2, START + 11.0f, 1, 0xFFFD, false, DecodeConfidence.EXACT),
                hp(3, START + 12.0f, 1, 2812, true, DecodeConfidence.EXACT)));
        assertTrue(result.lossesOf(1001L).isEmpty());
        assertTrue(result.destroyed().isEmpty());
    }

    @Test
    void damageAtWindowEdgeAttributionExclusiveLeft() {
        final var result = derive(List.of(
                hp(1, START + 10.2f, 1, 3189, true, DecodeConfidence.EXACT),
                hp(2, START + 12.0f, 1, 2812, true, DecodeConfidence.EXACT),
                dmg(3, START + 10.2f, 2, 1, 999),
                dmg(4, START + 12.0f, 3, 1, 500)));
        final PlaybackCombatReconstruction.Loss loss = result.lossesOf(1001L).get(0);
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

    @Test
    void unsupportedVariantInLossWindowBlocksAttribution() {
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
        final var result = derive(List.of(
                hp(1, START + 10.2f, 1, 3189, true, DecodeConfidence.EXACT),
                hp(2, START + 12.0f, 1, 2812, true, DecodeConfidence.EXACT),
                dmg(3, START + 11.5f, 2, 1, 767)));
        assertEquals(377, PlaybackCombatReconstruction.observedHpLossAt(result, 1001L, 11.5));
        assertNull(PlaybackCombatReconstruction.observedHpLossAt(result, 1001L, 9.0),
                "窗口外事件不得暴露掉血");
    }

    @Test
    void shortVariantInLossWindowBlocksAttribution() {
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

    @Test
    void directDamageWithUnresolvedVictimInLossWindowBlocksAttribution() {
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
