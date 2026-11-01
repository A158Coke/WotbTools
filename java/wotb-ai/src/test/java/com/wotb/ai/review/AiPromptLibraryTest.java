package com.wotb.ai.review;

import com.wotb.ai.prompt.AiPromptLibrary;

import org.junit.jupiter.api.Test;

import java.nio.file.Files;
import java.nio.file.Path;
import java.util.HashSet;
import java.util.List;
import java.util.Set;
import java.util.concurrent.Callable;
import java.util.concurrent.Executors;
import java.util.stream.Collectors;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

class AiPromptLibraryTest {

    @Test
    void everyPromptKeyLoadsNonBlank() {
        assertLoaded("player/fallback", PlayerPromptRules.SYSTEM_PROMPT);
        assertLoaded("player/single", PlayerPromptRules.SINGLE_PLAYER_PROMPT);
        assertLoaded("player/tactical", TacticalReviewPromptBuilder.TACTICAL_SYSTEM_PROMPT);
        assertLoaded("team/single", TeamPromptLocalizer.SINGLE_TEAM_PROMPT);
        assertLoaded("prebattle/system", PreBattlePromptBuilder.PRE_BATTLE_SYSTEM_PROMPT);
        assertLoaded("prebattle/user-header", PreBattlePromptBuilder.PRE_BATTLE_USER_HEADER);
        assertLoaded("prebattle/confidence-legend", PreBattlePromptBuilder.CONFIDENCE_LEGEND);
    }

    private static void assertLoaded(final String key, final String value) {
        assertNotNull(value, key + " must load");
        assertFalse(value.isBlank(), key + " must not be blank");
    }

    @Test
    void tacticalPromptBuildsOnFallback() {
        assertTrue(TacticalReviewPromptBuilder.TACTICAL_SYSTEM_PROMPT
                        .startsWith(PlayerPromptRules.SYSTEM_PROMPT),
                "tactical prompt must start with the fallback system prompt");
    }

    @Test
    void promptsMustNotContainJavaTextBlockDelimiters() {
        assertFalse(TacticalReviewPromptBuilder.TACTICAL_SYSTEM_PROMPT.contains("\"\"\""),
                "prompt md must not contain Java text block delimiters");
    }

    @Test
    void allResourceKeysHaveExactlyThreeLanguagesAndExpand() throws Exception {
        final Path root = Path.of("src/main/resources/prompts");
        final Set<String> allFiles;
        try (final var paths = Files.walk(root)) {
            allFiles = paths.filter(Files::isRegularFile)
                    .map(root::relativize).map(path -> path.toString().replace('\\', '/'))
                    .collect(Collectors.toSet());
        }
        assertFalse(allFiles.isEmpty());
        final Set<String> zhKeys = keys(allFiles, "zh");
        assertEquals(zhKeys, keys(allFiles, "en"));
        assertEquals(zhKeys, keys(allFiles, "ru"));
        assertEquals(zhKeys.size() * 3, allFiles.size(), "资源目录只允许三语 Markdown 文件");
        for (final String key : zhKeys) {
            for (final String language : List.of("zh", "en", "ru")) {
                final String text = AiPromptLibrary.text(key, language);
                assertFalse(text.isBlank(), key + "." + language);
                assertFalse(text.contains("{{"), key + "." + language + " 包含未展开引用");
            }
            assertEquals(AiPromptLibrary.text(key, "zh"), AiPromptLibrary.zh(key));
        }
    }

    private static Set<String> keys(final Set<String> files, final String language) {
        final String suffix = "." + language + ".md";
        return files.stream().filter(file -> file.endsWith(suffix))
                .map(file -> file.substring(0, file.length() - suffix.length()))
                .collect(Collectors.toCollection(HashSet::new));
    }

    @Test
    void includesUseTheRequestedLanguageAndCacheIsIsolated() throws Exception {
        try (final var executor = Executors.newVirtualThreadPerTaskExecutor()) {
            final var tasks = new java.util.ArrayList<Callable<Void>>();
            for (int i = 0; i < 30; i++) {
                for (final String language : List.of("ru", "zh", "en")) {
                    tasks.add(() -> {
                        assertEquals(language + ":child:" + language + "\n",
                                AiPromptLibrary.text("_test/parent", language));
                        return null;
                    });
                }
            }
            for (final var result : executor.invokeAll(tasks)) {
                result.get();
            }
        }
    }

    @Test
    void missingResourcesAndCyclesFailWithoutChineseFallback() {
        assertTrue(assertThrows(IllegalStateException.class,
                () -> AiPromptLibrary.text("_test/missing", "ru"))
                .getMessage().contains("/prompts/_test/missing.ru.md"));
        assertTrue(assertThrows(IllegalStateException.class,
                () -> AiPromptLibrary.text("_test/zh-only", "en"))
                .getMessage().contains("/prompts/_test/zh-only.en.md"));
        assertTrue(assertThrows(IllegalStateException.class,
                () -> AiPromptLibrary.zh("_test/dangling"))
                .getMessage().contains("/prompts/_test/absent.zh.md"));
        final String cycle = assertThrows(IllegalStateException.class,
                () -> AiPromptLibrary.text("_test/cycle-a", "en")).getMessage();
        assertTrue(cycle.contains("_test/cycle-a.en -> _test/cycle-b.en -> _test/cycle-a.en"));
    }

    @Test
    void invalidLanguageIsRejectedAndLineEndingsPreserveTrailingWhitespace() {
        for (final String invalid : List.of("", "de", "en-US", "EN", "../zh")) {
            assertThrows(IllegalArgumentException.class, () -> AiPromptLibrary.text("player/single", invalid));
        }
        assertThrows(IllegalArgumentException.class, () -> AiPromptLibrary.text("player/single", null));
        assertEquals("first\nsecond\nthird\n\n", AiPromptLibrary.zh("_test/line-endings"));
        assertEquals("no trailing newline", AiPromptLibrary.zh("_test/no-newline"));
        assertEquals(AiPromptLibrary.zh("player/single"), PlayerPromptRules.systemPrompt("player/single", null));
        assertEquals(AiPromptLibrary.zh("team/single"), TeamPromptLocalizer.systemPrompt(null));
    }
}
