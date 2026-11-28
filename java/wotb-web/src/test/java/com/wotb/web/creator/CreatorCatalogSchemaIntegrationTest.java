package com.wotb.web.creator;

import java.util.List;
import org.flywaydb.core.Flyway;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.datasource.DriverManagerDataSource;
import org.springframework.test.annotation.DirtiesContext;
import org.springframework.transaction.IllegalTransactionStateException;
import org.springframework.transaction.support.TransactionTemplate;
import org.testcontainers.junit.jupiter.Testcontainers;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

@Testcontainers(disabledWithoutDocker = true)
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.MOCK)
@DirtiesContext(classMode = DirtiesContext.ClassMode.AFTER_CLASS)
class CreatorCatalogSchemaIntegrationTest extends CreatorIntegrationTestSupport {

    @Test void catalogLockRequiresAnExistingTransaction() {
        assertThrows(IllegalTransactionStateException.class, creators::lockCatalog);
    }

    @ParameterizedTest
    @ValueSource(booleans = {false, true})
    void catalogLockIsExclusiveAcrossConnectionsAndReleasedAtTransactionEnd(final boolean rollback) {
        final JdbcTemplate observer = new JdbcTemplate(new DriverManagerDataSource(
                POSTGRES.getJdbcUrl(), POSTGRES.getUsername(), POSTGRES.getPassword()));
        new TransactionTemplate(transactions).executeWithoutResult(tx -> {
            creators.lockCatalog();
            assertFalse(observer.queryForObject("select pg_try_advisory_xact_lock(1464816706, 1)", Boolean.class));
            jdbc.update("insert into creator_category(name) values ('Transaction probe')");
            if (rollback) { tx.setRollbackOnly(); }
        });
        assertTrue(observer.queryForObject("select pg_try_advisory_xact_lock(1464816706, 1)", Boolean.class));
        assertEquals(rollback ? 0 : 1, jdbc.queryForObject(
                "select count(*) from creator_category where name='Transaction probe'", Integer.class));
    }

    @Test void v35UpgradeDropsOnlyTheLockTableAndPreservesDirectoryData() {
        jdbc.execute("create database creator_lock_upgrade");
        final String url = POSTGRES.getJdbcUrl().replace("/wotb", "/creator_lock_upgrade");
        final JdbcTemplate upgrade = new JdbcTemplate(new DriverManagerDataSource(
                url, POSTGRES.getUsername(), POSTGRES.getPassword()));
        try {
            Flyway.configure().dataSource(url, POSTGRES.getUsername(), POSTGRES.getPassword()).target("35").load().migrate();
            assertEquals(1, upgrade.queryForObject("select count(*) from creator_catalog_lock", Integer.class));
            upgrade.update("update creator_category set name='Custom category' where id=1");
            upgrade.update("insert into creator_avatar(id,object_key,status,content_type,size,hash,created_at) "
                    + "values ('11111111-1111-4111-8111-111111111111','creator-avatars/test','READY','image/png',1,?,now())", "a".repeat(64));
            upgrade.update("insert into creator(bilibili_uid,name,version,stars,level_id,avatar_id,created_at) "
                    + "values ('123','Preserved creator',7,4,1,'11111111-1111-4111-8111-111111111111',now())");
            upgrade.update("insert into creator_category_link(creator_id,category_id) values (1,1)");
            final String query = "select c.*, a.object_key, a.hash, cat.name as category_name, l.name as level_name "
                    + "from creator c join creator_avatar a on a.id=c.avatar_id "
                    + "join creator_category_link link on link.creator_id=c.id "
                    + "join creator_category cat on cat.id=link.category_id join creator_level l on l.id=c.level_id";
            final var before = upgrade.queryForMap(query);
            final Flyway flyway = Flyway.configure().dataSource(url, POSTGRES.getUsername(), POSTGRES.getPassword()).target("36").load();
            flyway.migrate(); flyway.validate();
            assertNull(upgrade.queryForObject("select to_regclass('creator_catalog_lock')::text", String.class));
            assertEquals(before, upgrade.queryForMap(query));
            assertEquals(6, upgrade.queryForObject("select count(*) from creator_category", Integer.class));
            assertEquals(4, upgrade.queryForObject("select count(*) from creator_level", Integer.class));
        } finally {
            jdbc.execute("drop database creator_lock_upgrade with (force)");
        }
    }

    @Test void schemaContainsOnlySiteDirectoryTablesAndEnforcesUidAndStarConstraints() {
        assertEquals(List.of("creator", "creator_avatar", "creator_category", "creator_category_link", "creator_level"),
                jdbc.queryForList("select tablename from pg_tables where schemaname='public' and tablename like 'creator%' order by tablename", String.class));
        assertFalse(service.recommendationMetadata("UP").imageUploadsAvailable());
        final Long id = jdbc.queryForObject(
                "insert into creator(bilibili_uid,name,created_at) values ('900001','Default',now()) returning id", Long.class);
        jdbc.update("insert into creator_category_link(creator_id,category_id) values (?,1)", id);
        assertEquals(3, jdbc.queryForObject("select stars from creator where id=?", Integer.class, id));
        assertEquals(0L, jdbc.queryForObject("select version from creator where id=?", Long.class, id));
        assertEquals(6, card(id).score());
        assertThrows(DataIntegrityViolationException.class,
                () -> jdbc.update("update creator set stars=0 where id=?", id));
        assertThrows(DataIntegrityViolationException.class,
                () -> jdbc.update("update creator set stars=6 where id=?", id));
        assertThrows(DataIntegrityViolationException.class,
                () -> jdbc.update("update creator set version=-1 where id=?", id));
        assertThrows(DataIntegrityViolationException.class,
                () -> jdbc.update("insert into creator(bilibili_uid,name,created_at) values ('900001','Duplicate',now())"));
        assertThrows(DataIntegrityViolationException.class,
                () -> jdbc.update("insert into creator(bilibili_uid,name,created_at) values ('00012','Unnormalized',now())"));
    }

    @Test void v36UpgradePreservesUpDataAndAddsOnlyTypedConstraints() {
        jdbc.execute("create database recommendation_upgrade");
        final String url = POSTGRES.getJdbcUrl().replace("/wotb", "/recommendation_upgrade");
        final JdbcTemplate upgrade = new JdbcTemplate(new DriverManagerDataSource(url, POSTGRES.getUsername(), POSTGRES.getPassword()));
        try {
            Flyway.configure().dataSource(url, POSTGRES.getUsername(), POSTGRES.getPassword()).target("36").load().migrate();
            upgrade.update("update creator_category set name='Customized category' where id=1");
            upgrade.update("insert into creator_avatar(id,object_key,status,content_type,size,hash,created_at) "
                    + "values ('11111111-1111-4111-8111-111111111111','creator-avatars/old','READY','image/png',1,?,now())", "a".repeat(64));
            upgrade.update("insert into creator(bilibili_uid,name,version,stars,level_id,avatar_id,created_at) "
                    + "values ('123','Preserved UP',7,4,1,'11111111-1111-4111-8111-111111111111',now())");
            upgrade.update("insert into creator_category_link(creator_id,category_id) values (1,1)");
            final String query = "select c.id,c.version,c.bilibili_uid,c.name,c.stars,c.level_id,c.avatar_id,c.created_at,"
                    + "a.object_key,a.hash,cat.name as category_name,l.name as level_name from creator c "
                    + "join creator_avatar a on a.id=c.avatar_id join creator_category_link link on link.creator_id=c.id "
                    + "join creator_category cat on cat.id=link.category_id join creator_level l on l.id=c.level_id";
            final var before = upgrade.queryForMap(query);
            final Flyway flyway = Flyway.configure().dataSource(url, POSTGRES.getUsername(), POSTGRES.getPassword()).load();
            flyway.migrate(); flyway.validate();
            assertEquals(before, upgrade.queryForMap(query));
            assertEquals("UP", upgrade.queryForObject("select type from creator", String.class));
            assertEquals(6, upgrade.queryForObject("select count(*) from creator_category where type='UP'", Integer.class));
            assertEquals(0, upgrade.queryForObject("select count(*) from creator_category where type='VIDEO'", Integer.class));
            assertEquals(4, upgrade.queryForObject("select count(*) from creator_level", Integer.class));
            assertNull(upgrade.queryForObject("select to_regclass('creator_catalog_lock')::text", String.class));
            assertEquals("50", flyway.info().current().getVersion().toString());
        } finally { jdbc.execute("drop database recommendation_upgrade with (force)"); }
    }
}
