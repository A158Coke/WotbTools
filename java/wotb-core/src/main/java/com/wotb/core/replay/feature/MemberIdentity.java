package com.wotb.core.replay.feature;

import com.wotb.core.model.PlayerResult;
import com.wotb.core.processing.TeamEntityIdentity;
import org.springframework.util.StringUtils;

import java.util.List;
import java.util.Locale;

/**
 * Stable member identity for engagement matching.
 * accountId > 0: exact accountId match.
 * accountId <= 0: normalized nickname match ONLY if unique in perspective roster.
 * blank/null nickname with accountId <= 0 is always ambiguous.
 * Use {@link #resolve(PlayerResult, List)} for construction with uniqueness check.
 */
public record MemberIdentity(long accountId, String nickname, boolean ambiguousNickname) {

    public MemberIdentity {
        if (nickname == null) nickname = "";
        if (accountId <= 0 && !StringUtils.hasText(nickname)) {
            ambiguousNickname = true;
        }
    }

    public static MemberIdentity resolve(final PlayerResult player, final List<PlayerResult> roster) {
        final long accountId = player.accountId;
        final String rawNickname = player.nickname != null ? player.nickname.trim() : "";
        if (accountId > 0) {
            return new MemberIdentity(accountId, rawNickname, false);
        }
        if (!StringUtils.hasText(rawNickname)) {
            return new MemberIdentity(0L, "", true);
        }
        final boolean ambiguous = !isNicknameUniqueInRoster(rawNickname, roster);
        return new MemberIdentity(0L, rawNickname, ambiguous);
    }

    public boolean matches(final TeamEntityIdentity identity) {
        if (accountId > 0 && identity.accountId() == accountId) return true;
        if (accountId > 0) return false;
        if (ambiguousNickname) return false;
        if (!StringUtils.hasText(nickname)) return false;
        final String theirNick = identity.nickname();
        if (!StringUtils.hasText(theirNick)) return false;
        return nickname.equalsIgnoreCase(theirNick.trim());
    }

    public boolean matches(final long otherAccountId, final String otherNickname) {
        if (accountId > 0) return accountId == otherAccountId;
        if (ambiguousNickname) return false;
        if (!StringUtils.hasText(nickname) || !StringUtils.hasText(otherNickname)) return false;
        return nickname.equalsIgnoreCase(otherNickname.trim());
    }

    public static boolean isNicknameUniqueInRoster(final String nickname, final List<PlayerResult> roster) {
        if (!StringUtils.hasText(nickname)) return false;
        final String normalized = nickname.trim().toLowerCase(Locale.ROOT);
        return roster.stream()
                .filter(p -> p.nickname != null)
                .map(p -> p.nickname.trim().toLowerCase(Locale.ROOT))
                .filter(n -> n.equals(normalized))
                .count() == 1;
    }
}
