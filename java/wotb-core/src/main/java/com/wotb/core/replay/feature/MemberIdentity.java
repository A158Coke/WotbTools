package com.wotb.core.replay.feature;

import com.wotb.core.model.PlayerResult;
import com.wotb.core.processing.TeamEntityIdentity;
import org.springframework.util.StringUtils;

import java.util.List;

/**
 * Stable member identity for engagement matching across the extraction chain.
 * Uses accountId > 0 as primary key; falls back to normalized nickname ONLY if
 * the nickname is unique within the perspective roster.
 */
public record MemberIdentity(long accountId, String nickname, boolean ambiguousNickname) {

    public MemberIdentity(final long accountId, final String nickname) {
        this(accountId, nickname, false);
    }

    public MemberIdentity(final long accountId, final String nickname, final boolean ambiguousNickname) {
        this.accountId = accountId;
        this.nickname = nickname != null ? nickname.trim() : "";
        this.ambiguousNickname = ambiguousNickname;
    }

    /**
     * Check whether this identity matches a TeamEntityIdentity.
     * accountId > 0: exact match.
     * accountId <= 0: match by normalized nickname only if nickname is not ambiguous.
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
     * Used at MemberIdentity construction time when accountId <= 0.
     */
    public static boolean isNicknameUniqueInRoster(
            final String nickname,
            final List<PlayerResult> roster
    ) {
        if (!StringUtils.hasText(nickname)) return false;
        final String normalized = nickname.trim().toLowerCase();
        return roster.stream()
                .filter(p -> p.nickname != null)
                .map(p -> p.nickname.trim().toLowerCase())
                .filter(n -> n.equals(normalized))
                .count() == 1;
    }
}
