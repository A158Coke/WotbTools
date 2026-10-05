package com.wotb.ai.tournament;

import org.springframework.http.HttpStatus;
import org.springframework.util.StringUtils;
import org.springframework.web.server.ResponseStatusException;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;

import java.util.ArrayList;
import java.util.HashSet;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Set;

/** Validates extracted observations; points and persistent team identities belong to Business API. */
public class TournamentGroupRecognitionParser {
    private static final JsonMapper JSON = JsonMapper.builder().build();
    private static final Set<String> ISSUE_CODES = Set.of("MULTIPLE_GROUPS", "INCOMPLETE_GROUP",
            "UNCLEAR_CLAN", "UNCLEAR_RANK", "GROUP_NUMBER_MISSING");

    public record Team(String clanTag, Integer rank, String rankText) { }

    public record Recognition(Integer groupNumber, List<Team> teams, boolean complete,
                              List<String> issues, String imageHash) { }

    public Recognition parse(final String completion, final String imageHash) {
        try {
            if (!StringUtils.hasText(completion) || completion.length() > 32_768) {
                throw invalidResponse();
            }
            final JsonNode root = JSON.readTree(completion);
            if (root == null || !root.isObject() || !root.path("teams").isArray()
                    || !root.path("complete").isBoolean() || !root.path("issues").isArray()) {
                throw invalidResponse();
            }
            final Set<String> issues = new LinkedHashSet<>();
            for (final JsonNode issue : root.path("issues")) {
                if (!issue.isString() || !ISSUE_CODES.contains(issue.asString())) throw invalidResponse();
                issues.add(issue.asString());
            }
            final Integer groupNumber = positiveInteger(root.path("groupNumber"), 10_000);
            if (groupNumber == null) issues.add("GROUP_NUMBER_MISSING");
            final JsonNode extracted = root.path("teams");
            if (extracted.size() > 5) issues.add("MULTIPLE_GROUPS");
            if (extracted.size() < 3 || extracted.size() > 5
                    || (!root.path("complete").asBoolean() && issues.isEmpty())) {
                issues.add("INCOMPLETE_GROUP");
            }
            if (extracted.size() > 10) throw invalidResponse();
            final boolean noExplicitRanks = extracted.size() > 0 && extracted.valueStream()
                    .allMatch(team -> team.path("rankText").isString()
                            && !StringUtils.hasText(team.path("rankText").asString()));
            final Set<String> clans = new HashSet<>();
            final Set<Integer> ranks = new HashSet<>();
            final List<Team> teams = new ArrayList<>();
            int row = 0;
            for (final JsonNode team : extracted) {
                row++;
                if (!team.isObject() || !team.path("clanTag").isString()
                        || !team.path("rankText").isString()) throw invalidResponse();
                String clanTag = team.path("clanTag").asString().trim();
                if (clanTag.startsWith("[") && clanTag.endsWith("]")) {
                    clanTag = clanTag.substring(1, clanTag.length() - 1);
                }
                if (!StringUtils.hasText(clanTag) || clanTag.codePointCount(0, clanTag.length()) > 32
                        || clanTag.codePoints().anyMatch(cp -> Character.isWhitespace(cp)
                                || Character.isISOControl(cp) || cp == '[' || cp == ']')) {
                    clanTag = "";
                    issues.add("UNCLEAR_CLAN");
                } else if (!clans.add(clanTag)) {
                    issues.add("UNCLEAR_CLAN");
                }
                final String rankText = team.path("rankText").asString().trim();
                if (rankText.length() > 32) throw invalidResponse();
                // These are the only agreed deterministic interpretations of the screenshot.
                final Integer rank;
                if (rankText.matches("3\\s*[-–—]\\s*4")) {
                    rank = 4;
                } else if (noExplicitRanks && extracted.size() <= 5) {
                    rank = row;
                } else if (rankText.matches("[1-5]")) {
                    rank = Integer.valueOf(rankText);
                } else {
                    rank = null;
                }
                if (rank == null || rank > extracted.size() || !ranks.add(rank)) issues.add("UNCLEAR_RANK");
                teams.add(new Team(clanTag, rank, rankText));
            }
            return new Recognition(groupNumber, List.copyOf(teams), issues.isEmpty(),
                    List.copyOf(issues), imageHash);
        } catch (final tools.jackson.core.JacksonException error) {
            throw invalidResponse();
        }
    }

    private static Integer positiveInteger(final JsonNode value, final int maximum) {
        if (!value.isIntegralNumber() || !value.canConvertToInt()) return null;
        final int number = value.asInt();
        return number > 0 && number <= maximum ? number : null;
    }

    private static ResponseStatusException invalidResponse() {
        return new ResponseStatusException(HttpStatus.BAD_GATEWAY, "AI_RESPONSE_INVALID");
    }
}
