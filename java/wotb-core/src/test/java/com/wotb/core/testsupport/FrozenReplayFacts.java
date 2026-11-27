package com.wotb.core.testsupport;

import com.wotb.core.model.Battle;
import com.wotb.core.replay.facts.ReplayFactsCodec;
import com.wotb.core.replay.reconstruction.ReplayReconstruction;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;

import java.io.IOException;
import java.io.InputStream;
import java.io.UncheckedIOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.zip.GZIPInputStream;

public final class FrozenReplayFacts {

    public record Facts(Battle battle, ReplayReconstruction reconstruction) {
    }

    public static final String RANDOM_BATTLE = "random-battle-example";

    private FrozenReplayFacts() {
    }

    public static Facts load(final String name) {
        final Path file = Path.of(System.getProperty("user.dir"), "..", "..", "common", "fixtures",
                "replay-facts", name + ".json.gz").normalize();
        try (InputStream in = new GZIPInputStream(Files.newInputStream(file))) {
            final JsonNode root = JsonMapper.builder().build().readTree(in);
            return new Facts(ReplayFactsCodec.battleFromJson(root.get("battle")),
                    ReplayFactsCodec.reconstructionFromJson(root.get("reconstruction")));
        } catch (IOException e) {
            throw new UncheckedIOException("frozen replay facts fixture missing/unreadable: " + file, e);
        }
    }
}
