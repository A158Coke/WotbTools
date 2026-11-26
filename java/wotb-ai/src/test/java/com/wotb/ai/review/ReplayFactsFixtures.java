package com.wotb.ai.review;

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

final class ReplayFactsFixtures {

    record Facts(Battle battle, ReplayReconstruction reconstruction) {
    }

    private ReplayFactsFixtures() {
    }

    /**
     * 每次调用都解码新实例（不缓存）：调用方可能改写 Battle（enrichment），测试之间不得互相污染。
     *
     * @param fixture 夹具名，可带路径 / {@code .wotbreplay} 后缀（如 eval case 里的
     *                {@code common/fixtures/replays/random-battle-example.wotbreplay}）
     */
    static Facts load(final String fixture) {
        String name = fixture.substring(fixture.lastIndexOf('/') + 1);
        if (name.endsWith(".wotbreplay")) {
            name = name.substring(0, name.length() - ".wotbreplay".length());
        }
        return read(name);
    }

    private static Facts read(final String name) {
        final Path file = Path.of(System.getProperty("user.dir"), "..", "..", "common", "fixtures",
                "replay-facts", name + ".json.gz").normalize();
        try (InputStream in = new GZIPInputStream(Files.newInputStream(file))) {
            final JsonNode root = JsonMapper.builder().build().readTree(in);
            return new Facts(ReplayFactsCodec.battleFromJson(root.get("battle")),
                    ReplayFactsCodec.reconstructionFromJson(root.get("reconstruction")));
        } catch (IOException e) {
            throw new UncheckedIOException(e);
        }
    }
}
