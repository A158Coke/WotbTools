package com.wotb.web.user;

import com.wotb.web.admin.service.AdminUserService;
import com.wotb.web.user.api.UserProfiles;
import com.wotb.web.user.controller.UserProfileController;
import com.wotb.web.user.repository.UserProfileRepository;
import com.wotb.web.user.service.UserProfileMapper;
import com.wotb.web.user.service.UserProfileService;
import org.junit.jupiter.api.Test;
import org.springframework.context.ApplicationContext;
import org.springframework.modulith.test.ApplicationModuleTest;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.test.context.TestPropertySource;
import org.springframework.test.context.bean.override.mockito.MockitoBean;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * User module bootstrap outside judge: Spring must be able to wire the module without scanning
 * consumer modules. Persistence is replaced by the module's repository port because database
 * behavior already has dedicated Testcontainers coverage.
 */
@ApplicationModuleTest(webEnvironment = SpringBootTest.WebEnvironment.NONE)
@TestPropertySource(properties = {
        "spring.autoconfigure.exclude="
                + "org.springframework.boot.jdbc.autoconfigure.DataSourceAutoConfiguration,"
                + "org.springframework.boot.hibernate.autoconfigure.HibernateJpaAutoConfiguration,"
                + "org.springframework.boot.data.jpa.autoconfigure.DataJpaRepositoriesAutoConfiguration,"
                + "org.springframework.boot.flyway.autoconfigure.FlywayAutoConfiguration,"
                + "org.springframework.boot.security.oauth2.server.resource.autoconfigure.OAuth2ResourceServerAutoConfiguration"
})
class UserModuleIntegrationTest {

    @MockitoBean
    UserProfileRepository repository;

    @Test
    void bootsTheUserModuleBehindItsPublicApi(final ApplicationContext context) {
        assertThat(context.getBean(UserProfiles.class)).isInstanceOf(UserProfileService.class);
        assertThat(context.getBean(UserProfileMapper.class)).isNotNull();
        assertThat(context.getBean(UserProfileController.class)).isNotNull();
        assertThat(context.getBeansOfType(AdminUserService.class)).isEmpty();
    }
}
