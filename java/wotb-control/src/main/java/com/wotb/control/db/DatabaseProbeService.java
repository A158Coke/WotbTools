package com.wotb.control.db;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Service;

/** Executes a minimal protected connectivity probe; no control/job table is created. */
@Service
public class DatabaseProbeService {
    private static final Logger LOGGER = LoggerFactory.getLogger(DatabaseProbeService.class);

    private final JdbcClient jdbcClient;

    public DatabaseProbeService(final JdbcClient jdbcClient) {
        this.jdbcClient = jdbcClient;
    }

    public boolean isAvailable() {
        try {
            return Integer.valueOf(1).equals(jdbcClient.sql("SELECT 1")
                    .query(Integer.class)
                    .single());
        } catch (final RuntimeException e) {
            // Do not expose JDBC URL, credentials or driver details in the response/log message.
            LOGGER.warn("Control API database probe failed");
            return false;
        }
    }
}
