package com.wotb.web.boost.service;

import com.wotb.web.boost.entity.BoostRequest;
import com.wotb.web.boost.entity.BoostRequestAssignment;
import com.wotb.web.boost.entity.BoosterProfile;
import org.junit.jupiter.api.Test;

import static org.assertj.core.api.Assertions.assertThat;

class BoostAssignmentMapperTest {

    private final BoostAssignmentMapper mapper = new BoostAssignmentMapper();

    @Test
    void shouldExposeRequestRegionToBooster() {
        final BoostRequestAssignment assignment = new BoostRequestAssignment();
        assignment.setId(9L);
        assignment.setRequestId(10L);
        assignment.setStatus("ASSIGNED");

        final BoosterProfile booster = new BoosterProfile();
        booster.setId(7L);
        booster.setNickname("Booster");
        booster.setLevel("ELITE");
        booster.setAvailable(true);
        booster.setStatus("ACTIVE");

        final BoostRequest request = new BoostRequest();
        request.setRegion("EU");
        request.setRequestType("COACHING");

        assertThat(mapper.toDto(assignment, booster, request).region()).isEqualTo("EU");
    }
}
