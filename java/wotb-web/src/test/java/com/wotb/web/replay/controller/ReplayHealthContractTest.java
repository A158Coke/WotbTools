package com.wotb.web.replay.controller;

import org.junit.jupiter.api.Test;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

class ReplayHealthContractTest {
    @Test void healthRetainsProbeFieldsAndAdvertisesCreatorReadiness() throws Exception {
        MockMvcBuilders.standaloneSetup(new ReplayController()).build().perform(get("/api/health"))
                .andExpect(status().isOk()).andExpect(jsonPath("$.status").value("ok"))
                .andExpect(jsonPath("$.tanks").isNumber())
                .andExpect(jsonPath("$.capabilities[0]").value("creators-v1"))
                .andExpect(jsonPath("$.capabilities[1]").value("creators-content-visibility-v1"));
    }
}
