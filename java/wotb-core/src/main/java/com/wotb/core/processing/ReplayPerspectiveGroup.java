package com.wotb.core.processing;

import java.util.List;

/**
 * 同一视角分组的回放（一个代表 + 若干重复）。
 */
public record ReplayPerspectiveGroup(
        ReplayPerspectiveGroupKey key,
        ReplayProcessingResult representative,
        List<ReplayProcessingResult> duplicates
) {

    public boolean isMultiFile() {
        return duplicates != null && !duplicates.isEmpty();
    }
}
