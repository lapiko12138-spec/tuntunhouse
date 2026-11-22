# 囤囤屋 · 素材与灵感

个人创作素材站：收藏常用网站，归档图片与录屏，手动维护选题。详细拆解收在编辑侧栏里，首页保持精简。

## 先用本地版

1. 下载本仓库的 ZIP 并解压，或单独下载根目录的 [tuntun-studio.html](./tuntun-studio.html)。
2. 用 Chrome 或 Edge 打开 `tuntun-studio.html`。
3. 开始收藏网站、上传素材、记录选题。左下角「数据与使用说明」可导出完整备份。

本地版使用 IndexedDB 保存记录与附件原文件。数据属于当前浏览器，更换浏览器或清理浏览器数据前，请导出完整 JSON 备份；备份可以导入恢复。

## 已有功能

- 常用网站：分类、标签、搜索、特别收藏、链接去重。
- 视频灵感：图片、录屏、音频与文档附件；单个文件不超过 100MB，每条最多 10 个附件。
- 内容拆解：开头钩子、内容结构、画面与声音、情绪与互动、可以怎么借鉴，并保留分析依据。
- 手动选题：灵感待写、准备创作、制作中、已发布四种进度。
- 热点入口：小红书、Instagram、公众号站内搜索。内容与互动数据需要在原文核验。
- 收起与恢复、完整 JSON 备份和导入。

根目录 HTML 可以直接使用。GitHub 仓库保存项目代码，上传代码本身不会启动在线站点。

## 在线版源码

在线服务采用 Cloudflare Worker ES module，零运行时第三方依赖。R2 `BUCKET` 保存结构化记录与附件，视频支持 Range 播放。更新通过版本和 ETag 检查避免覆盖其他窗口的修改。

在线版设计为 owner-only 私有 Site，API 依赖平台的账户访问控制。`.openai/hosting.json` 保留已注册的 Site 身份；继续该发布链路时应复用原 project_id，保持私有访问范围。

`/mcp` 提供搜索、归档、更新、AI 选题检索和附件关联工具。在线部署并连接 ChatGPT 后，可以由聊天维护资料；目前尚未完成在线部署，跨设备同步、公开内容聚合检索和聊天直接写入尚未启用。

聚合检索源码使用公开 RSS 搜索，不代表平台实时热榜。检索失败会明确反馈并保留站内搜索入口；未接入登录后内容、平台真实互动数据或定时采集。项目未配置模型 API 密钥；内容拆解可手动填写，连接 ChatGPT 后再基于实际素材分析写回。

## 开发与构建

使用 Node.js 22.13+，无需安装依赖：

```sh
node scripts/build.mjs
node --test scripts/checks.test.mjs
node scripts/build-local.mjs
node scripts/dev.mjs
```

- `worker/page.html`：前端源码。
- `worker/server.mjs`：API、文件与 MCP 服务。
- `worker/local-adapter.mjs`：本地版 IndexedDB 适配。
- `scripts/build.mjs`：将前端嵌入单个 Worker。
- `scripts/build-local.mjs`：生成根目录和 `outputs/` 下的本地版 HTML。
- `scripts/dev.mjs`：仅监听 loopback 的开发服务，本地测试数据位于忽略的 `.sites-runtime/data`。

修改源码后重新构建，勿直接编辑 `dist/`。本地版备份包含附件原文件；在线版 JSON 导出包含附件索引，附件原文件可单独下载。

## 验证状态

5 组服务端检查通过：归档、去重、版本冲突与恢复；非法输入和跨站提交；附件与视频 Range；MCP 工具；页面结构。前端脚本语法检查通过。

当前执行环境未能完成浏览器视觉与交互实测，在线站点发布链路也尚未完成。仓库不包含个人素材、浏览器数据、临时状态或访问密钥。
