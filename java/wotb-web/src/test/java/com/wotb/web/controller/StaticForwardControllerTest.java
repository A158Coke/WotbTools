package com.wotb.web.controller;

import org.junit.jupiter.api.Test;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;

import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.forwardedUrl;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

class StaticForwardControllerTest {

    private final MockMvc mvc = MockMvcBuilders.standaloneSetup(new StaticForwardController()).build();

    @Test
    void extendedPageAliasForwardsToStaticHtml() throws Exception {
        mvc.perform(get("/extended"))
                .andExpect(status().isOk())
                .andExpect(forwardedUrl("/extended.html"));
    }
}
