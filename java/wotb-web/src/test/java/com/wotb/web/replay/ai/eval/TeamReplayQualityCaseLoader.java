package com.wotb.web.replay.ai.eval;

import java.io.BufferedReader;
import java.io.IOException;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.List;

/**
 * Loads the deliberately small gold.yaml subset used by the offline harness.
 * The schema is YAML on disk, with no second replay/evidence format: scalar
 * fields and string lists carry report constraints and required evidence types.
 */
public final class TeamReplayQualityCaseLoader {

    private static final List<String> CASE_IDS = List.of(
            "A-flank-local-propagation",
            "B-enabling-crossfire",
            "C-stalled-half-commit",
            "D-residual-vision-risk",
            "E-information-objective-decision",
            "F-objective-initiative-obligation");

    private TeamReplayQualityCaseLoader() {
    }

    public static List<TeamReplayQualityCase> loadAll() {
        return CASE_IDS.stream().map(TeamReplayQualityCaseLoader::load).toList();
    }

    public static TeamReplayQualityCase load(final String id) {
        final String resource = "/ai-eval/replays/" + id + "/gold.yaml";
        final InputStream stream = TeamReplayQualityCaseLoader.class.getResourceAsStream(resource);
        if (stream == null) {
            throw new IllegalStateException("Missing real replay gold: " + resource);
        }
        try (BufferedReader reader = new BufferedReader(new InputStreamReader(stream, StandardCharsets.UTF_8))) {
            String replay = null;
            final List<String> notice = new ArrayList<>();
            final List<String> mustNot = new ArrayList<>();
            final List<String> evidenceRequired = new ArrayList<>();
            List<String> activeList = null;
            String line;
            while ((line = reader.readLine()) != null) {
                final String trimmed = line.trim();
                if (trimmed.isBlank() || trimmed.startsWith("#")) {
                    continue;
                }
                if (trimmed.startsWith("replay:")) {
                    replay = scalar(trimmed.substring("replay:".length()));
                    activeList = null;
                } else if (trimmed.equals("must_notice:")) {
                    activeList = notice;
                } else if (trimmed.equals("must_not:")) {
                    activeList = mustNot;
                } else if (trimmed.equals("evidence_required:")) {
                    activeList = evidenceRequired;
                } else if (trimmed.startsWith("- ") && activeList != null) {
                    activeList.add(scalar(trimmed.substring(2)));
                }
            }
            if (replay == null || replay.isBlank()) {
                throw new IllegalStateException("Gold has no replay path: " + resource);
            }
            return new TeamReplayQualityCase(id, replay, notice, mustNot, evidenceRequired);
        } catch (final IOException e) {
            throw new IllegalStateException("Failed to read real replay gold: " + resource, e);
        }
    }

    private static String scalar(final String value) {
        final String trimmed = value.trim();
        if (trimmed.length() >= 2 && trimmed.startsWith("\"") && trimmed.endsWith("\"")) {
            return trimmed.substring(1, trimmed.length() - 1);
        }
        return trimmed;
    }
}
