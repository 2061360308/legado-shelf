# 使用

## 上传管理书籍

提供简单可视化网页用来日常上传、管理书籍

1. 打开 Cloudflare 分配的域名或自己绑定的域名，输入 `API_KEY` 登录
2. 上传 EPUB / TXT 文件
3. 编辑元数据后点击"确认上传"
4. 点击"触发处理"启动 Action 生成 Release

## 阅读

<p align="center">
  <img src="https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=https://raw.githubusercontent.com/2061360308/legado-shelf/main/support/legado/bookSource.json" alt="legado-shelf书源二维码">
  <h5 align="center">开源阅读书源【legado-shelf】二维码</h5>
</p>

基于 API 设计了开源阅读的书源，扫描上方二维码或者复制[`bookSource.json`](../support/legado/bookSource.json)中的内容添加书源，之后就可以在发现书源中找到`legado-shelf`这个书源，登录后点击我的书籍即可看到自己上传的书。

## API

API 文档采用 **OpenAPI** 标准自动生成，并借助 **Scalar** 提供友好的交互式体验。

> **访问地址**：`https://<你的域名>/docs`（请将 `<你的域名>` 替换为实际部署域名）

所有接口的请求参数、响应结构、错误码等信息均可在线查阅，并支持直接发送请求进行测试。