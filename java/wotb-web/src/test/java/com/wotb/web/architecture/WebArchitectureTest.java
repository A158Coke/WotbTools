package com.wotb.web.architecture;

import com.tngtech.archunit.core.domain.Dependency;
import com.tngtech.archunit.core.domain.JavaClass;
import com.tngtech.archunit.core.domain.JavaClasses;
import com.tngtech.archunit.core.importer.ImportOption;
import com.tngtech.archunit.junit.AnalyzeClasses;
import com.tngtech.archunit.junit.ArchTest;
import com.tngtech.archunit.lang.ArchCondition;
import com.tngtech.archunit.lang.ArchRule;
import com.tngtech.archunit.lang.ConditionEvents;
import com.tngtech.archunit.lang.SimpleConditionEvent;

import java.util.ArrayList;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Set;

import static com.tngtech.archunit.lang.syntax.ArchRuleDefinition.classes;
import static com.tngtech.archunit.lang.syntax.ArchRuleDefinition.noClasses;
import static com.tngtech.archunit.library.GeneralCodingRules.NO_CLASSES_SHOULD_USE_FIELD_INJECTION;
import static com.tngtech.archunit.library.dependencies.SlicesRuleDefinition.slices;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * wotb-web 架构契约（对应 {@code java/AGENTS.md} 与 {@code docs/DEVELOPER_GUIDE.md}）：
 * domain 分包（禁止层分包）、Controller→Service→Repository 分层、Service 不得跨域调 Repository、
 * 构造器注入（禁字段注入）、禁 Lombok、domain 层无循环依赖。
 */
@AnalyzeClasses(packages = "com.wotb.web", importOptions = ImportOption.DoNotIncludeTests.class)
class WebArchitectureTest {

    private static final String[] DOMAINS =
            {"admin", "boost", "hof", "hundred", "mark3", "replay", "user"};

    /** 允许的非 domain 位置：Spring Boot 入口根包 + 共享 config/util。 */
    private static final String[] SHARED_PACKAGES = {
            "com.wotb.web",
            "com.wotb.web.config..",
            "com.wotb.web.exceptionhandler..",
            "com.wotb.web.replayfile..",
            "com.wotb.web.util..",
    };

    @ArchTest
    static final ArchRule MAIN_CODE_LIVES_IN_DOMAIN_OR_SHARED_PACKAGES = noClasses()
            .that().resideInAPackage("com.wotb.web..")
            .should().resideOutsideOfPackages(domainAndSharedPatterns());

    @ArchTest
    static final ArchRule CONTROLLERS_MUST_NOT_USE_REPOSITORY_OR_ENTITY = noClasses()
            .that().resideInAPackage("com.wotb.web..controller..")
            .should().dependOnClassesThat().resideInAnyPackage(
                    "com.wotb.web..repository..",
                    "com.wotb.web..entity..");

    @ArchTest
    static final ArchRule SERVICES_USE_ONLY_OWN_DOMAIN_REPOSITORIES = classes()
            .that().resideInAPackage("com.wotb.web..service..")
            .should(new ArchCondition<>("only depend on repositories of their own domain") {
                @Override
                public void check(final JavaClass clazz, final ConditionEvents events) {
                    final String domain = domainOf(clazz);
                    if (domain == null) {
                        return;
                    }
                    final Set<String> violations = new LinkedHashSet<>();
                    for (final Dependency dependency : clazz.getDirectDependenciesFromSelf()) {
                        final String targetPackage = dependency.getTargetClass().getPackageName();
                        if (isRepositoryPackage(targetPackage)
                                && !targetPackage.startsWith("com.wotb.web." + domain + ".repository")) {
                            violations.add(dependency.getTargetClass().getName());
                        }
                    }
                    if (!violations.isEmpty()) {
                        events.add(SimpleConditionEvent.violated(clazz,
                                "Service 跨域使用了其它 domain 的 repository: "
                                        + String.join(", ", violations)));
                    }
                }
            });

    @ArchTest
    static final ArchRule NO_FIELD_INJECTION = NO_CLASSES_SHOULD_USE_FIELD_INJECTION;

    @ArchTest
    static final ArchRule NO_LOMBOK = noClasses()
            .should().dependOnClassesThat().resideInAnyPackage("lombok..");

    @ArchTest
    static final ArchRule WEB_DOMAINS_ARE_FREE_OF_CYCLES = slices()
            .matching("com.wotb.web.(*)..")
            .should().beFreeOfCycles();

    /** 防"规则空转"：确保分析器真实导入了 web 主代码。 */
    @ArchTest
    static void webClassesAreAnalyzed(final JavaClasses classes) {
        assertTrue(classes.size() > 100, "ArchUnit 未导入足量 com.wotb.web 主类: " + classes.size());
    }

    private static String[] domainAndSharedPatterns() {
        final List<String> patterns = new ArrayList<>(List.of(SHARED_PACKAGES));
        for (final String domain : DOMAINS) {
            patterns.add("com.wotb.web." + domain + "..");
        }
        return patterns.toArray(String[]::new);
    }

    private static String domainOf(final JavaClass clazz) {
        final String pkg = clazz.getPackageName();
        final String prefix = "com.wotb.web.";
        if (!pkg.startsWith(prefix)) {
            return null;
        }
        final int serviceIdx = pkg.indexOf(".service", prefix.length());
        if (serviceIdx < 0) {
            return null;
        }
        return pkg.substring(prefix.length(), serviceIdx);
    }

    private static boolean isRepositoryPackage(final String pkg) {
        return pkg.startsWith("com.wotb.web.")
                && (pkg.endsWith(".repository") || pkg.contains(".repository."));
    }
}
