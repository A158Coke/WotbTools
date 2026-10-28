package com.wotb.web.creator.config;

import com.wotb.web.creator.service.CreatorAvatarService;
import com.wotb.web.util.apierror.ApiErrorCode;
import com.wotb.web.util.apierror.ApiException;
import io.micrometer.common.KeyValue;
import io.micrometer.observation.Observation;
import io.micrometer.observation.ObservationFilter;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

/** Stable WotbTools business taxonomy for the creator avatar upload observation. */
@Configuration
public class CreatorAvatarObservationConfiguration {
    private static final String ERROR_CODE = "error.code";
    private static final String NONE = "none";
    private static final String UNCLASSIFIED = "unclassified";

    @Bean
    public ObservationFilter creatorAvatarErrorCodeFilter() {
        return context -> {
            if (!CreatorAvatarService.OBSERVATION_NAME.equals(context.getName())) {
                return context;
            }
            context.addLowCardinalityKeyValue(KeyValue.of(ERROR_CODE, errorCode(context)));
            return context;
        };
    }

    private static String errorCode(final Observation.Context context) {
        final Throwable error = context.getError();
        if (error == null) {
            return NONE;
        }
        if (error instanceof ApiException apiException) {
            final ApiErrorCode code = apiException.errorCode();
            return code == null ? UNCLASSIFIED : code.name();
        }
        return UNCLASSIFIED;
    }
}
