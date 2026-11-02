package com.wotb.web.architecture;

import org.junit.jupiter.api.Test;

import java.io.IOException;
import java.io.UncheckedIOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;
import java.util.regex.Pattern;
import java.util.stream.Stream;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * #821：「禁止 {@code import *}」的 source-level 机械门禁。
 *
 * <p>import 语句不进 class 依赖，ArchUnit 字节码分析不可见，因此对三个模块的
 * production 源码做词法扫描：行注释 / 块注释 / 字符串 / char / 文本块剔除后，
 * 仅接受 {@code import <pkg>.*;} 形态的语句。随 {@code mvn test} 的
 * authoritative CI 路径执行。</p>
 *
 * <p>红线证明：{@code archfixture/ImportStarFixture} 同时包含真实
 * {@code import *} 与注释 / 字符串 / 文本块中的同形文本，检查器必须恰好命中
 * 真实那条——失败原因只能是 import * 本身，不是误报。</p>
 */
class SourceImportStarBanTest {

    private static final Pattern STAR_IMPORT =
            Pattern.compile("^import\\s+(?:static\\s+)?[A-Za-z_$][\\w.$]*\\.\\*;$");

    private static final List<String> MODULES = List.of("wotb-core", "wotb-ai", "wotb-web");

    /** 返回形如 {@code <文件名>:<行号>: <源码行>} 的违规列表。 */
    static List<String> starImports(Path javaFile) throws IOException {
        List<String> violations = new ArrayList<>();
        boolean[] inBlockComment = {false};
        boolean[] inTextBlock = {false};
        int lineNo = 0;
        for (String rawLine : Files.readAllLines(javaFile)) {
            lineNo++;
            String cleaned = stripNonCode(rawLine, inBlockComment, inTextBlock);
            if (inTextBlock[0]) {
                continue;
            }
            String trimmed = cleaned.trim();
            if (STAR_IMPORT.matcher(trimmed).matches()) {
                violations.add(javaFile.getFileName() + ":" + lineNo + ": " + trimmed);
            }
        }
        return violations;
    }

    /** 逐行剔除注释与字符串 / char / 文本块字面量；块注释与文本块状态跨行延续。 */
    private static String stripNonCode(String line, boolean[] inBlockComment, boolean[] inTextBlock) {
        if (inTextBlock[0]) {
            // 文本块内容里不识别注释；闭引号结束文本块（该行剩余内容同为文本）
            if (line.contains("\"\"\"")) {
                inTextBlock[0] = false;
            }
            return "";
        }
        StringBuilder code = new StringBuilder(line.length());
        for (int i = 0; i < line.length(); i++) {
            char c = line.charAt(i);
            char next = i + 1 < line.length() ? line.charAt(i + 1) : '\0';
            if (inBlockComment[0]) {
                if (c == '*' && next == '/') {
                    inBlockComment[0] = false;
                    i++;
                }
                continue;
            }
            if (c == '/' && next == '/') {
                break;
            }
            if (c == '/' && next == '*') {
                inBlockComment[0] = true;
                i++;
                continue;
            }
            if (c == '"') {
                if (next == '"' && i + 2 < line.length() && line.charAt(i + 2) == '"') {
                    inTextBlock[0] = true;
                    return code.toString();
                }
                i = skipLiteral(line, i, '"');
                code.append('"');
                continue;
            }
            if (c == '\'') {
                i = skipLiteral(line, i, '\'');
                code.append('\'');
                continue;
            }
            code.append(c);
        }
        return code.toString();
    }

    /** 从开引号后一位跳到闭引号；处理反斜杠转义。 */
    private static int skipLiteral(String line, int openIndex, char quote) {
        boolean escaped = false;
        for (int i = openIndex + 1; i < line.length(); i++) {
            char c = line.charAt(i);
            if (escaped) {
                escaped = false;
                continue;
            }
            if (c == '\\') {
                escaped = true;
                continue;
            }
            if (c == quote) {
                return i;
            }
        }
        return line.length() - 1;
    }

    @Test
    void productionSourcesContainNoStarImports() throws IOException {
        List<String> violations = new ArrayList<>();
        Path javaRoot = Path.of("..").toAbsolutePath().normalize();
        for (String module : MODULES) {
            Path src = javaRoot.resolve(module).resolve("src").resolve("main").resolve("java");
            try (Stream<Path> files = Files.walk(src)) {
                files.filter(path -> path.toString().endsWith(".java")).forEach(path -> {
                    try {
                        violations.addAll(starImports(path));
                    } catch (IOException e) {
                        throw new UncheckedIOException(e);
                    }
                });
            }
        }
        assertTrue(violations.isEmpty(), "禁止 import *（java/AGENTS.md 分层与风格）：" + violations);
    }

    @Test
    void detectorFlagsRealStarImportButNotCommentsOrStrings() throws IOException {
        Path fixture = Path.of("src", "test", "java", "com", "wotb", "web",
                "archfixture", "ImportStarFixture.java");
        List<String> hits = starImports(fixture);
        assertEquals(1, hits.size(), () -> "fixture 应恰好命中真实 star import：" + hits);
        assertTrue(hits.get(0).contains("import java.util.*;"),
                () -> "命中的必须是真实 import *，而不是注释/字符串/文本块：" + hits);

        Path control = Path.of("src", "test", "java", "com", "wotb", "web",
                "hundred", "archfixture", "HofDtoDependencyFixture.java");
        List<String> controlHits = starImports(control);
        assertTrue(controlHits.isEmpty(), "普通 import 的控制组不得命中：" + controlHits);
    }
}
