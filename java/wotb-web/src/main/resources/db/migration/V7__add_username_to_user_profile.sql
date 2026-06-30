-- 给 user_profile 添加 username 字段
-- username = Keycloak preferred_username（唯一带 hash），不可修改
ALTER TABLE public.user_profile
    ADD COLUMN username VARCHAR(128) NOT NULL DEFAULT '';
