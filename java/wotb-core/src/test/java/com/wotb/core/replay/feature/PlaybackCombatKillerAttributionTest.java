package com.wotb.core.replay.feature;

import com.wotb.core.replay.event.DecodeConfidence;

import java.util.List;

import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNull;


/** Killer/death attribution and future-leak regression tests. */
class PlaybackCombatKillerAttributionTest extends PlaybackCombatReconstructionFixture {
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
    void killedWithUnresolvedVictimUnsupportedInWindowHasNoKiller() {
        // 致死窗口 (30.0, 31.0] 内存在 victim 无法解析的 unsupported 证据 → 无法排除 → killer null
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
        // 致死窗口 (30.0, 31.0] 内 short 变体（victim 可解析）→ destroyed 保留、killer null
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
        // 致死窗口内 zero-raw 冲突证据 → destroyed 保留、killer null
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
        // 致死窗口内：正常 direct DAMAGE + victim 无法解析的 direct DAMAGE → destroyed 保留、killer null
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
