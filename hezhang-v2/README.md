# 合账 v2.0

紫色、手机优先的团队记账系统。记账页采用紧凑双列布局：物品、金额、报账成员、分类、日期、凭证和保存按钮在常见手机屏幕上尽量一屏完成；备注和凭证收在可展开区域。

这是一个可运行的 Node.js + PostgreSQL 应用，不包含任何演示账号、演示账目或种子数据。数据库迁移只增加结构，不清空、覆盖或修改已有业务记录。

## 已实现

- 账号登录；首次且仅首次使用 `BOOTSTRAP_TOKEN` 建立管理员。
- 管理员创建、停用、恢复成员账号；`admin`、`member`、`auditor` 三种权限。
- 统一报销、AA 分摊（以“分”计算，余数按成员顺序分配）、日期/分类/备注、图片凭证（JPEG、PNG、WebP、HEIC）。
- 团队账目流水、日期筛选、图片查看、CSV 导出、分类统计。
- 评论与异议；异议会把账目标为待处理，管理员/审计员可解决。
- 关联冲红：只能针对原账申请，保留原账和申请记录；管理员/审计员审批时在事务内锁定原账并检查累计已批准金额。因此不会把原账直接改写或删除。
- PostgreSQL 迁移、Docker Compose 持久卷、健康检查、最小化单元测试。

## 尚未实现 / 使用前须知

- 没有短信/邮件找回密码、SSO、双因素认证、邀请邮件或密码修改界面。
- 凭证存于 Docker 卷/应用本地 `uploads/`，**未**接入 S3、病毒扫描、OCR、缩略图或跨机高可用存储。
- 未实现报销付款、AA 实际转账、结算单、预算、通知推送、审批流自定义、多团队隔离、审计日志界面及完整端到端测试。
- 尚未提供 HTTPS 反向代理、自动备份、监控告警；生产部署前应配置 HTTPS、备份 PostgreSQL 与凭证卷，并更换强随机密钥。
- 这不是会计/税务软件。冲红的财务归属、跨期调整与结算规则应由团队的财务制度确定。

## 最快启动（Docker）

1. 复制环境变量模板：`cp .env.example .env`。
2. 在 `.env` 中设置三个强随机值：`POSTGRES_PASSWORD`、`JWT_SECRET`（至少 32 个随机字符）和一次性的 `BOOTSTRAP_TOKEN`。`DATABASE_URL` 在 Compose 中不使用。
3. 启动：`docker compose up -d --build`。
4. 打开 `http://localhost:3000`，选择“首次初始化”，输入管理员姓名、邮箱、密码和 `BOOTSTRAP_TOKEN`。初始化成功后请从部署环境中移除或更换该令牌。

数据保存在 `postgres_data` 与 `vouchers` 两个 Docker 卷。不要执行会删除卷的 Compose 命令，除非确定要销毁数据。

## 本地启动

要求 Node.js 20+ 与 PostgreSQL 16+：

```sh
cp .env.example .env
npm install
npm start
```

服务会在启动时执行尚未应用的 `migrations/*.sql`。也可单独运行 `npm run migrate`。凭证写入 `uploads/`，应将其纳入备份；它已被 Git 忽略。

## 验证

```sh
npm test
curl http://localhost:3000/api/health
```

建议验收路径：初始化管理员 → 创建两名成员 → 新增统一报销与 AA 账目（包含图片）→ 发布异议并解决 → 申请部分冲红 → 用另一管理员/审计员批准 → 检查流水、统计、CSV 中原账仍存在且有效金额减少。

## 数据与安全边界

- API 使用签名有效期 12 小时的 JWT；所有需要登录的接口都会验证令牌。
- 密码使用 bcrypt（cost 12）散列，金额只用整数分保存，上传数量限制为 8 张。
- 迁移表会记录已执行文件；数据库约束和外键阻止无效关联，审批采用数据库事务和行锁。
- 生产环境请将 `JWT_SECRET` 与 `BOOTSTRAP_TOKEN` 放入受管密钥系统，限制数据库端口，并定期备份数据库和凭证卷。

## 目录

```text
src/server.js       Express API、授权、冲红审批及文件凭证
src/migrate.js      幂等迁移执行器
migrations/         PostgreSQL 数据模型
public/              手机优先前端
test/                可执行的金额/AA 规则测试
docker-compose.yml   应用与 PostgreSQL 的本地/服务器部署
```
