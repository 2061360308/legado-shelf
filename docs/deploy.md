# 部署指南

## 前提准备

### 1. 创建内容仓库

在 GitHub 上创建一个新仓库用于存储书籍数据（建议**私有**）。

记下仓库的 `owner`（用户名）和 `repo`（仓库名），后面需要填入。

### 2. 创建 GitHub Token

1. GitHub → Settings → Developer settings → Personal access tokens → **Fine-grained tokens**
2. Generate new token
3. Resource owner：选择你的账号
4. Repository access：选择 **Only select repositories**，勾选你的**内容仓库**和**代码仓库**
5. Permissions 设置以下权限：

| 权限 | 级别 | 用途 |
|------|------|------|
| Contents | Read and write | 创建 Release、读写 index.json |
| Actions | Read and write | 检查 Action 运行状态 |
| Workflows | Read and write | 触发工作流、写入 workflow 文件 |

6. 生成后**立即复制**，离开页面后无法再查看

### 3. 创建 Cloudflare 账号

注册 [Cloudflare](https://dash.cloudflare.com/sign-up)，验证邮箱。

### 4. 创建 R2 存储桶

1. Cloudflare Dashboard → R2 → 创建存储桶，名称随意（如 `novel`）
2. 进入存储桶 → 设置 → R2 API 令牌 → 创建 API 令牌
3. 权限选"对象读取和写入"
4. 记录下：
   - `Access Key ID`
   - `Secret Access Key`
   - `Endpoint`（形如 `https://xxxxx.r2.cloudflarestorage.com`）

## 开始部署

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/2061360308/legado-shelf)

点击上方按钮 → 授权 Cloudflare 访问 GitHub → 在弹出的表格中填写以下变量 → 点击部署。

## 环境变量

| 变量 | 来源 | 说明 |
|------|------|------|
| `API_KEY` | 自己设定 | 登录密钥，用于 Web 界面和 API 鉴权 |
| `GH_PAT` | 前提准备 2 | 刚创建的 PAT |
| `CONTENT_OWNER` | 前提准备 1 | 内容仓库的 owner |
| `CONTENT_REPO` | 前提准备 1 | 内容仓库名 |
| `R2_ENDPOINT` | 前提准备 4 | R2 端点地址 |
| `R2_ACCESS_KEY_ID` | 前提准备 4 | R2 Access Key |
| `R2_SECRET_ACCESS_KEY` | 前提准备 4 | R2 Secret Key |
| `R2_BUCKET_NAME` | 前提准备 4 | R2 桶名 |

部署完成后，内容仓库需要额外设置（见下文）。

## 内容仓库设置

部署完成后，在**内容仓库** Settings → Secrets and variables → Actions 中添加以下 Secrets，否则 Action 无法访问 R2：

| Secret | 值 |
|--------|-----|
| `R2_ENDPOINT` | 同上 |
| `R2_ACCESS_KEY_ID` | 同上 |
| `R2_SECRET_ACCESS_KEY` | 同上 |
| `R2_BUCKET_NAME` | 同上 |

## 使用

1. 打开 Cloudflare 分配的域名，输入 `API_KEY` 登录
2. 上传 EPUB / TXT 文件
3. 编辑元数据后点击"确认上传"
4. 点击"触发处理"启动 Action 生成 Release
5. 通过 API 获取书籍内容，或直接接入 Legado 书源

### API

所有 API 需要 `Authorization: Bearer {API_KEY}` 头部。

| 接口 | 说明 |
|------|------|
| `GET /api/books?q=关键词` | 搜索/列出书籍 |
| `GET /api/books/:hash/toc` | 书籍目录 |
| `GET /api/books/:hash/cover` | 封面 |
| `GET /api/books/:hash/chapters/:key` | 章节内容 |

## 本地开发

如需要本地修改调试：

```bash
git clone https://github.com/2061360308/legado-shelf.git
cd legado-shelf
npm install
cp .dev.vars.example .dev.vars    # 填入配置
npm run dev
```

前端 `localhost:5173`，后端 `localhost:8787`。
