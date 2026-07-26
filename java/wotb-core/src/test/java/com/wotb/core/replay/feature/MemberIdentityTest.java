package com.wotb.core.replay.feature;

import static org.junit.jupiter.api.Assertions.*;

import com.wotb.core.processing.TeamEntityIdentity;
import com.wotb.core.replay.event.DecodeConfidence;
import org.junit.jupiter.api.Test;

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
}
