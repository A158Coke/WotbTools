package com.wotb.web.boost.service;

import com.wotb.web.boost.entity.BoostRequest;
import com.wotb.web.boost.repository.BoostRequestAssignmentRepository;
import com.wotb.web.boost.repository.BoostRequestRepository;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.CsvSource;
import org.junit.jupiter.params.provider.NullAndEmptySource;
import org.junit.jupiter.params.provider.ValueSource;
import org.mockito.ArgumentCaptor;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;

@ExtendWith(MockitoExtension.class)
class BoostRequestServiceTest {

    @Mock
    BoostRequestRepository repository;

    @Mock
    BoostRequestAssignmentRepository assignmentRepository;

    @Mock
    BoostRequestMapper mapper;

    BoostRequestService service;

    @BeforeEach
    void setUp() {
        service = new BoostRequestService(repository, assignmentRepository, mapper);
    }

    @ParameterizedTest
    @CsvSource({
            "CN, CN",
            "ASIA, ASIA",
            "EU, EU",
            "NA, NA",
            "' asia ', ASIA"
    })
    void shouldCreateRequestInSupportedRegion(final String region, final String expectedRegion) {
        final var resp = service.create("user-1", region, "COACHING",
                "想找人指导", "QQ", "123456789",
                12345L, "Coke_158", null, null, null);

        assertThat(resp.status()).isEqualTo("NEW");
        final ArgumentCaptor<BoostRequest> requestCaptor = ArgumentCaptor.forClass(BoostRequest.class);
        verify(repository).save(requestCaptor.capture());
        assertThat(requestCaptor.getValue().getRegion()).isEqualTo(expectedRegion);
    }

    @ParameterizedTest
    @NullAndEmptySource
    @ValueSource(strings = " ")
    void shouldDefaultRegionToCnWhenBlank(final String region) {
        final var resp = service.create("user-1", region, "COACHING",
                "想找人指导", "QQ", "123456789",
                12345L, "Coke_158", null, null, null);

        assertThat(resp.status()).isEqualTo("NEW");
        final ArgumentCaptor<BoostRequest> requestCaptor = ArgumentCaptor.forClass(BoostRequest.class);
        verify(repository).save(requestCaptor.capture());
        assertThat(requestCaptor.getValue().getRegion()).isEqualTo("CN");
    }

    @Test
    void shouldRejectUnsupportedRegion() {
        assertThatThrownBy(() -> service.create("user-1", "RU", "COACHING",
                "想找人指导", "QQ", "123456789",
                12345L, "Coke_158", null, null, null))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessage("UNSUPPORTED_BOOST_REGION");
        verify(repository, never()).save(any());
    }

    @Test
    void shouldRejectInvalidRequestType() {
        assertThatThrownBy(() -> service.create("user-1", "CN", "INVALID_TYPE",
                "想找人指导", "QQ", "123456789",
                12345L, "Coke_158", null, null, null))
                .isInstanceOf(IllegalArgumentException.class);
    }

    @Test
    void shouldRejectInvalidContactType() {
        assertThatThrownBy(() -> service.create("user-1", "CN", "COACHING",
                "想找人指导", "EMAIL", "test@test.com",
                12345L, "Coke_158", null, null, null))
                .isInstanceOf(IllegalArgumentException.class);
    }

    @Test
    void shouldRejectEmptyTargetDescription() {
        assertThatThrownBy(() -> service.create("user-1", "CN", "COACHING",
                "", "QQ", "123456789",
                12345L, "Coke_158", null, null, null))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessage("TARGET_DESCRIPTION_REQUIRED");
    }

    @Test
    void shouldRejectSensitiveContent() {
        assertThatThrownBy(() -> service.create("user-1", "CN", "COACHING",
                "我的密码是123", "QQ", "123456789",
                12345L, "Coke_158", null, null, null))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessageContaining("SENSITIVE_INFO_NOT_ALLOWED");
    }

    @Test
    void shouldIgnorePassedStatusAndAdminNote() {
        final var resp = service.create("user-1", "CN", "COACHING",
                "想找人指导", "QQ", "123456789",
                12345L, "Coke_158", "APPROVED", null, "admin note");

        assertThat(resp.status()).isEqualTo("NEW");
    }
}
