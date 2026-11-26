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

class RequestParamExplicitNameTest {

    private static JavaClasses productionClasses() {
        Path classes = Path.of("target", "classes").toAbsolutePath().normalize();
        assertTrue(Files.isDirectory(classes),
                "production classes 缺失：请先构建 wotb-ai（CI 由 reactor 顺序保证）");
        return new ClassFileImporter().importPath(classes.toString());
    }

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
