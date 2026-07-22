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

   编辑 `.env`：将 `DATABASE_URL` 改为本机 PostgreSQL 连接字符串，并将 `SESSION_SECRET` 换成一段足够长的随机字符串。

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
- `project_access` 决定用户可以看见和进入哪些项目。
- 注册用户在本机开发环境会自动获得“智能穿戴监测系统”的访问权限。
- 装备、锚点、布局和方案均按“用户 + 项目”写入 PostgreSQL。
- 首次进入穿戴项目时，会询问是否导入该浏览器旧的本地数据；导入只执行一次。

## 切换云端 PostgreSQL

部署环境只需设置云数据库提供的 `DATABASE_URL`、强随机 `SESSION_SECRET` 和 `NODE_ENV=production`，执行一次 `npm run db:migrate` 后启动同一服务即可。前端和应用代码不需要修改。

原有的纯静态 Cloudflare Pages 部署不能承载账号、会话和 PostgreSQL API；正式发布应使用支持 Node.js 服务和数据库连接的运行环境。

## 测试

```bash
npm test
```
