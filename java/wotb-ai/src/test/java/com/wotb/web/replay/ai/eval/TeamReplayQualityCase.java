package com.wotb.web.replay.ai.eval;

import java.util.List;

/** Gold contains structural evidence constraints only; it never contains a model answer. */
public record TeamReplayQualityCase(
        String id,
        String replay,
        List<String> mustNotice,
        List<String> mustNot,
        List<String> evidenceRequired
) {
    public TeamReplayQualityCase {
        mustNotice = mustNotice == null ? List.of() : List.copyOf(mustNotice);
        mustNot = mustNot == null ? List.of() : List.copyOf(mustNot);
        evidenceRequired = evidenceRequired == null ? List.of() : List.copyOf(evidenceRequired);
    }
}
