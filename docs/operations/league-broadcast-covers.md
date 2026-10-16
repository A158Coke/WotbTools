# 联赛直播封面 COS 运维

产品规则见 [联赛直播回放](../features/league-broadcasts.md)。本功能使用 Business API
转传图片和代理公开读取，不借用静态模型资产发布凭据，也不要求开放 COS 桶匿名访问。

## 配置与权限

在 GitHub `tx-production` environment 配置以下变量／secret：

| 名称 | 类型 | 用途 |
| --- | --- | --- |
| `BROADCAST_COS_BUCKET` | Variable | `BucketName-APPID` 格式的私有封面桶 |
| `BROADCAST_COS_REGION` | Variable | 桶所在区域，如 `ap-shanghai` |
| `BROADCAST_COS_PREFIX` | Variable，可空 | 默认 `league-broadcasts/covers/`，只属于本功能 |
| `BROADCAST_COS_SECRET_ID` | Secret | 专用最小权限身份 |
| `BROADCAST_COS_SECRET_KEY` | Secret | 该身份的密钥 |

owner 链路是 `business-api.yml` runtime env → SSH 环境 →
`deploy/tx/business-api.compose.yml` → `wotb.broadcast.cos`。
secret 不进入源码、前端、镜像 build args 或主机持久 `.env`。
未配置时应用仍可启动、公开浏览和无封面 CRUD 正常，上传能力标记不可用。
配置缺失报 `BROADCAST_STORAGE_UNAVAILABLE`，COS 请求失败报可重试的 `BROADCAST_STORAGE_ERROR`。

使用专用私有、**未启用版本控制**的封面桶。应用凭据只需受控前缀的
`cos:PutObject`、`cos:GetObject`、`cos:DeleteObject`，不需要 ListBucket、DeleteBucket 或修改 ACL。
不使用资产发布者已有的整桶密钥，不自动创建桶、修改桶策略或配置生产 lifecycle。

开启版本控制的桶不在默认物理回收保证内：普通 DeleteObject 可能只写删除标记，旧版本仍占用空间。
若部署选择这种桶，必须另外落实非当前版本 lifecycle 或版本感知回收；不能把删除标记当作物理删除。
同样不要对整个专用前缀设置“到期全部删除”，仍被业务引用的封面需要长期保留。

## 保存、失败与回收

每次上传使用新 UUID 对象 key，不做跨记录内容去重。PENDING 元数据先独立提交，才执行有总时限的 COS PUT；
上传过程不持有季赛行锁。回放 attach 在 season→cover 锁顺序中重新验证版本和归属。
保存失败保留旧回放／旧封面，PENDING 元数据为已上传但未关联的对象留下回收依据。

删除／替换首先在业务事务内解除引用。cover 元数据不随季赛级联丢失；默认 24 小时宽限，小时任务
锁定 cover 后重新检查无引用，再删 COS，成功或确认对象不存在才删元数据。失败保留待下次重试。
任务仅查询登记元数据，不遍历桶，不清理旧积分榜本地证据。

公开读取只允许仍有回放引用的 READY 封面，通过业务 API 返回经过验证的 MIME、nosniff 与 ETag。
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
