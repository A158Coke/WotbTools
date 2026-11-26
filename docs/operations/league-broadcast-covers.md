# Business 私有图片存储运维

产品规则见 [联赛直播回放](../features/league-broadcasts.md)。本功能使用 Business API
转传图片和代理公开读取，不借用静态模型资产发布凭据，也不要求开放 COS 桶匿名访问。

## 腾讯 COS 配置与权限

在 GitHub repository-level Actions variables / secrets 配置以下项目：

| 名称 | 类型 | 用途 |
| --- | --- | --- |
| `BROADCAST_COS_BUCKET` | Variable | `BucketName-APPID` 格式的私有封面桶 |
| `BROADCAST_COS_REGION` | Variable | 桶所在区域，如 `ap-shanghai` |
| `BROADCAST_COS_PREFIX` | Variable，可空 | 默认 `league-broadcasts/covers/`，只属于本功能 |
| `CREATOR_AVATAR_COS_PREFIX` | Variable，可空 | UP 头像独立前缀，默认 `creator-avatars/`，不能与封面前缀相同 |
| `BROADCAST_COS_SECRET_ID` | Secret | 专用最小权限身份 |
| `BROADCAST_COS_SECRET_KEY` | Secret | 该身份的密钥 |

owner 链路是 `business-api.yml` runtime env → SSH 环境 →
`deploy/tx/business-api.compose.yml` → `wotb.broadcast.cos`。
UP 推荐头像复用同一 COS client、私有桶和凭据，独立使用 `wotb.creator.cos.prefix`。
凭据的 Put/Get/Delete 权限必须同时覆盖实际使用的两个前缀；头像和封面各自维护引用与回收记录，
不会跨前缀清理。配置相同前缀会关闭上传，避免不同业务互删资源。UP 头像行为见
[UP recommendations](../features/bilibili-creators.md)。UP头像只保留最长边256px的小图、不绑定上传者，
每天UTC+8 04:00清理未引用满24小时的记录；这里的联赛封面调度与原图规则保持原状。
secret 不进入源码、前端、镜像 build args 或主机持久 `.env`。
未配置时应用仍可启动、公开浏览和无封面 CRUD 正常，上传能力标记不可用。
配置缺失报 `BROADCAST_STORAGE_UNAVAILABLE`，COS 请求失败报可重试的 `BROADCAST_STORAGE_ERROR`。

使用专用私有、**未启用版本控制**的封面桶。应用凭据只需受控前缀的
`cos:PutObject`、`cos:GetObject`、`cos:DeleteObject`，不需要 ListBucket、DeleteBucket 或修改 ACL。
不使用资产发布者已有的整桶密钥，不自动创建桶、修改桶策略或配置生产 lifecycle。

开启版本控制的桶不在默认物理回收保证内：普通 DeleteObject 可能只写删除标记，旧版本仍占用空间。
若部署选择这种桶，必须另外落实非当前版本 lifecycle 或版本感知回收；不能把删除标记当作物理删除。
同样不要对整个专用前缀设置“到期全部删除”，仍被业务引用的封面需要长期保留。

## Business API 的 OSS 适配

`BUSINESS_IMAGE_PROVIDER` 取 `cos`（默认）或 `oss`。服务启动日志记录选中的 provider 与客户端配置状态。每个实例只构造选定实现。缺少 OSS 桶或凭据时，图片存储报告不可用。数据库台账、对象 key、调用方 URL 和宽限期沿用既有契约。

| GitHub Actions 配置 | 类型 | 用途 |
| --- | --- | --- |
| `BUSINESS_IMAGE_PROVIDER`、`BUSINESS_OSS_BUCKET`、`BUSINESS_OSS_REGION` | Variable | 选择 OSS，填写私有桶名和区域，例如 `cn-hangzhou`。客户端使用该区域的官方 HTTPS 公网 endpoint。 |
| `BUSINESS_OSS_ACCESS_KEY_ID`、`BUSINESS_OSS_ACCESS_KEY_SECRET` | Secret | Business 运行身份，仅授权两个业务前缀的 GetObject、PutObject（含私有 ACL）、DeleteObject。 |
| `BUSINESS_OSS_SECURITY_TOKEN` | Secret，可空 | 使用 STS 时与对应的 ID 和密钥一起注入。静态配置的临时令牌需在到期前轮换并重新部署。 |

两个 provider 使用相同的 `BROADCAST_COS_PREFIX` 与 `CREATOR_AVATAR_COS_PREFIX`，与迁移 manifest 保持一致。OSS 请求使用官方 Java SDK 的 V4 签名；连接数最多 8，连接和池等待各 5 秒，socket 读取 15 秒，单次网络操作总时限 30 秒。超时会中止底层 HTTP 请求。SDK 和传输层均关闭重试；结果不明的 PUT 由 PENDING 台账承接，清理任务对临时删除失败保留台账。

切流前，使用独立身份确认桶级 Block Public Access 持续开启，从每个 Business 实例所在网络验证私有对象可达，并按下文完成预复制、冻结、最终对账。停写状态下统一实例配置，核验联赛封面、UP 头像、视频推荐封面的 API 读取，再按计划恢复写入和清理。目标恢复写入后回切前须按当前数据库反向补齐并校验。

## 保存、失败与回收

每次上传使用新 UUID 对象 key，不做跨记录内容去重。PENDING 元数据先独立提交，才执行有总时限的 COS PUT；
上传过程不持有季赛行锁。回放 attach 在 season→cover 锁顺序中重新验证版本和归属。
保存失败保留旧回放／旧封面，PENDING 元数据为已上传但未关联的对象留下回收依据。

删除／替换首先在业务事务内解除引用。cover 元数据不随季赛级联丢失；默认 24 小时宽限，小时任务
锁定 cover 后重新检查无引用，再删 COS，成功或确认对象不存在才删元数据。失败保留待下次重试。
任务仅查询登记元数据，不遍历桶，不清理旧积分榜本地证据。

公开读取只允许仍有回放引用的 READY 封面，通过业务 API 返回经过验证的 MIME、nosniff 与 ETag。
引用与元数据在短只读事务中读取，随后释放数据库连接，再下载和解码图片，不对公开下载持写锁。
`spring.jpa.open-in-view=false` 避免在事务结束后仍由请求级持久化上下文保留连接；上传、关联和回收仍遵守原有写锁规则。
客户端不获取 COS 密钥或任意 key 代理能力。已有浏览器缓存可能在缓存有效期内继续显示旧图；
解除业务引用与源文件物理回收、客户端缓存消失不能混为同一时刻。

## 上线与回滚

先部署迁移和后端，再验收 Web／Android 页面。部署只读配置校验不能证明真实 COS 凭据有效，
由有权限的管理员在本功能中验证一次上传、公开读取、替换／删除及宽限后回收，核对日志中的错误码／诊断 ID，
不打印密钥、请求签名或完整 SDK 异常请求内容。COS SDK 在请求失败时可能记录带签名的请求头，
所以 `logging.level.com.qcloud.cos` 固定为 `OFF`；排障也不要临时开启该 SDK 日志。
应用仅记录安全错误码、诊断 ID 或回收失败类型。云端联调不得混入普通 CI 或无凭据单元测试。

回滚应用时保留新增表和待回收 cover 记录，禁止删除历史 migration 或通过清桶恢复。
旧镜像会忽略新表；恢复有此功能的镜像后，回收任务可继续处理积压。
密钥轮换只修改专用身份和 runtime secret，再按 Business API owner 流程部署，不影响静态资产发布者。

官方接口参考：[Java 上传](https://cloud.tencent.com/document/product/436/65935)、
[下载](https://cloud.tencent.com/document/product/436/65937)、
[删除](https://cloud.tencent.com/document/product/436/65939)。

## #810 业务图片预复制

离线工具从 Business PostgreSQL 的同一语句快照读取联赛封面、UP 头像和视频推荐封面，包括未引用的 READY 和 PENDING。它分页列举两端前缀，在独立 SQLite 文件保存原始台账、清单、逐项检查结果和写入归属。每次新快照使用新文件名，文件和备份放在仅迁移人员可访问的目录。Issue 只附命令输出的聚合数字。

### 准备迁移环境

在独立 Python 3.12 虚拟环境运行 `python -m pip install -r deploy/business-images/requirements.txt`。数据库连接使用 libpq 的 `PGSERVICE` 或 `PGHOST` 等参数及只读角色。两个迁移身份均使用短期凭据。

| 环境变量 | 范围 |
| --- | --- |
| `MIGRATION_COS_BUCKET`、`MIGRATION_COS_REGION`、`MIGRATION_COS_SECRET_ID`、`MIGRATION_COS_SECRET_KEY`、`MIGRATION_COS_TOKEN` | 源桶，仅列举和读取两个业务前缀 |
| `MIGRATION_OSS_BUCKET`、`MIGRATION_OSS_REGION`、`MIGRATION_OSS_KEY_ID`、`MIGRATION_OSS_KEY_SECRET`、`MIGRATION_OSS_TOKEN` | 目标桶，列举和读取两个前缀。`verify` 和 `copy` 需要 `oss:GetBucketPublicAccessBlock`，`copy` 还需查询桶 ACL、版本状态及向前缀创建私有对象 |
| `BROADCAST_COS_PREFIX`、`CREATOR_AVATAR_COS_PREFIX` | 与当前 Business 实例一致，缺省值分别为 `league-broadcasts/covers/`、`creator-avatars/` |

确认迁移主机能通过 HTTPS 访问两端。目标桶应专用于私有图片，先验证匿名 GET 被拒绝，并在整个复制窗口内保持 ACL、桶策略和版本状态稳定。OSS 的防覆盖头在版本控制启用或暂停时失效，工具在这两种情况下拒绝开始复制。[OSS PutObject 契约](https://www.alibabacloud.com/help/en/oss/developer-reference/putobject)

在目标桶级别启用并持续保留「阻止公共访问」（Block Public Access），覆盖预存对象 ACL 和桶策略中的公开授权。`verify` 和 `copy` 在开始、结束时读取该设置；条件创建遇到 409 时也会在复用对象前复查。设置关闭、缺失或无权读取时命令失败。迁移身份只需读取此设置。[OSS 阻止公共访问说明](https://www.alibabacloud.com/help/en/oss/user-guide/block-public-access)

### 运行与读数

```sh
python deploy/business-images/precopy.py snapshot /restricted/precopy.sqlite
python deploy/business-images/precopy.py verify /restricted/precopy.sqlite
python deploy/business-images/precopy.py copy /restricted/precopy.sqlite --limit 100
python deploy/business-images/precopy.py verify /restricted/precopy.sqlite
```

1. `snapshot` 仅读云端，完成台账和两端清单后返回 0。失败的快照不能用于复制，另选文件名重建。每个 manifest 同时由一个进程操作。
2. `verify` 逐行重新 GET 两端，与数据库长度、SHA-256 和内容类型核对，并检查图片文件头。`copy` 只处理尚待处理的行；目标已存在时重新核对内容。并发创建冲突后再次读取目标，内容不一致记为冲突。PENDING 保持原状态，未引用的 READY 没有年龄过滤。
3. `copy` 可重复分批执行；优先处理尝试次数较少的行。中断后复用原文件。写入结果未知时 `write_attempted=1`，只有确认条件创建成功才记录 `created_by_run=1`。超时后发现相同内容可以完成校验，清理时仍需独立证明归属。
4. `copy` 的 JSON 将快照清单与台账对照。`verify` 在逐行回读后重新分页列举两端前缀，`untracked_objects` 显示本次列举中无快照台账的数量，`new_since_snapshot` 标出其中快照列举后才出现的数量。对应明细保存在 `verify_inventory`，原始清单仍在 `inventory`。每次完整核验更新 `verify_inventory`。返回 0 需要所有台账行为 `verified` 或 `pending_absent`、对应清单无多余对象且隐私检查通过。
5. 对源端缺失的 READY 回查最新台账。若已被正常清理，在新快照中确认；仍有引用或仍可挂接时阻断切流。PENDING 两端都缺失可记作 `pending_absent`，继续保留源清理责任。源存在但台账已删除的对象保留在清单中调查。

### 最终对账与回滚

在线预复制期间，数据库、对象正文和分页列举各有读取时点。最终对账前，冻结所有 Business 实例的上传、挂接、替换、删除及清理，同时停掉能写两个前缀的其他迁移进程、人工操作与后台任务。排空在途操作并核查结果不明的 PUT 后，使用新 manifest 依次运行 `snapshot`、`copy`、`verify`。最终 `verify` 完成并切流前保持所有写入方冻结。以新快照识别已经撤销或清理的条目，目标残留结合原 manifest 的创建记录核对，交由 owner 处理。保留所有源清单和 PENDING 清理记录直至实际完成清理。

停止预复制只需停止工具，线上继续读取 COS。恢复 OSS 业务写入后的回切另需按当时的数据库冻结、反向补齐和逐项校验。本工具只实现 COS 到 OSS 方向。#801、Android/Agent 消费者证明、目标 Business adapter、三入口生产生命周期及 owner 退桶验收仍按 [#810 最终方案](https://github.com/A158Coke/WotbTools/issues/810#issuecomment-7197343642) 执行。

本地回归使用临时 PostgreSQL 和 loopback 对象服务。在上述虚拟环境额外安装测试依赖 `pgserver==0.1.4` 后运行 `python -m unittest discover -s deploy/business-images -v`。
