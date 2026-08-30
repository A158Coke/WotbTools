package com.wotb.web.config;

import com.wotb.web.util.apierror.ApiErrorFactory;
import com.wotb.web.util.apierror.ApiErrorWriter;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import tools.jackson.databind.json.JsonMapper;

/** Minimal canonical error infrastructure for isolated Security MockMvc tests. */
@Configuration
public class ApiErrorTestConfig {

    @Bean
    ApiErrorFactory apiErrorFactory() {
        return new ApiErrorFactory();
    }

    @Bean
    ApiErrorWriter apiErrorWriter() {
        return new ApiErrorWriter(JsonMapper.builder().findAndAddModules().build());
    }
}
