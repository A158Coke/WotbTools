package com.wotb.web.leaderboard.service;

/**
 * recordRecorder 入库结果状态机（终审精确化）：
 * <ul>
 *   <li>SAVED — 新建记录 + replay metadata 入库；</li>
 *   <li>ATTACHED — 记录已存在且 replay_hash 为 NULL，补写 replay metadata；</li>
 *   <li>IDEMPOTENT — 记录已存在且 replay_hash 与本次相同（或并发插入竞态），不修改；</li>
 *   <li>SKIPPED_* — 不入库，reasonCode 区分业务原因；异 hash 冲突绝不影响已有记录。</li>
 * </ul>
 */
public enum RecordOutcome {

    SAVED(null),
    ATTACHED(null),
    IDEMPOTENT(null),
    SKIPPED_NON_RANDOM("NON_RANDOM_BATTLE"),
    SKIPPED_UNKNOWN_RECORDER("DUPLICATE_OR_UNKNOWN_RECORDER"),
    SKIPPED_HASH_CONFLICT("REPLAY_HASH_CONFLICT");

    private final String reasonCode;

    RecordOutcome(final String reasonCode) {
        this.reasonCode = reasonCode;
    }

    public boolean isSkipped() {
        return reasonCode != null;
    }

    /** SKIPPED 时的稳定英文 reasonCode；非 SKIPPED 为 null。 */
    public String getReasonCode() {
        return reasonCode;
    }
}
