package com.wotb.ai;

import org.junit.jupiter.api.Test;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.List;
import java.util.regex.Pattern;
import java.util.stream.Stream;

import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

class AiArchitectureTest {
    private static final Path MAIN_SOURCE = Path.of("src/main/java");
    private static final Path MODULE_POM = Path.of("pom.xml");
    private static final Pattern LEGACY_PACKAGE = Pattern.compile(
            "^\\s*package\\s+com\\.wotb\\.web\\.(?:replay\\.(?:ai|dto|exception)|config)(?:\\.|;)");
    private static final Pattern LEGACY_AI_REFERENCE = Pattern.compile(
            "com\\.wotb\\.web\\.(?:config\\.AiModelProperties|replay\\.(?:ai|dto|exception))");

    @Test
    void productionSourcesDoNotDeclareLegacyAiPackages() throws IOException {
        try (Stream<Path> sources = javaSources()) {
            assertTrue(sources.noneMatch(source -> {
                final String content = read(source);
                return LEGACY_PACKAGE.matcher(content).find() || LEGACY_AI_REFERENCE.matcher(content).find();
            }), "wotb-ai production source must not reference legacy web AI packages");
        }
    }

    @Test
    void reviewAndTournamentRemainSiblingFeatures() throws IOException {
        try (Stream<Path> sources = javaSources()) {
            final List<Path> violations = sources.filter(source -> {
                final String content = read(source);
                return content.contains("package com.wotb.ai.review")
                        ? content.contains("com.wotb.ai.tournament.")
                        : content.contains("package com.wotb.ai.tournament")
                                && content.contains("com.wotb.ai.review.");
            }).toList();
            assertTrue(violations.isEmpty(), "Review and Tournament must not depend on each other: " + violations);
        }
    }

    @Test
    void commonPackagesDoNotDependOnFeatures() throws IOException {
        try (Stream<Path> sources = javaSources()) {
            final List<Path> violations = sources.filter(source -> {
                final String content = read(source);
                final boolean common = content.matches("(?s).*?package com\\.wotb\\.ai\\.(?:gateway|config|prompt)(?:\\.[\\w.]+)?;.*");
                return common && (content.contains("com.wotb.ai.review.")
                        || content.contains("com.wotb.ai.tournament."));
            }).toList();
            assertTrue(violations.isEmpty(), "Common AI packages must not depend on features: " + violations);
        }
    }

    @Test
    void aiModuleDoesNotDependOnWebModule() throws IOException {
        final String pom = Files.readString(MODULE_POM);
        assertFalse(pom.contains("<artifactId>wotb-web</artifactId>"),
                "wotb-ai must depend on wotb-core only, not wotb-web");
    }

    private static Stream<Path> javaSources() throws IOException {
        return Files.walk(MAIN_SOURCE).filter(path -> path.toString().endsWith(".java"));
    }

    private static String read(final Path source) {
        try {
            return Files.readString(source);
        } catch (IOException exception) {
            throw new IllegalStateException("Unable to read " + source, exception);
        }
    }
}
