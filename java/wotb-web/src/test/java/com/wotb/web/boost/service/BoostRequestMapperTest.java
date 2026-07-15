package com.wotb.web.boost.service;

import com.wotb.web.boost.dto.BoostRequestDto;
import com.wotb.web.boost.entity.BoostRequest;
import org.junit.jupiter.api.Test;

import java.time.OffsetDateTime;

import static org.assertj.core.api.Assertions.assertThat;

class BoostRequestMapperTest {

    private final BoostRequestMapper mapper = new BoostRequestMapper();

    @Test
    void shouldExposeRawEnumsAndMaskContact() {
        final BoostRequest request = new BoostRequest();
        request.setId(7L);
        request.setRegion("CN");
        request.setRequestType("COACHING");
        request.setContactType("QQ");
        request.setContactValue("123456789");
        request.setStatus("MATCHED");
        request.setAutoConfirmAt(OffsetDateTime.parse("2026-07-17T12:00:00Z"));

        final BoostRequestDto result = mapper.toDto(request, true);

        assertThat(result.region()).isEqualTo("CN");
        assertThat(result.requestType()).isEqualTo("COACHING");
        assertThat(result.status()).isEqualTo("MATCHED");
        assertThat(result.contactValueMasked()).isEqualTo("123****789");
        assertThat(result.assigned()).isTrue();
        assertThat(result.autoConfirmAt()).isEqualTo(request.getAutoConfirmAt());
    }

    @Test
    void shouldHandleShortAndMissingContacts() {
        assertThat(BoostRequestMapper.maskContact(null)).isNull();
        assertThat(BoostRequestMapper.maskContact("12")).isEqualTo("***");
        assertThat(BoostRequestMapper.maskContact("12345")).isEqualTo("1***5");
    }
}
