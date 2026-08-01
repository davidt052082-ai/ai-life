# 可视化运营控制台与第一方统计设计

## 背景

现有后台已经具备管理员、用户、分组与项目权限管理能力，但没有网站访问、注册转化或项目使用的运营数据。系统需要在不依赖第三方统计平台的前提下，采集第一方访问和业务事件，并在管理员后台提供可视化运营控制台。

## 目标

1. 采集网站访问、注册、项目进入和关键业务动作，形成网站到项目使用的完整转化路径。
2. 将数据保存在当前 PostgreSQL，不向外部统计平台传输数据。
3. 为游客分配匿名浏览器标识，登录后关联账号 ID；不记录密码、Cookie、完整 IP、表单原文或任意敏感内容。
4. 提供管理员专用的 `/admin/analytics` 页面，包含概览、流量、转化和事件四个视图。
5. 原始事件保留 180 天，日汇总数据长期保留。

## 非目标

1. 不接入 Google Analytics、Matomo 或广告平台回传。
2. 不采集会话 Cookie、密码、支付信息、身份证件、聊天内容或任意输入框原文。
3. 不实现用户画像、自动营销、广告归因、多触点归因或跨站追踪。
4. 不在本阶段提供 CSV 导出、定制报表、实时 WebSocket 推送或 BI 编辑器。

## 数据模型

### 原始事件

新增 `analytics_events`：

| 列 | 说明 |
| --- | --- |
| `id` | UUID 主键。 |
| `occurred_at` | 服务端接收时间。 |
| `event_date` | 按服务端时区截取的日期，用于日汇总和保留清理。 |
| `visitor_id` | 浏览器生成并存于 `localStorage` 的匿名 UUID。 |
| `session_id` | 每个标签页会话生成的匿名 UUID，存于 `sessionStorage`。 |
| `user_id` | 已登录时由服务端从会话解析的用户 UUID；游客为空。 |
| `event_type` | 受限事件类型。 |
| `page_path` | 当前站内路径，不保存任意查询参数。 |
| `project_code` | 关联项目时填写项目代码。 |
| `referrer_host` | 来源 URL 的主机名；站内来源和无来源分别规范化。 |
| `utm_source`、`utm_medium`、`utm_campaign`、`utm_term`、`utm_content` | 仅保存允许的 UTM 参数，单项截断至 120 字符。 |
| `device_type`、`browser_name`、`os_name`、`language`、`screen_width`、`screen_height` | 由浏览器上报的标准技术字段，经服务端长度和枚举校验。 |
| `ip_hash` | 使用环境变量盐值计算的不可逆 SHA-256 哈希；不保存原始 IP。 |
| `country_code` | 仅在启用可信反向代理配置时读取 `CF-IPCountry` 或 `X-Country-Code`，缺失时为空。 |
| `properties` | JSONB，仅保存各事件类型允许的业务字段。 |

`analytics_events` 按 `event_date`、`event_type`、`project_code`、`visitor_id` 和 `user_id` 建索引，用于 180 天清理及运营查询。

### 日汇总

新增 `analytics_daily_metrics`：

| 列 | 说明 |
| --- | --- |
| `metric_date` | 汇总日期。 |
| `metric_key` | 指标名称，如 `unique_visitors`、`page_views`、`signups`、`project_enters`、`active_users`、`key_actions`。 |
| `dimension_type` | `all`、`project`、`source`、`device`、`page`、`country`。 |
| `dimension_value` | 维度值；全站汇总使用 `all`。 |
| `metric_value` | 非负整数。 |
| `updated_at` | 最后计算时间。 |

联合主键为 `(metric_date, metric_key, dimension_type, dimension_value)`。每次读取运营概览或每日维护任务会重算最近 7 天，保证延迟到达的事件也可进入汇总。

## 事件与采集

### 标准事件

| 事件 | 触发位置 | 允许属性 |
| --- | --- | --- |
| `page_view` | 每个页面首次加载 | `title`。 |
| `sign_up` | 注册成功 | 无。 |
| `login` | 登录成功 | 无。 |
| `project_enter` | 用户成功进入项目 | `projectCode`。 |
| `wearable_equipment_add` | 智能穿戴新增装备成功 | `sourceType`。 |
| `wearable_scheme_save` | 智能穿戴保存方案成功 | 无。 |
| `study_plan_create` | 学习计划创建成功 | 无。 |
| `admin_group_create` | 管理员新建普通分组成功 | 无。 |
| `admin_membership_change` | 管理员加入或移出分组成员成功 | `operation`。 |
| `admin_project_access_change` | 管理员开通或取消分组项目权限成功 | `operation`。 |

事件类型和属性由服务端白名单校验；未列出的字段会被丢弃。业务 API 在成功写入后直接调用服务端记录函数，避免依赖浏览器脚本上报管理员和关键数据变更。

### 浏览器采集脚本

新增 `public/analytics-client.js` 并通过 `/analytics-client.js` 提供。脚本：

1. 创建并持久化匿名 `visitor_id`，创建当前标签页 `session_id`。
2. 仅在页面加载完成后发送 `page_view`；收集路径、UTM、来源主机、语言、屏幕尺寸和受限设备信息。
3. 暴露 `window.aiLifeAnalytics.track(eventType, properties)`，供现有前端在业务操作成功后上报标准事件。
4. 使用 `navigator.sendBeacon`，不可用时使用 `fetch(..., { keepalive: true })`；上报失败不阻塞页面功能。

匿名 ID 和会话 ID 均为随机 UUID，不使用广告标识或跨站追踪。页面路径不包括查询参数，UTM 从查询参数中单独提取。

### 上报 API 与安全

新增 `POST /api/analytics/events`，允许游客和登录用户调用。请求体限制为 8 KB，只接受 `visitorId`、`sessionId`、`eventType`、`pagePath`、允许的技术字段和 `properties`。

服务端：

1. 使用会话 Cookie 可用时关联 `user_id`，但不要求登录。
2. 使用请求 IP 加 `ANALYTICS_IP_SALT` 计算哈希；未配置盐值时不写入 `ip_hash`。仅在 `TRUST_PROXY=true` 时读取国家/地区代理头；其他部署环境将该字段留空。
3. 规范化路径、来源主机、UTM 和 UA 字段；拒绝跨站页面 URL、未知事件和过长字段。
4. 对 `ip_hash + visitor_id` 实施进程内滑动窗口限流：每分钟最多 60 个事件。超过时返回 `204` 且不写库，避免放大攻击反馈。
5. 不接受 `userId`、`countryCode`、原始 IP 或任意自定义属性，避免客户端伪造身份或采集敏感信息。

## 汇总与保留

新增运营仓储的两个维护方法：

1. `refreshDailyMetrics({ from, to })`：从原始事件重算指定日期范围的全站和维度指标，再用 UPSERT 写入 `analytics_daily_metrics`。
2. `purgeExpiredEvents()`：删除 `event_date < current_date - interval '180 days'` 的原始事件。

服务启动后会进行一次维护；之后每 24 小时执行一次。维护失败只记录服务端错误，不阻塞访问、登录或业务操作。

指标口径：

- 独立访客：按 `visitor_id` 每日去重。
- 页面浏览：`page_view` 总数。
- 新增注册：`sign_up` 总数。
- 项目进入：`project_enter` 总数。
- 活跃用户：按当日有任一 `project_enter` 或关键动作的 `user_id` 去重；游客不计入该指标。
- 关键动作：`wearable_equipment_add`、`wearable_scheme_save`、`study_plan_create` 之和。
- 漏斗：同一日期范围内，按唯一访客统计 `page_view`，按唯一 `visitor_id` 或 `user_id` 统计后续注册、项目进入和关键动作；后续阶段转化率以前一阶段数量为分母。

## 管理员 API

所有运营查询 API 位于 `/api/admin/analytics`，依次执行 `requireUser`、`requireAdmin`。日期范围只接受 ISO 日期，最大 90 天；默认最近 7 天。

| 路径 | 行为 |
| --- | --- |
| `GET /summary?from&to` | 返回 KPI、日趋势、项目使用和最新关键事件。 |
| `GET /breakdown?from&to&dimension=source|device|page|project|country` | 返回指定维度前 20 名与指标。 |
| `GET /funnel?from&to` | 返回访问、注册、项目进入和关键动作漏斗。 |
| `GET /events?from&to&type=&projectCode=&cursor=` | 返回最近原始事件的分页列表；事件属性只返回允许字段。 |

无管理员权限返回现有 `403 ADMIN_REQUIRED`；未配置管理员返回 `503 ADMIN_NOT_CONFIGURED`；无效日期、维度和筛选参数返回 `400 INVALID_ANALYTICS_QUERY`。

## 管理页面

新增 `analytics.html`，路由为 `GET /admin/analytics`。现有 `admin.html` 侧栏增加“运营控制台”入口。

页面包含：

1. 概览：日期范围、独立访客、新增注册、项目进入、活跃用户、关键动作，访问/注册/活跃趋势，项目使用，关键事件和转化漏斗。
2. 流量：来源、设备、页面、国家/地区排行，均按所选日期范围查询。
3. 转化：全站漏斗和按项目的关键动作占比。
4. 事件：按事件类型和项目筛选的最近事件列表；不显示原始 IP 或敏感内容。

图表采用原生 SVG 与 CSS 实现，不新增前端图表依赖。页面延续现有深色青橙后台视觉语言，并在移动端将双列图表改为单列。

## 服务端模块

1. 新增 `src/analytics/normalizeEvent.js`：事件白名单、字段规范化、UTM/来源/UA 解析、IP 哈希。
2. 新增 `src/analytics/rateLimiter.js`：进程内滑动窗口限流。
3. 新增 `src/repositories/analyticsRepository.js`：原始事件、日汇总、查询、维护和服务端业务事件写入。
4. 新增 `src/routes/analyticsRoutes.js`：公开上报路由。
5. 新增 `src/routes/adminAnalyticsRoutes.js`：管理员查询路由。
6. 扩展 `server.js`：构建仓储、挂载路由、提供采集脚本和启动/每日维护。
7. 在认证、项目、智能穿戴、学习计划和管理路由中注入可选事件记录器；统计失败不能影响原业务响应。

## 验收与测试

1. 游客首次打开首页会记录一次匿名 `page_view`；刷新后保持相同访客 ID、生成新的标签页会话 ID。
2. 登录后上报事件由服务端关联正确用户，客户端伪造 `userId` 无效。
3. 未知事件、超长字段、完整外部 URL、未知属性和限流超额事件不会写入数据库。
4. 管理员可看到运营概览、流量维度、转化漏斗和筛选后的最近事件；普通用户访问运营 API 返回 403。
5. 概览的 KPI 与原始事件计算一致；同一访客的多次页面浏览只计一次独立访客。
6. 原始事件超过 180 天会删除，日汇总仍可查询。
7. 智能穿戴和学习计划关键动作成功后会写入对应业务事件；记录失败不影响原操作。
8. 现有认证、分组授权、游客模式、项目页面和业务数据测试继续通过。
