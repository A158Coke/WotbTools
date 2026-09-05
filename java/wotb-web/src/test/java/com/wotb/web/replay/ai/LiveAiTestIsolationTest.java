package com.wotb.web.replay.ai;

import org.junit.jupiter.api.Test;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import java.util.stream.Stream;

import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * Deterministic guard for the boundary between normal AI tests and paid external
 * provider probes. It scans source and the module POM; it never creates a gateway
 * or makes a network request.
 */
class LiveAiTestIsolationTest {

    private static final String LIVE_TAG = "@Tag(\"ai-live\")";
    private static final List<String> KNOWN_LIVE_TESTS = List.of(
            "com/wotb/web/replay/ai/TeamReviewRealE2EProbeTest.java",
            "com/wotb/web/replay/ai/TeamReviewBatchE2EProbeTest.java",
            "com/wotb/web/replay/ai/TeamReviewDetailedReproProbeTest.java",
            "com/wotb/web/replay/ai/eval/TeamTacticalSkillLiveBehaviorEvalTest.java");

    @Test
    void everyKnownLiveTestIsTaggedAndStillPresent() throws IOException {
        final Path testRoot = testRoot();
        final List<String> missing = new ArrayList<>();
        for (final String relative : KNOWN_LIVE_TESTS) {
            final Path sourcePath = testRoot.resolve(relative);
            if (!Files.isRegularFile(sourcePath)) {
                missing.add(relative + " (file missing)");
                continue;
            }
            final String source = read(sourcePath);
            if (!hasClassLevelLiveTag(source, sourcePath.getFileName().toString())) {
                missing.add(relative + " (missing class-level " + LIVE_TAG + ")");
            }
        }
        assertTrue(missing.isEmpty(), "Known live AI tests must remain tagged: " + missing);
    }

    @Test
    void productionExternalProviderTestsMustBeTagged() throws IOException {
        final Path testRoot = testRoot();
        final List<String> violations = new ArrayList<>();
        try (Stream<Path> paths = Files.walk(testRoot)) {
            paths.filter(path -> path.toString().endsWith(".java"))
                    .filter(path -> !path.getFileName().toString().equals("LiveAiTestIsolationTest.java"))
                    .forEach(path -> inspectCandidate(path, violations));
        }
        assertTrue(violations.isEmpty(), "External AI test must be tagged ai-live: " + violations);
    }

    @Test
    void surefireExcludesLiveAndCaptureProbeGroupsByDefault() throws IOException {
        final String pom = read(modulePom());
        final Matcher property = Pattern.compile(
                "<ai\\.probe\\.excludedGroups>\\s*([^<]+?)\\s*</ai\\.probe\\.excludedGroups>")
                .matcher(pom);
        assertTrue(property.find(), "wotb-web POM must define ai.probe.excludedGroups");
        final List<String> groups = List.of(property.group(1).trim().split("\\s*,\\s*"));
        assertTrue(groups.contains("ai-live"), "Default Surefire exclusions must contain ai-live");
        assertTrue(groups.contains("ai-capture-probe"),
                "Default Surefire exclusions must retain ai-capture-probe");
        assertTrue(pom.contains("<excludedGroups>${ai.probe.excludedGroups}</excludedGroups>"),
                "Surefire must bind excludedGroups to ai.probe.excludedGroups");
    }

    private static void inspectCandidate(final Path path, final List<String> violations) {
        try {
            final String source = read(path);
            final boolean productionGatewayFactory = source.contains("SpringAiChatGateway.fromProperties(");
            final boolean productionOpenAiClient = source.contains("OpenAiChatModel")
                    || source.contains("ChatClient");
            final boolean apiKeyRead = source.contains("System.getenv(\"AI_API_KEY\")");
            final boolean deepSeekProvider = source.contains("api.deepseek.com");
            final boolean candidate = (productionGatewayFactory || productionOpenAiClient)
                    && apiKeyRead && deepSeekProvider;
            if (candidate && !hasClassLevelLiveTag(source, path.getFileName().toString())) {
                violations.add(path + " (production client + AI_API_KEY + DeepSeek provider)");
            }
        } catch (final IOException e) {
            violations.add(path + " (cannot read source: " + e.getMessage() + ")");
        }
    }

    private static boolean hasClassLevelLiveTag(final String source, final String fileName) {
        final String className = fileName.substring(0, fileName.length() - ".java".length());
        final int classIndex = source.indexOf("class " + className);
        if (classIndex < 0) {
            return false;
        }
        final int previousClassEnd = source.lastIndexOf('}', classIndex);
        final String declaration = source.substring(previousClassEnd + 1, classIndex);
        return declaration.contains(LIVE_TAG);
    }

    private static String read(final Path path) throws IOException {
        return Files.readString(path, StandardCharsets.UTF_8);
    }

    private static Path testRoot() {
        final Path moduleRoot = Path.of(System.getProperty("user.dir"));
        final Path moduleTestRoot = moduleRoot.resolve("src/test/java");
        if (Files.isDirectory(moduleTestRoot)) {
            return moduleTestRoot;
        }
        return moduleRoot.resolve("java/wotb-web/src/test/java");
    }

    private static Path modulePom() {
        final Path moduleRoot = Path.of(System.getProperty("user.dir"));
        final Path modulePom = moduleRoot.resolve("pom.xml");
        if (Files.isRegularFile(modulePom) && readQuietly(modulePom).contains("<artifactId>wotb-web</artifactId>")) {
            return modulePom;
        }
        return moduleRoot.resolve("java/wotb-web/pom.xml");
    }

    private static String readQuietly(final Path path) {
        try {
            return read(path);
        } catch (final IOException e) {
            return "";
        }
    }
}
