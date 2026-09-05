package com.wotb.core.replay.evidence;

import java.util.List;

/**
 * Team AI Review v0.5 的结构化结果。这里只表达 LLM 输出的数据形状，
 * 不在 domain 层判断战术结论是否正确。
 */
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
