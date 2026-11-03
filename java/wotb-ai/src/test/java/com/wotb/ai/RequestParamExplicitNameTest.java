package com.wotb.ai;

import com.tngtech.archunit.core.domain.JavaAnnotation;
import com.tngtech.archunit.core.domain.JavaClass;
import com.tngtech.archunit.core.domain.JavaClasses;
import com.tngtech.archunit.core.domain.JavaMethod;
import com.tngtech.archunit.core.domain.JavaParameter;
import com.tngtech.archunit.core.importer.ClassFileImporter;
import org.junit.jupiter.api.Test;
import org.springframework.web.bind.annotation.RequestParam;

import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.Set;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * #821：「{@code @RequestParam(name="x")} 必须显式写 name」的机械门禁——
 * wotb-ai 镜像（与 wotb-web 的同名 gate 同型；跨模块 test 工具共享需 test-jar
 * 基建，故按本仓 per-module arch gate 模式复制谓词）。
 *
 * <p>规则语义与 wotb-web 一致：参数标注 {@code @RequestParam} 且未提供非空
 * 字面量 name/value（空串算未提供——Spring 对空 name 回退到 Java 参数名），
 * 且 raw 类型不是 Map/MultiValueMap 聚合绑定 → 违规。覆盖 wotb-ai production
 * classes（其 controller 真实使用 @RequestParam），随 {@code mvn test} 的
 * authoritative CI 路径执行。</p>
 *
 * <p>红线证明（committed）：{@code archfixture.RequestParamFixture} 的
 * unnamed / 空 name / 空 value 形态必须被<b>同一检查</b>拒绝，显式 name 与
 * 聚合绑定必须通过。</p>
 */
class RequestParamExplicitNameTest {

    private static JavaClasses productionClasses() {
        Path classes = Path.of("target", "classes").toAbsolutePath().normalize();
        assertTrue(Files.isDirectory(classes),
                "production classes 缺失：请先构建 wotb-ai（CI 由 reactor 顺序保证）");
        return new ClassFileImporter().importPath(classes.toString());
    }

    /** 语义与 wotb-web 的 RequestParamExplicitNameTest 保持一致。 */
    static List<String> unnamedRequestParamViolations(JavaClasses classes) {
        List<String> violations = new ArrayList<>();
        for (JavaClass clazz : classes) {
            for (JavaMethod method : clazz.getMethods()) {
                List<JavaClass> rawParameterTypes = method.getRawParameterTypes();
                List<Set<JavaAnnotation<JavaParameter>>> parameterAnnotations =
                        method.getParameterAnnotations();
                for (int index = 0; index < parameterAnnotations.size(); index++) {
                    for (JavaAnnotation<JavaParameter> annotation : parameterAnnotations.get(index)) {
                        if (!annotation.getRawType().isEquivalentTo(RequestParam.class)) {
                            continue;
                        }
                        if (hasNonEmptyProperty(annotation, "name")
                                || hasNonEmptyProperty(annotation, "value")) {
                            continue;
                        }
                        if (rawParameterTypes.get(index).isAssignableTo(Map.class)) {
                            continue;
                        }
                        violations.add(clazz.getName() + "#" + method.getName() + " 参数 #" + index
                                + ": @RequestParam 缺少非空显式 name/value"
                                + "（unnamed 或空串仅允许 Map/MultiValueMap 聚合绑定）");
                    }
                }
            }
        }
        return violations;
    }

    /** 显式绑定名 = 属性声明为字面量 String 且非空串；非字面量值按违规处理（gate 偏向红）。 */
    private static boolean hasNonEmptyProperty(JavaAnnotation<JavaParameter> annotation, String property) {
        return annotation.tryGetExplicitlyDeclaredProperty(property)
                .filter(String.class::isInstance)
                .map(String.class::cast)
                .filter(value -> !value.isEmpty())
                .isPresent();
    }

    @Test
    void productionControllersDeclareExplicitRequestParamNamesOrAggregateBinding() {
        List<String> violations = unnamedRequestParamViolations(productionClasses());
        assertTrue(violations.isEmpty(),
                "@RequestParam 必须显式写 name/value（例外：Map/MultiValueMap 聚合绑定）：" + violations);
    }

    @Test
    void unnamedAndEmptyNameFixturesAreRejectedButExplicitAndAggregateBindingsPass() {
        JavaClasses fixtures = new ClassFileImporter()
                .importPackages("com.wotb.ai.archfixture");
        List<String> violations = unnamedRequestParamViolations(fixtures);
        assertEquals(3, violations.size(), () -> String.join("; ", violations));
        assertTrue(violations.stream().anyMatch(v -> v.contains("#unnamed")),
                () -> "完全 unnamed 形态必须命中：" + violations);
        assertTrue(violations.stream().anyMatch(v -> v.contains("#emptyName")),
                () -> "空串 name 必须命中（Spring 回退参数名）：" + violations);
        assertTrue(violations.stream().anyMatch(v -> v.contains("#emptyValue")),
                () -> "空串 value 必须命中：" + violations);
    }
}
