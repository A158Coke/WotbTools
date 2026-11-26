package com.wotb.core.replay.feature;

import com.wotb.core.replay.event.DecodeConfidence;

import java.util.List;

import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNull;


class PlaybackCombatKillerAttributionTest extends PlaybackCombatReconstructionFixture {
    @Test
    void destroyedWithKillerFromLethalDamage() {
        final var result = derive(List.of(
                hp(1, START + 30.0f, 1, 242, true, DecodeConfidence.EXACT),
                hp(2, START + 31.0f, 1, 0, false, DecodeConfidence.EXACT),
                dmg(3, START + 30.8f, 2, 1, 767)));
        assertEquals(1, result.destroyed().size());
        final PlaybackCombatReconstruction.Destroyed d = result.destroyed().get(0);
        assertEquals(1001L, d.victimAccountId());
        assertEquals(2002L, d.killerAccountId());
        assertEquals(31.0, d.timeSec(), 1e-6);
        final PlaybackCombatReconstruction.Loss loss = result.lossesOf(1001L).get(0);
        assertEquals(242, loss.hpLoss());
    }

    @Test
    void destroyedWithoutKillerWhenNoRecentDamage() {
        final var result = derive(List.of(
                hp(1, START + 30.0f, 1, 242, true, DecodeConfidence.EXACT),
                hp(2, START + 31.0f, 1, 0, false, DecodeConfidence.EXACT)));
        assertEquals(1, result.destroyed().size());
        assertNull(result.destroyed().get(0).killerAccountId());
    }

    @Test
    void killedWithTwoDifferentAttackersInWindowHasNoKiller() {
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
        final var result = derive(List.of(
                hp(1, START + 30.0f, 1, 242, true, DecodeConfidence.EXACT),
                hp(2, START + 31.0f, 1, 0, false, DecodeConfidence.EXACT)));
        assertEquals(1, result.destroyed().size());
        assertNull(result.destroyed().get(0).killerAccountId());
        assertEquals(31.0, result.destroyed().get(0).timeSec(), 1e-6);
    }

    @Test
    void duplicateHpZeroEventsProduceSingleDestroyed() {
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
        final var result = derive(List.of(
                hp(1, START + 31.2f, 1, 0, false, DecodeConfidence.EXACT),
                hp(2, START + 30.0f, 1, 242, true, DecodeConfidence.EXACT),
                hp(3, START + 31.0f, 1, 0, false, DecodeConfidence.EXACT)));
        assertEquals(1, result.destroyed().size());
        assertEquals(31.0, result.destroyed().get(0).timeSec(), 1e-6);
    }

    @Test
    void killerNeverLeaksFromFutureDamage() {
        final var result = derive(List.of(
                hp(1, START + 30.0f, 1, 242, true, DecodeConfidence.EXACT),
                hp(2, START + 31.0f, 1, 0, false, DecodeConfidence.EXACT),
                dmg(3, START + 30.8f, 2, 1, 500),
                dmg(4, START + 32.0f, 3, 1, 500)));
        assertEquals(1, result.destroyed().size());
        assertEquals(2002L, result.destroyed().get(0).killerAccountId(),
                "窗口外未来 DAMAGE 不得泄漏为 killer");
    }

    @Test
    void killedWithUnsupportedVariantAndDirectDamageInWindowHasNoKiller() {
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
    void killedWithUnresolvedVictimUnsupportedInWindowHasNoKiller() {
        final var result = derive(List.of(
                hp(1, START + 30.0f, 1, 242, true, DecodeConfidence.EXACT),
                hp(2, START + 31.0f, 1, 0, false, DecodeConfidence.EXACT),
                dmg(3, START + 30.8f, 2, 1, 500),
                unsup(4, START + 30.9f, 3, 0)));
        assertEquals(1, result.destroyed().size());
        assertNull(result.destroyed().get(0).killerAccountId(),
                "victim 无法解析的 unsupported 证据 → killer 必须 fail-closed 为 null");
    }

    @Test
    void shortVariantInLethalWindowBlocksKiller() {
        final var result = derive(List.of(
                hp(1, START + 30.0f, 1, 242, true, DecodeConfidence.EXACT),
                hp(2, START + 31.0f, 1, 0, false, DecodeConfidence.EXACT),
                dmg(3, START + 30.8f, 2, 1, 500),
                unsupV(4, START + 30.9f, 0, 1, "SHORT_DAMAGE_VARIANT")));
        assertEquals(1, result.destroyed().size());
        assertNull(result.destroyed().get(0).killerAccountId(),
                "窗口内 short 变体（无法排除是真实致死源）→ killer 必须 null");
    }

    @Test
    void zeroRawDamageInLethalWindowBlocksKiller() {
        final var result = derive(List.of(
                hp(1, START + 30.0f, 1, 242, true, DecodeConfidence.EXACT),
                hp(2, START + 31.0f, 1, 0, false, DecodeConfidence.EXACT),
                dmg(3, START + 30.8f, 2, 1, 500),
                unsupV(4, START + 30.85f, 2, 1, "ZERO_RAW_DAMAGE")));
        assertEquals(1, result.destroyed().size());
        assertNull(result.destroyed().get(0).killerAccountId(),
                "窗口内 zero-raw 冲突证据 → killer 必须 null");
    }

    @Test
    void directDamageMissingVictimInLethalWindowBlocksKiller() {
        final var result = derive(List.of(
                hp(1, START + 30.0f, 1, 242, true, DecodeConfidence.EXACT),
                hp(2, START + 31.0f, 1, 0, false, DecodeConfidence.EXACT),
                dmg(3, START + 30.8f, 2, 1, 500),
                dmg(4, START + 30.85f, 3, 0, 500)));
        assertEquals(1, result.destroyed().size());
        assertNull(result.destroyed().get(0).killerAccountId(),
                "victim 无法解析的 direct DAMAGE → killer 必须 fail-closed 为 null");
    }
}
