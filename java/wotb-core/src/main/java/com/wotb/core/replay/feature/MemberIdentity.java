package com.wotb.core.replay.feature;

import com.wotb.core.processing.TeamEntityIdentity;
import org.springframework.util.StringUtils;

/**
 * Stable member identity for engagement matching across the extraction chain.
 * Uses accountId > 0 as primary key; falls back to normalized nickname.
 */
public record MemberIdentity(long accountId, String nickname) {

    /**
     * Check whether this identity matches a TeamEntityIdentity.
     * accountId > 0: exact match.
     * accountId <= 0: match by normalized nickname (trimmed, case-insensitive).
     */
    public boolean matches(final TeamEntityIdentity identity) {
        if (accountId > 0) return identity.accountId() == accountId;
        if (!StringUtils.hasText(nickname)) return false;
        final String theirNick = identity.nickname();
        if (!StringUtils.hasText(theirNick)) return false;
        return nickname.trim().equalsIgnoreCase(theirNick.trim());
    }

    /**
     * Check whether this identity matches a raw accountId + nickname.
     */
    public boolean matches(final long otherAccountId, final String otherNickname) {
        if (accountId > 0) return accountId == otherAccountId;
        if (!StringUtils.hasText(nickname) || !StringUtils.hasText(otherNickname)) {
            return false;
        }
        return nickname.trim().equalsIgnoreCase(otherNickname.trim());
    }
}
