package com.wotb.web.architecture;

import com.tngtech.archunit.core.domain.JavaClasses;
import com.tngtech.archunit.core.importer.ClassFileImporter;
import com.wotb.web.hundred.archfixture.HofDtoDependencyFixture;
import com.wotb.web.hundred.archfixture.UserProfilesCollaborationFixture;
import com.wotb.web.hof.dto.BulkDeleteResultDto;
import com.wotb.web.user.api.UserProfiles;
import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.assertDoesNotThrow;
import static org.junit.jupiter.api.Assertions.assertThrows;

/**
 * 架构规则 mutation/negative 测试：直接导入夹具包并执行真实 {@code ArchRule}，
 * 证明规则确实会拒绝违规结构（防止规则空转 / 语义反转回归）。
 */
class WebArchitectureRuleMutationTest {

    private static JavaClasses importFixtures(final String... packages) {
        return new ClassFileImporter().importPackages(packages);
    }

    @Test
    void sameDomainRepositoryDependencyIsAllowed() {
        final JavaClasses classes = importFixtures("com.wotb.web.archfixture.same");
        assertDoesNotThrow(() -> WebArchitectureTest.SERVICES_USE_ONLY_OWN_DOMAIN_REPOSITORIES.check(classes));
    }

    @Test
    void crossDomainRepositoryDependencyIsRejected() {
        final JavaClasses classes = importFixtures(
                "com.wotb.web.archfixture.cross", "com.wotb.web.archfixture.other");
        assertThrows(AssertionError.class,
                () -> WebArchitectureTest.SERVICES_USE_ONLY_OWN_DOMAIN_REPOSITORIES.check(classes));
    }

    @Test
    void crossDomainNonRepositoryDependencyIsAllowed() {
        final JavaClasses classes = importFixtures(
                "com.wotb.web.archfixture.plain", "com.wotb.web.archfixture.other");
        assertDoesNotThrow(() -> WebArchitectureTest.SERVICES_USE_ONLY_OWN_DOMAIN_REPOSITORIES.check(classes));
    }

    @Test
    void hundredOrMark3DependencyOnHofDtoIsRejected() {
        final JavaClasses classes = new ClassFileImporter().importClasses(
                HofDtoDependencyFixture.class, BulkDeleteResultDto.class);
        assertThrows(AssertionError.class,
                () -> WebArchitectureTest.HUNDRED_AND_MARK3_MUST_NOT_DEPEND_ON_HOF_DTOS.check(classes));
    }

    @Test
    void explicitUserApiBoundaryRemainsAllowed() {
        final JavaClasses classes = new ClassFileImporter().importClasses(
                UserProfilesCollaborationFixture.class, UserProfiles.class);
        assertDoesNotThrow(
                () -> WebArchitectureTest.HUNDRED_AND_MARK3_MUST_NOT_DEPEND_ON_HOF_DTOS.check(classes));
    }


    @Test
    void autowiredFieldInjectionIsRejected() {
        final JavaClasses classes = importFixtures("com.wotb.web.archfixture.inject.autowired");
        assertThrows(AssertionError.class, () -> WebArchitectureTest.NO_FIELD_INJECTION.check(classes));
    }

    @Test
    void valueFieldInjectionIsRejected() {
        final JavaClasses classes = importFixtures("com.wotb.web.archfixture.inject.value");
        assertThrows(AssertionError.class, () -> WebArchitectureTest.NO_FIELD_INJECTION.check(classes));
    }

    @Test
    void constructorInjectionIsAllowed() {
        final JavaClasses classes = importFixtures("com.wotb.web.archfixture.inject.constructor");
        assertDoesNotThrow(() -> WebArchitectureTest.NO_FIELD_INJECTION.check(classes));
    }
}
