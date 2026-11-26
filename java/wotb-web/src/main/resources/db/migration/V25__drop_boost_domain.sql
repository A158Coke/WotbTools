-- V25: 删除已退役的 Boost 产品域（forward-only；不改历史 V3/V4/V8/V9/V11/V14）。
--
-- 对象清单来自实际 schema，不是猜测：
--   boost_request              (V3 建表, V4 改列, V11 加列与索引)
--   booster_profile            (V3 建表, V8 加列与索引, V14 加约束与唯一索引)
--   boost_request_assignment   (V3 建表, FK -> boost_request / booster_profile)
--   booster_application        (V9 建表, FK -> booster_profile)
-- 索引 / 约束 / 序列均从属于上述表，随表一并删除。
--
-- 顺序：先删引用方（assignment / application），再删被引用表（boost_request / booster_profile）。
-- 保留 user_notification（V10）：站内通知子系统仍由 user 域提供，其历史行不可删除。
drop table if exists boost_request_assignment;
drop table if exists booster_application;
drop table if exists boost_request;
drop table if exists booster_profile;
