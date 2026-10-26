package com.wotb.web.replay;

import com.wotb.web.replay.exception.ReplayBusyException;
import com.wotb.web.replay.service.ReplayCapacityLimiter;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.modulith.test.ApplicationModuleTest;
import org.springframework.test.context.TestPropertySource;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;

/** Replay module bootstrap outside judge for its public capacity contract. */
@ApplicationModuleTest(webEnvironment = SpringBootTest.WebEnvironment.NONE)
@TestPropertySource(properties = {
        "wotb.replay.max-concurrent-jobs=1",
        "spring.autoconfigure.exclude="
                + "org.springframework.boot.jdbc.autoconfigure.DataSourceAutoConfiguration,"
                + "org.springframework.boot.hibernate.autoconfigure.HibernateJpaAutoConfiguration,"
                + "org.springframework.boot.data.jpa.autoconfigure.DataJpaRepositoriesAutoConfiguration,"
                + "org.springframework.boot.flyway.autoconfigure.FlywayAutoConfiguration,"
                + "org.springframework.boot.security.oauth2.server.resource.autoconfigure.OAuth2ResourceServerAutoConfiguration"
})
class ReplayModuleIntegrationTest {

    @Test
    void bootsAndHonorsTheConfiguredCapacity(@Autowired final ReplayCapacityLimiter limiter) throws Exception {
        assertThrows(ReplayBusyException.class,
                () -> limiter.execute(() -> limiter.execute(() -> "nested")));
        assertEquals("released", limiter.execute(() -> "released"));
    }
}
