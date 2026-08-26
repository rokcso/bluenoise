# BlueNoise

[English](./README.md) · **简体中文**

> 让 X 重新变得可读。

BlueNoise 是一款开源、隐私优先的 X（原 Twitter）过滤与界面整理扩展：在本地用可逆的关键词和账号规则模糊或隐藏嘈杂回复、时间线帖子和广告，还能隐藏界面杂乱元素、恢复更清爽的经典风格。不调用 X API、不读取 cookie，也不会改变你的账号状态。

作者：rokcso · 源码与反馈：<https://github.com/rokcso/bluenoise>

## 安装

<a href="https://chromewebstore.google.com/detail/ponbeiihcconklnlphjcnbfkghnimpid"><img src="./docs/assets/chrome-web-store-badge.png" alt="在 Chrome 应用商店中获取" width="220"></a>

从 [Chrome 应用商店](https://chromewebstore.google.com/detail/ponbeiihcconklnlphjcnbfkghnimpid)安装 BlueNoise。

想手动安装？从[发布页面](https://github.com/rokcso/bluenoise/releases)下载 `bluenoise-<版本号>-chrome.zip`：

1. 解压到一个你不会删掉的文件夹里（浏览器需要这些源文件一直保留在原位）。
2. 打开 `chrome://extensions`（或你所用 Chromium 浏览器的扩展管理页），开启**开发者模式**，点击**加载已解压的扩展程序**，选择刚才解压出来的文件夹。

## 功能特性

- 模糊或隐藏帖子详情页中嘈杂的回复，以及首页时间线上的帖子（绝不会过滤你自己打开的那条帖子）。关闭扩展即可一键恢复。
- 支持按关键词和账号过滤：纯关键词、安全的 `/regex/` 正则表达式，以及账号 ID 或 @用户名。
- 内置社区关键词列表（X Spam Filter、X Comment Blocker）和社区账号名单（Make X Great Again），自动保持更新；同时支持你自己的个人关键词列表，以及本地账号黑名单/白名单。
- 可将个人关键词和账号规则导出为可迁移的 JSON 备份，也支持合并、追加或覆盖导入。
- 选中任意文字后右键，即可将其添加为关键词或账号屏蔽。
- 工具栏角标会显示已过滤的帖子数量；悬停被模糊的回复时，可在光标周围临时显示。
- 可选过滤推广帖子、含媒体或外链卡片的广告，以及被 X 标记为仿冒、粉丝、评论或自动化的账号。
- 提供可独立开关的 X 界面改造：隐藏指定的推荐、推广内容、页脚、计数器和导航控件；折叠侧边栏；或换回经典的 Twitter 蓝鸟图标。
- 能识别常见的绕行手段（空格和零宽字符），支持浅色/深色主题及中英文界面，并内置白名单用于纠正误杀。
- 新加载的回复和帖子会自动过滤，无需刷新页面。

## 隐私与权限

BlueNoise 不收集任何遥测或分析数据。它不读取 cookie、不访问账号凭据、不调用 X API，也不会执行拉黑、静音、关注、发帖等账号操作。

扩展申请了以下权限：

- `storage` 和 `unlimitedStorage`：通过 Chrome 同步保存行为设置；在本地保存个人规则和社区列表缓存。BlueNoise 不会将这些存储用于遥测。
- `alarms`：在后台定期刷新已订阅的关键词和账号列表。
- `contextMenus`：为选中的文字在右键菜单中提供「添加关键词」/「添加账号」选项。
- `https://raw.githubusercontent.com/*`：下载公开的关键词列表。
- `https://x.zuoluo.tv/*`：下载公开的社区账号黑名单/白名单。

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

最新版本已上架 [Chrome 应用商店](https://chromewebstore.google.com/detail/ponbeiihcconklnlphjcnbfkghnimpid)；源码构建产物挂载在 [GitHub Releases](https://github.com/rokcso/bluenoise/releases) 上。

## 许可证

本项目采用 [MIT 许可证](./LICENSE)。

Copyright (c) 2026 rokcso
