# 公告图片 COS 运维

> Canonical language: Chinese; English translation pending.

新闻归档使用私有COS对象、独立新闻前缀及专用运行时身份；业务API代理图片读取。产品生命周期见[游戏公告](../features/game-announcements.md)。

## 配置

在`tx-production` environment配置以下项：

| 名称 | 类型 | 说明 |
|---|---|---|
| NEWS_COS_BUCKET | Variable | 私有、未启用版本控制的桶，包含APPID后缀 |
| NEWS_COS_REGION | Variable | 桶区域 |
| NEWS_COS_PREFIX | Variable | 默认`news/images/`，与联赛封面和模型资产隔离 |
| NEWS_COS_SECRET_ID | Secret | 专用身份，限新闻前缀 |
| NEWS_COS_SECRET_KEY | Secret | 专用身份密钥 |

链路为`business-api.yml`运行时env → SSH envs → `business-api.compose.yml` → `application.yml:wotb.news.cos`。不得写入镜像、源码、日志或持久`.env`。权限只需新闻前缀的PutObject/GetObject/DeleteObject，不需要ListBucket或管理桶权限。没有配置时应用仍可启动，零图归档仍可发布，带图准备明确失败并可在配置后重试。

禁止复用模型资产发布者的整桶密钥；不要给整个新闻前缀设置到期删除。若选择开启版本控制的桶，必须另行落实旧版本回收；普通DeleteObject只生成删除标记不能证明物理数据已删除。本实现默认未启用版本控制的专用存储策略。

## 安全与生命周期

对象按UUID保存；首版不跨归档去重。PUT前先提交持久预约；随后锁住图片记录，检查任务token/状态再执行有总截止时间的上传。清理使用相同图片锁，避免暂停的旧上传在GC后重新创建孤儿。图片下载不持归档行锁；事务结束才进行公开读图网络请求。

只公开完整已发布归档引用的图片；管理预览需Bearer。撤下保留引用，因此不触发回收。永久删除解除引用并记录最后解除时间；小时任务回收超过24小时且无引用的对象。DELETING拒绝新关联，COS失败保留元数据，下一轮继续；成功或确认404后才删元数据。任务不遍历桶、不删除直播/模型前缀。

新闻准备租约为5分钟，最多2条并发；过期任务变为失败等待管理员重试，已备份READY图片复用。重试只使用冻结正文和图片来源，不重抓最新文章替换审核结果。

保持`logging.level.com.qcloud.cos=OFF`。SDK异常可能包含签名，排障只读取安全错误码、诊断ID和对象状态，不打印完整SDK请求。`NEWS_STORAGE_UNAVAILABLE`表示配置不可用；`NEWS_STORAGE_ERROR`表示对象请求/完整性失败；`NEWS_IMAGE_INVALID`表示图片不符合限制。

## 验收、备份与回滚

PR验证不读取生产凭据。上线后使用有权限的测试身份验证带图归档、公开读取、撤下/恢复、删除后24h回收；单元测试mock成功不等于真实COS已就绪。先部署迁移/后端、Keycloak新闻角色和运行时配置，再发布消费端。此PR不创建桶、不赋予线上用户角色、不自动发布Android。

PostgreSQL备份包括归档/receipt/图片元数据，不包括COS对象；恢复必须同时保有相应对象。回滚旧应用镜像时保留新增表和对象，不删历史迁移、不清桶。恢复兼容镜像后重新检查失败准备与待回收记录。
