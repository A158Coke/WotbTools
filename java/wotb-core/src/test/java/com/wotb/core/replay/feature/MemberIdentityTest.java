package com.wotb.core.replay.feature;

import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.wotb.core.model.PlayerResult;
import com.wotb.core.processing.TeamEntityIdentity;
import com.wotb.core.replay.event.DecodeConfidence;
import org.junit.jupiter.api.Test;

import java.util.List;

class MemberIdentityTest {

    private static TeamEntityIdentity identity(final long accountId, final String nickname) {
        return new TeamEntityIdentity(0, accountId, nickname, 0, "", 0, DecodeConfidence.EXACT);
    }

    @Test
    void accountIdMatch() {
        final MemberIdentity id = new MemberIdentity(1001L, "PlayerA");
        assertTrue(id.matches(identity(1001L, "PlayerA")));
    }

    @Test
    void accountIdMismatch() {
        final MemberIdentity id = new MemberIdentity(1001L, "PlayerA");
        assertFalse(id.matches(identity(2001L, "PlayerB")));
    }

    @Test
    void zeroAccountIdMatchByNickname() {
        final MemberIdentity id = new MemberIdentity(0L, "PlayerA");
        assertTrue(id.matches(identity(0L, "PlayerA")));
    }

    @Test
    void zeroAccountIdCaseInsensitive() {
        final MemberIdentity id = new MemberIdentity(0L, "PlayerA");
        assertTrue(id.matches(identity(0L, "playera")));
    }

    @Test
    void zeroAccountIdTrimmed() {
        final MemberIdentity id = new MemberIdentity(0L, "  PlayerA  ");
        assertTrue(id.matches(identity(0L, "PlayerA")));
    }

    @Test
    void zeroAccountIdDifferentNickname() {
        final MemberIdentity id = new MemberIdentity(0L, "PlayerA");
        assertFalse(id.matches(identity(0L, "PlayerB")));
    }

    @Test
    void zeroAccountIdEmptyNicknameReturnsFalse() {
        final MemberIdentity id = new MemberIdentity(0L, "");
        assertFalse(id.matches(identity(0L, "PlayerA")));
    }

    @Test
    void differentAccountIdNotMerged() {
        final MemberIdentity idA = new MemberIdentity(0L, "PlayerA");
        final MemberIdentity idB = new MemberIdentity(0L, "PlayerB");
        assertFalse(idA.matches(identity(0L, "PlayerB")));
        assertFalse(idB.matches(identity(0L, "PlayerA")));
    }

    @Test
    void matchesRawAccount() {
        assertTrue(new MemberIdentity(1001L, "").matches(1001L, "Any"));
        assertFalse(new MemberIdentity(1001L, "").matches(2001L, "Any"));
    }

    @Test
    void matchesRawNickname() {
        assertTrue(new MemberIdentity(0L, "PlayerA").matches(0L, "PlayerA"));
        assertTrue(new MemberIdentity(0L, "PlayerA").matches(0L, "playera"));
        assertFalse(new MemberIdentity(0L, "PlayerA").matches(0L, "PlayerB"));
    }

    @Test
    void ambiguousNicknameBlocksMatching() {
        final MemberIdentity id = new MemberIdentity(0L, "PlayerA", true);
        assertFalse(id.matches(identity(0L, "PlayerA")));
        assertFalse(id.matches(0L, "PlayerA"));
    }

    @Test
    void uniqueNicknameInRoster() {
        final List<PlayerResult> roster = List.of(
                player(1001L, "Alice"),
                player(1002L, "Bob"));
        assertTrue(MemberIdentity.isNicknameUniqueInRoster("Alice", roster));
        assertTrue(MemberIdentity.isNicknameUniqueInRoster("Bob", roster));
        assertFalse(MemberIdentity.isNicknameUniqueInRoster("Charlie", roster));
    }

    @Test
    void duplicateNicknameInRoster() {
        final List<PlayerResult> roster = List.of(
                player(1001L, "SameName"),
                player(1002L, "samename"));
        assertFalse(MemberIdentity.isNicknameUniqueInRoster("SameName", roster));
    }

    @Test
    void nullOrBlankNicknameNotUnique() {
        final List<PlayerResult> roster = List.of(
                player(1001L, "Alice"),
                player(1002L, ""));
        assertFalse(MemberIdentity.isNicknameUniqueInRoster(null, roster));
        assertFalse(MemberIdentity.isNicknameUniqueInRoster("", roster));
        assertFalse(MemberIdentity.isNicknameUniqueInRoster("  ", roster));
    }

    private static PlayerResult player(final long accountId, final String nickname) {
        final PlayerResult p = new PlayerResult();
        p.accountId = accountId;
        p.nickname = nickname;
        return p;
    }
}
