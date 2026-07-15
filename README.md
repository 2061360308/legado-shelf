# Legado Shelf

<p align="center">
  <a href="https://github.com/2061360308/legado-shelf"><img src="https://img.shields.io/github/stars/2061360308/legado-shelf?style=flat-square&color=yellow" alt="Stars"></a>
  <a href="LICENSE"><img src="https://img.shields.io/github/license/2061360308/legado-shelf?style=flat-square&color=blue" alt="License"></a>
  <a href="https://github.com/2061360308/legado-shelf/actions"><img src="https://img.shields.io/github/actions/workflow/status/2061360308/legado-shelf/deploy.yml?style=flat-square&label=deploy" alt="Deploy"></a>
  <br>
  <img src="https://img.shields.io/badge/Vue-3-4FC08D?style=flat-square&logo=vue.js" alt="Vue 3">
  <img src="https://img.shields.io/badge/TypeScript-blue?style=flat-square&logo=typescript" alt="TypeScript">
  <img src="https://img.shields.io/badge/Cloudflare-F38020?style=flat-square&logo=cloudflare" alt="Cloudflare">
  <img src="https://img.shields.io/badge/R2-存储-orange?style=flat-square&logo=cloudflare" alt="R2">
  <img src="https://img.shields.io/badge/Node-22-339933?style=flat-square&logo=node.js" alt="Node">
</p>

[Legado](https://github.com/gedoor/legado)（开源阅读）的云端书架。提供 Web 管理界面，可将本地 EPUB/TXT 上传至 GitHub Release 存储，通过定制书源随时在线阅读。

本项目所有后端 API 均自动生成符合 [OpenAPI](https://swagger.io/specification/) 标准的 JSON 描述文件，并集成 [Scalar](https://scalar.com/) 提供交互式文档界面。部署成功后，可通过以下地址访问：`https://<你的域名>/docs`

## 为什么用这个

- **零服务器成本** — 部署在 Cloudflare Worker 免费计划内，GitHub Release 无限存储
- **永久归属** — 书籍存在你自己的 GitHub 仓库里，不依赖任何第三方服务存活
- **Legado 原生适配** — 标准书源 API，搜索/目录/章节/封面一个不落
- **开箱即用** — 一键部署到 Cloudflare，5 分钟上线
- **随处访问** — 云端 API，手机/电脑/阅读器任意设备随时拉取书架

## 特性

- **拖拽上传** — 支持 EPUB/TXT，自动解析目录结构，封面提取并转 JPEG
- **分片存储** — 书籍按章节分片存入 GitHub Release，单本百万字无压力
- **动态处理** — Worker 触发 Content Repo Action，R2 凭证动态注入，无需手动配置密钥
- **RESTful API** — 提供 `/api/books` 搜索、`/toc` 目录、`/chapters/:key` 内容、`/cover` 封面等接口
- **交互式 API 文档** — 所有接口自动生成符合 OpenAPI 标准的 JSON 文件，集成 Scalar 提供可视化调试界面，部署后访问 `/docs` 即可使用
- **全球加速** — Cloudflare 边缘网络，世界任何角落秒级响应

## 部署 & 使用

部署教程见：[`部署说明`](docs/deploy.md)

使用教程见：[`使用说明`](docs/usage.md)

## 架构

```
前端 (Vue 3) ──→ Cloudflare Worker ──→ GitHub API (触发工作流)
                      │                         │
                 Cloudflare R2            Content Repo Action
                 (上传暂存)                (处理 → Release)
```

## 技术栈

- Vue 3 + Vue Router + TypeScript
- Cloudflare Workers + R2
- GitHub Actions + Octokit
- JSZip + aws4fetch

## 本地开发

```bash
git clone https://github.com/你的用户名/legado-shelf.git
cd legado-shelf
npm install
cp .dev.vars.example .dev.vars   # 编辑填入配置
npm run dev
```

浏览器打开 `http://localhost:5173`，输入 API Key。

## 免责声明

- **合理使用** — GitHub Release 适合存储少量电子书，请勿将其用作大规模盗版分发。滥用可能导致仓库被封。
- **信息安全** — `API_KEY` 即你的登录凭证，请设置足够复杂。`GH_PAT` 和 R2 密钥泄露可能导致他人恶意使用你的资源，务必妥善保管。

## License

项目采用[MIT](LICENSE)协议，欢迎贡献代码
