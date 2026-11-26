package com.wotb.core.architecture;

import com.tngtech.archunit.core.domain.JavaClasses;
import com.tngtech.archunit.core.importer.ImportOption;
import com.tngtech.archunit.junit.AnalyzeClasses;
import com.tngtech.archunit.junit.ArchTest;
import com.tngtech.archunit.lang.ArchRule;
import org.junit.jupiter.api.Test;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.List;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import java.util.stream.Stream;

import static com.tngtech.archunit.lang.syntax.ArchRuleDefinition.noClasses;
import static com.tngtech.archunit.library.dependencies.SlicesRuleDefinition.slices;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.junit.jupiter.api.Assertions.assertFalse;

@AnalyzeClasses(packages = "com.wotb.core", importOptions = ImportOption.DoNotIncludeTests.class)
class CoreArchitectureTest {
    private static final Path MAIN_SOURCE = Path.of("src/main/java");
    private static final Pattern PACKAGE_DECLARATION = Pattern.compile(
            "(?m)^\\s*package\\s+([\\w.]+)\\s*;");

    @ArchTest
    static final ArchRule CORE_MUST_NOT_DEPEND_ON_WEB_OR_SPRING_CONTAINER = noClasses()
            .that().resideInAPackage("com.wotb.core..")
            .should().dependOnClassesThat().resideInAnyPackage(
                    "org.springframework.web..",
                    "org.springframework.boot..",
                    "com.wotb.web..");

    @ArchTest
    static final ArchRule CORE_PRODUCTION_MUST_NOT_DEPEND_ON_RESEARCH_PROBES = noClasses()
            .that().resideInAPackage("com.wotb.core..")
            .should().dependOnClassesThat().resideInAnyPackage(
                    "com.wotb.core.parse.probe..",
                    "com.wotb.core.research..",
                    "com.wotb.core.benchmark..",
                    "com.wotb.core.poc..");

    @ArchTest
    static final ArchRule CORE_LAYERS_ARE_FREE_OF_CYCLES = slices()
            .matching("com.wotb.core.(*)..")
            .should().beFreeOfCycles();

    @ArchTest
    static void coreClassesAreAnalyzed(final JavaClasses classes) {
        assertTrue(classes.size() > 0, "ArchUnit 未导入任何 com.wotb.core 主类");
    }

    @Test
    void productionPackagesBelongOnlyToCoreNamespace() throws IOException {
        try (Stream<Path> sources = Files.walk(MAIN_SOURCE)) {
            final List<Path> violations = sources.filter(path -> path.toString().endsWith(".java"))
                    .filter(path -> !hasOnlyCorePackage(read(path))).toList();
            assertTrue(violations.isEmpty(), "wotb-core production package must be com.wotb.core..: " + violations);
        }
    }

    @Test
    void coreNamespaceGuardRejectsSyntheticForeignPackages() {
        assertTrue(hasOnlyCorePackage("package com.wotb.core.foo; class Allowed {}"));
        assertFalse(hasOnlyCorePackage("package com.wotb.web.fake; class Rejected {}"));
        assertFalse(hasOnlyCorePackage("package com.wotb.ai.fake; class Rejected {}"));
        assertFalse(hasOnlyCorePackage("package com.other.fake; class Rejected {}"));
    }

    private static boolean hasOnlyCorePackage(final String source) {
        final Matcher matcher = PACKAGE_DECLARATION.matcher(source);
        return matcher.find() && (matcher.group(1).equals("com.wotb.core")
                || matcher.group(1).startsWith("com.wotb.core."));
    }

    private static String read(final Path source) {
        try {
            return Files.readString(source);
        } catch (IOException error) {
            throw new IllegalStateException("Unable to read " + source, error);
        }
    }
}
