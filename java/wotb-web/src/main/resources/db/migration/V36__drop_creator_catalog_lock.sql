-- Stop all pre-V36 Business API instances before migration: old and new lock protocols cannot overlap.
DROP TABLE creator_catalog_lock;
