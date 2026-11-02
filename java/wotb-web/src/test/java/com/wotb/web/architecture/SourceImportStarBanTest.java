package com.wotb.web.architecture;

import com.sun.source.tree.CompilationUnitTree;
import com.sun.source.tree.ImportTree;
import com.sun.source.tree.MemberSelectTree;
import com.sun.source.util.JavacTask;
import org.junit.jupiter.api.Test;

import javax.tools.Diagnostic;
import javax.tools.DiagnosticCollector;
import javax.tools.JavaCompiler;
import javax.tools.JavaFileObject;
import javax.tools.StandardJavaFileManager;
import javax.tools.ToolProvider;
import java.io.File;
import java.io.IOException;
import java.io.PrintWriter;
import java.io.StringWriter;
import java.io.UncheckedIOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import java.util.stream.Stream;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * #821：「禁止 {@code import *}」的 JLS token 级机械门禁。
 *
 * <p>import 语句不进 class 依赖，ArchUnit 字节码分析不可见，因此用 JDK 自带的
 * javac parser API（{@code com.sun.source}，无第三方依赖）把每个 .java 源文件
 * 解析成编译单元，再检查 on-demand import 的限定名是否以 {@code *} 结尾——
 * 多行、注间空白/注释、Unicode 翻译等所有词法形态天然覆盖。扫描范围是三个
 * 模块的 {@code src/main/java} 与 {@code src/test/java}（java/AGENTS.md 的
 * 禁令没有 production 限定）。随 {@code mvn test} 的 authoritative CI 路径执行。</p>
 *
 * <p>红线证明（committed）：{@code src/test/resources/archfixture/import-star/}
 * 的每个违规 fixture 覆盖一种 JLS 合法形态（普通 / static / 多行 / 注间空白 /
 * 注间注释 / Unicode 转义），本测试用<b>同一个 gate predicate</b> 断言它们逐一
 * 被拒绝、控制组零命中——失败原因只能是 import * 本身。</p>
 */
class SourceImportStarBanTest {

    private static final List<String> MODULES = List.of("wotb-core", "wotb-ai", "wotb-web");

    private static final Path JAVA_ROOT = Path.of("..").toAbsolutePath().normalize();

    private static final Path FIXTURE_DIR =
            Path.of("src", "test", "resources", "archfixture", "import-star");

    record ParsedImports(List<String> starImports, List<String> parseErrors) {
    }

    /** 用 javac parser 检查 on-demand import；解析错误 fail closed。 */
    static ParsedImports findStarImports(List<Path> javaFiles) {
        JavaCompiler compiler = ToolProvider.getSystemJavaCompiler();
        DiagnosticCollector<JavaFileObject> diagnostics = new DiagnosticCollector<>();
        StringWriter sink = new StringWriter();
        try (StandardJavaFileManager fileManager =
                     compiler.getStandardFileManager(diagnostics, Locale.ROOT, StandardCharsets.UTF_8)) {
            List<File> sources = javaFiles.stream().map(Path::toFile).toList();
            JavacTask task = (JavacTask) compiler.getTask(
                    new PrintWriter(sink), fileManager, diagnostics, null, null,
                    fileManager.getJavaFileObjectsFromFiles(sources));
            List<String> starImports = new ArrayList<>();
            for (CompilationUnitTree unit : task.parse()) {
                String fileName = unit.getSourceFile().getName();
                for (ImportTree importTree : unit.getImports()) {
                    if (importTree.getQualifiedIdentifier() instanceof MemberSelectTree select
                            && select.getIdentifier().contentEquals("*")) {
                        starImports.add(fileName + (importTree.isStatic() ? ": import static ….*;" : ": import ….*;"));
                    }
                }
            }
            List<String> errors = diagnostics.getDiagnostics().stream()
                    .filter(diagnostic -> diagnostic.getKind() == Diagnostic.Kind.ERROR)
                    .map(diagnostic -> diagnostic.getSource() + ": " + diagnostic.getMessage(Locale.ROOT))
                    .toList();
            return new ParsedImports(starImports, errors);
        } catch (IOException e) {
            // file manager 关闭失败按工具错误处理：fail closed 而非静默放行
            throw new UncheckedIOException(e);
        }
    }

    private static List<Path> collectModuleSources() {
        List<Path> files = new ArrayList<>();
        for (String module : MODULES) {
            Path moduleRoot = JAVA_ROOT.resolve(module).resolve("src");
            try (Stream<Path> walk = Files.walk(moduleRoot)) {
                walk.filter(path -> path.toString().endsWith(".java"))
                        .filter(path -> path.startsWith(moduleRoot.resolve("main/java"))
                                || path.startsWith(moduleRoot.resolve("test/java")))
                        .forEach(files::add);
            } catch (IOException e) {
                throw new UncheckedIOException(e);
            }
        }
        return files;
    }

    @Test
    void repositoryJavaSourcesContainNoStarImports() {
        ParsedImports parsed = findStarImports(collectModuleSources());
        assertTrue(parsed.parseErrors().isEmpty(),
                "源码必须可解析（fail closed）：" + parsed.parseErrors());
        assertTrue(parsed.starImports().isEmpty(),
                "禁止 import *（java/AGENTS.md 分层与风格，production + test 全部 Java 源码）：" + parsed.starImports());
    }

    @Test
    void gatePredicateRejectsEveryForbiddenImportFormAndAcceptsControl() throws IOException {
        try (Stream<Path> fixtures = Files.list(FIXTURE_DIR)) {
            for (Path fixture : fixtures.filter(path -> path.toString().endsWith(".java")).toList()) {
                ParsedImports parsed = findStarImports(List.of(fixture));
                assertTrue(parsed.parseErrors().isEmpty(),
                        "fixture 必须可解析：" + fixture + " → " + parsed.parseErrors());
                boolean isControl = fixture.getFileName().toString().startsWith("Control");
                if (isControl) {
                    assertTrue(parsed.starImports().isEmpty(),
                            "控制组不得命中：" + parsed.starImports());
                } else {
                    assertEquals(1, parsed.starImports().size(),
                            () -> "违规 fixture 必须被同一 gate predicate 拒绝：" + fixture + " → " + parsed.starImports());
                }
            }
        }
    }
}
