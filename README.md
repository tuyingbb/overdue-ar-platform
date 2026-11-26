# 应收账款逾期跟进协作平台

制造业国企应收账款逾期的协同处置系统。按 Coze 产品/架构方案实现：8 节点流程引擎 + 5 项卡控 + 凭证驱动 + 8 角色 4 级组织隔离 + 超时升级 + 审计追踪。

- 后端：Node 24 + TypeScript + Express + `node:sqlite`（模块化单体）
- 前端：React 18 + Vite + Tailwind（PC 5 页面 + 移动端 H5）
- 单服务部署：后端托管前端 `dist` 与 API，启动自动初始化 SQLite 演示数据

## 部署到 Render（固定网址，不依赖本地）

本仓库含 `render.yaml`（Blueprint），可一键部署。

1. 把本仓库推送到你的 GitHub。
2. 打开一键部署链接（把 `<你的GitHub用户名>/<仓库名>` 替换为实际值）：
   `https://render.com/deploy?repo=https://github.com/<你的GitHub用户名>/<仓库名>`
3. 登录 Render（可用 GitHub 授权），确认 Blueprint，点击 **Apply / Deploy**。
4. 等待构建完成，Render 会分配固定网址：`https://overdue-ar-platform.onrender.com`。

构建/启动命令已写在 `render.yaml`，无需手动填写。Node 版本固定为 24（依赖 `node:sqlite`）。

> Render 免费层：无活动时会休眠，首次打开稍慢（约 30 秒唤醒），网址固定不变。
> 免费层文件系统为临时盘，服务重启后 SQLite 会重新初始化为演示数据。

## 演示账号

密码统一 `123456`：`wangfang`（应收·全集团）、`liwei`（华北销售）、`liuzong`（华北事业部）、`wangqiang`（销售主管）、`zhouming`（法务）、`lishen`（审计·金额脱敏）、`linda`（华东销售）、`admin`（系统管理员）。

## 本地运行

```bash
cd web && npm ci && npm run build
cd ../server && npm ci && npm run build && PORT=3000 npm start
# 打开 http://localhost:3000
```
