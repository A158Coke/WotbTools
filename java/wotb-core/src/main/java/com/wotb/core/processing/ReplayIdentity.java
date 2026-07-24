package com.wotb.core.processing;

import java.time.Instant;

/**
 * 回放唯一身份标识，用于去重。
 * 优先使用内容 SHA-256，组合 arenaUniqueId/战斗时间等。
 */
public record ReplayIdentity(
        String contentHash,
        String arenaUniqueId,
        String clientVersion,
        String mapCode,
        Long recorderAccountId,
        Instant battleTime
) {

    /** 仅基于内容 hash 的快速比较。 */
    public boolean sameContent(ReplayIdentity other) {
        return contentHash != null && contentHash.equals(other.contentHash);
    }
}
