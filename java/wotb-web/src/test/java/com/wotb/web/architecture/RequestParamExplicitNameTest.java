package com.wotb.web.architecture;

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
 * #821：「{@code @RequestParam(name="x")} 必须显式写 name」的机械门禁
 * （round 3 由 B-deferred 落地）。
 *
 * <p>{@code @RequestParam} 是 RUNTIME retention，编译后的参数注解元数据
 * 可直接由 ArchUnit（本仓 authoritative architecture-test entrypoint）读取，
 * 无需源码 regex / AST parser，天然免疫多行注解与注释形态。覆盖范围：
 * wotb-web production classes（本模块的 controller 域；wotb-ai 的 controller
 * 形态已核实全部显式 name，其 coverage 待该模块引入 ArchUnit infra 时镜像）。
 * 例外与 java/AGENTS.md 同步：unnamed 仅允许 {@code Map} / {@code MultiValueMap}
 * 聚合绑定（raw type assignable to Map，Spring 官方合法形态）。</p>
 *
 * <p>红线证明（committed）：{@code archfixture.requestparam.RequestParamFixture}
 * 的 unnamed 形态必须被<b>同一检查</b>拒绝，显式 name/value 与聚合绑定必须通过
 * ——失败原因只能是缺失显式 name，不是其他配置错误。</p>
 */
class RequestParamExplicitNameTest {

    private static JavaClasses productionClasses() {
        Path classes = Path.of("target", "classes").toAbsolutePath().normalize();
        assertTrue(Files.isDirectory(classes),
                "production classes 缺失：请先构建 wotb-web（CI 由 reactor 顺序保证）");
        return new ClassFileImporter().importPath(classes.toString());
    }

    /**
     * 返回违规列表：参数标注 {@code @RequestParam} 且未显式声明 name/value，
     * 且 raw 类型不是 Map 聚合绑定。
     */
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
                        if (annotation.hasExplicitlyDeclaredProperty("name")
                                || annotation.hasExplicitlyDeclaredProperty("value")) {
                            continue;
                        }
                        if (rawParameterTypes.get(index).isAssignableTo(Map.class)) {
                            continue;
                        }
                        violations.add(clazz.getName() + "#" + method.getName() + " 参数 #" + index
                                + ": @RequestParam 缺少显式 name/value"
                                + "（unnamed 仅允许 Map/MultiValueMap 聚合绑定）");
                    }
                }
            }
        }
        return violations;
    }

    @Test
    void productionControllersDeclareExplicitRequestParamNamesOrAggregateBinding() {
        List<String> violations = unnamedRequestParamViolations(productionClasses());
        assertTrue(violations.isEmpty(),
                "@RequestParam 必须显式写 name/value（例外：Map/MultiValueMap 聚合绑定）：" + violations);
    }

    @Test
    void unnamedRequestParamFixtureIsRejectedButExplicitAndAggregateBindingsPass() {
        JavaClasses fixtures = new ClassFileImporter()
                .importPackages("com.wotb.web.archfixture.requestparam");
        List<String> violations = unnamedRequestParamViolations(fixtures);
        assertEquals(1, violations.size(), () -> String.join("; ", violations));
        assertTrue(violations.get(0).contains("#unnamed"),
                () -> "命中的必须是 unnamed 形态：" + violations);
    }
}
