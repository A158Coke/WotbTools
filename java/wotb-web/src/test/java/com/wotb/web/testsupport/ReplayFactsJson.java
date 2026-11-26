package com.wotb.web.testsupport;

import com.fasterxml.jackson.annotation.JsonAutoDetect;
import com.fasterxml.jackson.annotation.PropertyAccessor;
import com.wotb.core.model.Battle;
import tools.jackson.databind.json.JsonMapper;

import java.io.IOException;
import java.io.InputStream;
import java.io.UncheckedIOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.Arrays;
import java.util.List;
import java.util.zip.GZIPInputStream;

public final class ReplayFactsJson {

    private static final JsonMapper MAPPER = JsonMapper.builder()
            .changeDefaultVisibility(vc -> vc
                    .withVisibility(PropertyAccessor.FIELD, JsonAutoDetect.Visibility.ANY)
                    .withVisibility(PropertyAccessor.GETTER, JsonAutoDetect.Visibility.NONE)
                    .withVisibility(PropertyAccessor.IS_GETTER, JsonAutoDetect.Visibility.NONE))
            .build();

    private ReplayFactsJson() {
    }

    public static String of(final Battle battle) {
        return MAPPER.writeValueAsString(battle);
    }

    public static List<String> ofAll(final Battle... battles) {
        return Arrays.stream(battles).map(ReplayFactsJson::of).toList();
    }

    public static List<String> ofAll(final List<Battle> battles) {
        return battles.stream().map(ReplayFactsJson::of).toList();
    }

    public static String fixture(final String name) {
        final Path file = Path.of(System.getProperty("user.dir"), "..", "..", "common", "fixtures",
                "replay-facts", name + ".json.gz").normalize();
        try (InputStream in = new GZIPInputStream(Files.newInputStream(file))) {
            return MAPPER.writeValueAsString(MAPPER.readTree(in).get("battle"));
        } catch (final IOException e) {
            throw new UncheckedIOException("frozen replay facts fixture missing/unreadable: " + file, e);
        }
    }
}
