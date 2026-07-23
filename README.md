# AI Life

AI Life 是一个带账号、项目授权和 PostgreSQL 存储的智能健康项目入口。当前首个项目是“智能穿戴监测系统”。用户登录后只能看到后台授予访问权限的项目。

## 本机运行

1. 安装并启动 PostgreSQL，然后创建开发用户和数据库：

   ```bash
   createuser ai_life --pwprompt
   createdb ai_life -O ai_life
   ```

2. 配置本机环境变量：

   ```bash
   cp .env.example .env
   ```

   编辑 `.env`：将 `DATABASE_URL` 改为本机 PostgreSQL 连接字符串，将 `SESSION_SECRET` 换成一段足够长的随机字符串，并设置 `ADMIN_EMAIL` 为首位后台管理员使用的邮箱。

3. 安装依赖、建立数据库结构并启动服务：

   ```bash
   npm install
   npm run db:migrate
   npm start
   ```

4. 打开 [http://localhost:5173/register](http://localhost:5173/register) 注册第一个账号。注册成功后会进入项目首页，再进入 `/projects/wearable` 使用智能穿戴监测系统。

## 数据与授权

- 游客可直接进入智能穿戴监测系统，装备、锚点、布局和方案仅保存于当前浏览器。
- 游客登录后可确认是否将当前浏览器数据一次性导入账号；取消导入不会删除游客本地数据。
- `projects` 保存后台维护的项目目录。
- `groups`、`user_groups` 和 `group_project_access` 决定用户可以看见和进入哪些项目。
- 所有注册用户会自动加入“默认分组”；该分组预置“智能穿戴监测系统”的访问权限。
- 装备、锚点、布局和方案均按“用户 + 项目”写入 PostgreSQL。
- 首次进入穿戴项目时，会询问是否导入该浏览器旧的本地数据；导入只执行一次。

## 后台管理

1. 在执行 `npm run db:migrate` 前，为 `.env` 设置 `ADMIN_EMAIL`，并使用该邮箱注册或登录账号。
2. 打开 [http://localhost:5173/admin](http://localhost:5173/admin) 进入后台。
3. 后台可创建普通分组、维护分组成员，并为分组开通或取消项目权限。用户加入多个分组时，项目权限取各分组授权的并集。
4. “默认分组”不能删除，成员不能移出；它必须始终保留“智能穿戴监测系统”权限，保证新注册用户可以立即使用该项目。
5. 非管理员无法访问后台页面或 `/api/admin/*` 接口；普通用户在项目首页仍只会看到已获授权项目。

## 切换云端 PostgreSQL

部署环境只需设置云数据库提供的 `DATABASE_URL`、强随机 `SESSION_SECRET`、`ADMIN_EMAIL` 和 `NODE_ENV=production`，执行一次 `npm run db:migrate` 后启动同一服务即可。前端和应用代码不需要修改。

原有的纯静态 Cloudflare Pages 部署不能承载账号、会话和 PostgreSQL API；正式发布应使用支持 Node.js 服务和数据库连接的运行环境。

## 线上更新

当前线上目录为腾讯云服务器的 `/opt/ai-life`，服务由 PM2 进程 `ai-life` 运行，Nginx 反向代理到本机 `127.0.0.1:5173`。

本地网页或后端代码更新后，先提交并推送到 GitHub `main`。服务器如果可以稳定访问 GitHub 仓库，可以在 `/opt/ai-life` 执行 `git pull origin main`。如果 `git pull` 因网络超时失败，可使用 GitHub tarball 更新：

```bash
cd /opt
curl -L --retry 3 https://codeload.github.com/davidt052082-ai/ai-life/tar.gz/main -o /tmp/ai-life-main.tar.gz
rm -rf /tmp/ai-life-main
mkdir -p /tmp/ai-life-main
tar -xzf /tmp/ai-life-main.tar.gz -C /tmp/ai-life-main --strip-components=1
rsync -a --delete --exclude ".env" /tmp/ai-life-main/ /opt/ai-life/
cd /opt/ai-life
npm ci
npm run db:migrate
pm2 restart ai-life --update-env
pm2 save
```

不要覆盖服务器上的 `/opt/ai-life/.env`，其中包含生产数据库和会话配置。

## 测试

```bash
npm test
```
