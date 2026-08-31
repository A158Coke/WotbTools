package com.wotb.control.db;

import org.junit.jupiter.api.Test;
import org.springframework.jdbc.core.simple.JdbcClient;

import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

class DatabaseProbeServiceTest {
    private final JdbcClient jdbcClient = mock(JdbcClient.class);
    private final JdbcClient.StatementSpec statement = mock(JdbcClient.StatementSpec.class);
    private final JdbcClient.MappedQuerySpec<Integer> query = mock(JdbcClient.MappedQuerySpec.class);
    private final DatabaseProbeService service = new DatabaseProbeService(jdbcClient);

    @Test
    void executesOnlySelectOneForHealthyProbe() {
        when(jdbcClient.sql("SELECT 1")).thenReturn(statement);
        when(statement.query(Integer.class)).thenReturn(query);
        when(query.single()).thenReturn(1);

        assertTrue(service.isAvailable());
        verify(jdbcClient).sql("SELECT 1");
    }

    @Test
    void convertsJdbcFailureToUnavailableWithoutLeakingException() {
        when(jdbcClient.sql("SELECT 1")).thenThrow(new IllegalStateException("private jdbc details"));

        assertFalse(service.isAvailable());
    }
}
