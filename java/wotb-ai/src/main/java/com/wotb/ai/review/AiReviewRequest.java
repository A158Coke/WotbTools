package com.wotb.ai.review;

import com.wotb.core.model.Battle;
import com.wotb.core.replay.reconstruction.ReplayReconstruction;
import java.util.List;

/** Internal canonical request after HTTP decoding. */
public record AiReviewRequest(AllowedLanguage language, String correlationId, Battle battle,
                              ReplayReconstruction reconstruction, List<String> limitations) {
    public AiReviewRequest {
        limitations = limitations == null ? List.of() : List.copyOf(limitations);
    }
}
