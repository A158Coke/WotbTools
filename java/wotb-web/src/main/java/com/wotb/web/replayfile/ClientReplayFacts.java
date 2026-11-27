package com.wotb.web.replayfile;

import com.wotb.core.model.Battle;
import com.wotb.core.model.PlayerResult;
import com.wotb.core.replay.facts.ReplayFactsCodec;
import org.springframework.util.StringUtils;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;

import java.util.HashSet;
import java.util.List;
import java.util.Set;

public final class ClientReplayFacts {

    static final int MAX_PLAYERS = 64;
    static final int MAX_JSON_CHARS = 64 * 1024;

    private static final JsonMapper MAPPER = JsonMapper.builder().build();

    private ClientReplayFacts() {
    }

    public static Battle read(final String json) {
        if (!StringUtils.hasText(json) || json.length() > MAX_JSON_CHARS) {
            throw new IllegalArgumentException("INVALID_REPLAY_FACTS");
        }
        final Battle battle;
        try {
            final JsonNode node = MAPPER.readTree(json);
            if (node == null || !node.isObject()) {
                throw new IllegalArgumentException("INVALID_REPLAY_FACTS");
            }
            battle = ReplayFactsCodec.battleFromJson(node);
        } catch (final IllegalArgumentException e) {
            throw e;
        } catch (final Exception e) {
            throw new IllegalArgumentException("INVALID_REPLAY_FACTS");
        }
        validate(battle);
        return battle;
    }

    public static List<Battle> readAll(final List<String> jsons, final int expectedCount) {
        if (jsons == null || jsons.size() != expectedCount) {
            throw new IllegalArgumentException("REPLAY_FACTS_COUNT_MISMATCH");
        }
        return jsons.stream().map(ClientReplayFacts::read).toList();
    }

    private static void validate(final Battle battle) {
        if (battle == null || !StringUtils.hasText(battle.arenaId) || !StringUtils.hasText(battle.recorder)
                || battle.players == null || battle.players.isEmpty() || battle.players.size() > MAX_PLAYERS) {
            throw new IllegalArgumentException("INVALID_REPLAY_FACTS");
        }
        final Set<Long> accounts = new HashSet<>();
        for (final PlayerResult p : battle.players) {
            if (p == null || p.accountId <= 0 || p.tankId <= 0 || (p.team != 1 && p.team != 2)
                    || p.damageDealt < 0 || !accounts.add(p.accountId)) {
                throw new IllegalArgumentException("INVALID_REPLAY_FACTS");
            }
            p.raw = null;
        }
        if (battle.recorderResult() == null) {
            throw new IllegalArgumentException("INVALID_REPLAY_FACTS");
        }
    }
}
