# BlueNoise

[English](./README.md) · **简体中文**

> 让 X 重新变得可读。

BlueNoise 是一款开源的浏览器扩展，可以模糊或隐藏 X（原 Twitter）帖子详情页中嘈杂的回复，以及首页时间线上的帖子。它通过本地、可逆的关键词规则实现，不调用 X API、不读取 cookie、也不会改变你的账号状态，让阅读体验更清爽。

作者：rokcso · 源码与反馈：<https://github.com/rokcso/bluenoise>

## 安装

> BlueNoise 正在上架 [Chrome 应用商店](https://chromewebstore.google.com)。在审核通过之前，请先从[最新发布](https://github.com/rokcso/bluenoise/releases/latest)手动安装扩展。

1. 在[发布页面](https://github.com/rokcso/bluenoise/releases)下载 `bluenoise-<版本号>-chrome.zip`。
2. 解压到一个你不会删掉的文件夹里（浏览器需要这些源文件一直保留在原位）。
3. 打开 `chrome://extensions`（或你所用 Chromium 浏览器的扩展管理页），开启**开发者模式**，点击**加载已解压的扩展程序**，选择刚才解压出来的文件夹。

## 功能特性

- 过滤 X 帖子详情页的回复以及首页时间线上的帖子；在帖子页面中，绝不会过滤你自己打开的那条帖子。
- 可对匹配的内容进行模糊或隐藏，关闭扩展即可一键恢复。
- 支持内置、社区和个人三套关键词列表。
- 支持按数字 ID 或 @用户名屏蔽指定账号，内置社区账号列表，同时支持你自己的本地黑名单和白名单。
- 支持纯关键词和 JavaScript 正则表达式，例如 `/error/i`。
- 能识别常见的绕行手段，例如用空格和零宽字符。
- 内置白名单，用于纠正误杀。
- 自动处理新加载的回复和帖子，无需刷新页面。
- 设置、规则和白名单只保存在浏览器本地存储中。

## 隐私与权限

BlueNoise 不收集任何遥测或分析数据。它不读取 cookie、不访问账号凭据、不调用 X API，也不会执行拉黑、静音、关注、发帖等账号操作。

扩展使用了以下权限：

- `storage`：将设置、规则和白名单保存在浏览器本地。
- `https://raw.githubusercontent.com/*`：在首次需要或手动同步时下载公开的关键词列表。
- `https://x.zuoluo.tv/*`：在开启外部账号列表后，下载公开的社区账号黑名单/白名单。

完整内容请阅读[隐私政策](./docs/privacy-policy.md)。

## 开发

架构与设计说明请参阅 [DESIGN.md](./docs/DESIGN.md)。

### 环境要求

- Node.js 22 或更高版本
- pnpm 10

### 本地运行

```bash
pnpm install
pnpm dev
```

开发构建完成后，打开 Chrome/Chromium 的扩展管理页，开启开发者模式，选择**加载已解压的扩展程序**，然后选中 WXT 生成的开发输出目录即可。

### 常用命令

```bash
pnpm typecheck  # 运行 TypeScript 类型检查
pnpm test       # 运行单元测试
pnpm check      # 运行 Biome 检查
pnpm build      # 生成生产构建
pnpm zip        # 将扩展打包为 zip 压缩包
```

## 参与贡献

欢迎提交贡献。请在 [Issues](https://github.com/rokcso/bluenoise/issues) 中报告问题或讨论功能，也可以直接发起 pull request。提交之前，请先运行：

```bash
pnpm typecheck && pnpm test && pnpm check
```

## 致谢

BlueNoise 的灵感来源于以下项目，并向它们致敬：

- [x-spam-filter](https://github.com/ZPVIP/x-spam-filter)
- [x-comment-blocker](https://github.com/amahteru/x-comment-blocker)
- [make-x-great-again](https://github.com/foru17/make-x-great-again)

## 发布

已构建的产物均挂载在 [GitHub Releases](https://github.com/rokcso/bluenoise/releases) 上。

## 许可证

本项目采用 [MIT 许可证](./LICENSE)。

Copyright (c) 2026 rokcso
