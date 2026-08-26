package com.wotb.web.replay.controller;

import com.wotb.web.replay.dto.ColumnDef;
import com.wotb.web.replay.dto.RatingV2Response;
import com.wotb.web.replay.dto.RatingV2Row;
import com.wotb.web.replay.service.RatingV2AdminService;
import org.junit.jupiter.api.Test;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;

import java.util.List;
import java.util.Map;

import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

class RatingV2AdminControllerContractTest {

    @Test
    void mapsTheAdminJobPathToTheDedicatedService() throws Exception {
        final RatingV2AdminService service = mock(RatingV2AdminService.class);
        when(service.analyzeReadyJob("ready-job")).thenReturn(new RatingV2Response(
                List.of(new RatingV2Row(Map.of("rating", 1234))), List.of(), List.of(),
                List.of(new ColumnDef("rating", true))));
        final MockMvc mvc = MockMvcBuilders.standaloneSetup(new RatingV2AdminController(service)).build();

        mvc.perform(post("/api/admin/rating-v2/processing-jobs/ready-job"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.rows[0].cells.rating").value(1234))
                .andExpect(jsonPath("$.columns[0].key").value("rating"));

        verify(service).analyzeReadyJob("ready-job");
    }
}
