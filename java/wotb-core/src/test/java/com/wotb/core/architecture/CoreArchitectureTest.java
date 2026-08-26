package com.wotb.core.architecture;

import com.tngtech.archunit.core.importer.ImportOption;
import com.tngtech.archunit.core.domain.JavaClasses;
import com.tngtech.archunit.junit.AnalyzeClasses;
import com.tngtech.archunit.junit.ArchTest;
import com.tngtech.archunit.lang.ArchRule;

import static com.tngtech.archunit.lang.syntax.ArchRuleDefinition.noClasses;
import static com.tngtech.archunit.library.dependencies.SlicesRuleDefinition.slices;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * wotb-core 架构契约（对应 {@code java/AGENTS.md} 与 {@code docs/DEVELOPER_GUIDE.md}）：
 * 纯库边界——不依赖 Spring Web/Boot 容器，不反向依赖 wotb-web；core 内部无循环依赖。
 */
@AnalyzeClasses(packages = "com.wotb.core", importOptions = ImportOption.DoNotIncludeTests.class)
class CoreArchitectureTest {

    @ArchTest
    static final ArchRule CORE_MUST_NOT_DEPEND_ON_WEB_OR_SPRING_CONTAINER = noClasses()
            .that().resideInAPackage("com.wotb.core..")
            .should().dependOnClassesThat().resideInAnyPackage(
                    "org.springframework.web..",
                    "org.springframework.boot..",
                    "com.wotb.web..");

    @ArchTest
    static final ArchRule CORE_LAYERS_ARE_FREE_OF_CYCLES = slices()
            .matching("com.wotb.core.(*)..")
            .should().beFreeOfCycles();

    /** 防"规则空转"：确保分析器真实导入了 core 主代码。 */
    @ArchTest
    static void coreClassesAreAnalyzed(final JavaClasses classes) {
        assertTrue(classes.size() > 0, "ArchUnit 未导入任何 com.wotb.core 主类");
    }
}
