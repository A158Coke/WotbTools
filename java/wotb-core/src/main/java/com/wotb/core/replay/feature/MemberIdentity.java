package com.wotb.core.replay.feature;

import com.wotb.core.model.PlayerResult;
import com.wotb.core.processing.TeamEntityIdentity;
import org.springframework.util.StringUtils;

import java.util.List;
import java.util.Locale;

/**
 * Stable member identity for engagement matching across the extraction chain.
 * Uses accountId > 0 as primary key; falls back to normalized nickname ONLY if
 * the nickname is unique within the perspective roster.
 * <p>
 * Use {@link #resolve(PlayerResult, List)} to construct with roster-uniqueness check.
 */
public record MemberIdentity(long accountId, String nickname, boolean ambiguousNickname) {

    /**
     * Resolve a MemberIdentity from a PlayerResult, checking nickname uniqueness against the roster.
     */
    public static MemberIdentity resolve(final PlayerResult player, final List<PlayerResult> roster) {
        final long memberAccountId = player.accountId;
        final String memberNickname = player.nickname;
        if (memberAccountId > 0) {
            return new MemberIdentity(memberAccountId, memberNickname, false);
        }
        final boolean ambiguous = !isNicknameUniqueInRoster(memberNickname, roster);
        return new MemberIdentity(0L, memberNickname, ambiguous);
    }

    public MemberIdentity {
        // validation only; trimming done at construction sites
    }

    public static MemberIdentity fromAccount(final long accountId) {
        return new MemberIdentity(accountId, "", false);
    }

    /**
     * Check whether this identity matches a TeamEntityIdentity.
     */
    public boolean matches(final TeamEntityIdentity identity) {
        if (accountId > 0 && identity.accountId() == accountId) return true;
        if (accountId > 0) return false;
        if (ambiguousNickname) return false;
        if (!StringUtils.hasText(nickname)) return false;
        final String theirNick = identity.nickname();
        if (!StringUtils.hasText(theirNick)) return false;
        return nickname.equalsIgnoreCase(theirNick.trim());
    }

    /**
     * Check whether this identity matches a raw accountId + nickname.
     */
    public boolean matches(final long otherAccountId, final String otherNickname) {
        if (accountId > 0) return accountId == otherAccountId;
        if (ambiguousNickname) return false;
        if (!StringUtils.hasText(nickname) || !StringUtils.hasText(otherNickname)) {
            return false;
        }
        return nickname.equalsIgnoreCase(otherNickname.trim());
    }

    /**
     * Check whether the given nickname is unique (by normalized form) within the roster.
     */
    public static boolean isNicknameUniqueInRoster(
            final String nickname,
            final List<PlayerResult> roster
    ) {
        if (!StringUtils.hasText(nickname)) return false;
        final String normalized = nickname.trim().toLowerCase(Locale.ROOT);
        return roster.stream()
                .filter(p -> p.nickname != null)
                .map(p -> p.nickname.trim().toLowerCase(Locale.ROOT))
                .filter(n -> n.equals(normalized))
                .count() == 1;
    }
}
