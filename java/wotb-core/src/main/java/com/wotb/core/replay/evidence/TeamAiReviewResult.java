package com.wotb.core.replay.evidence;

import java.util.List;

public record TeamAiReviewResult(
        Summary summary,
        List<Episode> episodes,
        List<TrainingSuggestion> trainingSuggestions,
        List<ReviewFocus> reviewFocus,
        List<HighContributor> highContributors
) {
    public record Summary(String verdict, String primaryDiagnosis) {
    }

    public record Episode(
            String id,
            Integer startSec,
            Integer endSec,
            String title,
            String analysis,
            List<String> playerKeys
    ) {
    }

    public record TrainingSuggestion(String title, String content, String episodeId) {
    }

    public record ReviewFocus(String playerKey, String episodeId, String reason) {
    }

    public record HighContributor(String playerKey, String episodeId, String reason) {
    }
}
