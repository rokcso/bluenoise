# BlueNoise

[English](./README.md) · **简体中文**

> 让 X 重新变得可读。

BlueNoise 是一款开源、隐私优先的 X（原 Twitter）浏览器扩展，用于过滤嘈杂内容和精简界面。所有匹配均在本地完成，并使用可随时撤销的关键词和账号规则。

作者：rokcso · 源码与反馈：<https://github.com/rokcso/bluenoise>

## 安装

<a href="https://chromewebstore.google.com/detail/ponbeiihcconklnlphjcnbfkghnimpid"><img src="./docs/assets/chrome-web-store-badge.png" alt="在 Chrome 应用商店中获取" width="220"></a>

<a href="https://microsoftedge.microsoft.com/addons/detail/aceiebenjmedobigcfafhckcjhhbjkko"><img src="./docs/assets/microsoft-edge-addons-badge.png" alt="在 Microsoft Edge 加载项中获取" width="220"></a>

可从 Chrome 应用商店或 Microsoft Edge 加载项安装，也可以从 [GitHub Releases](https://github.com/rokcso/bluenoise/releases) 下载 `bluenoise-<版本号>-chrome.zip` 手动安装：

1. 解压到一个你不会删掉的文件夹里（浏览器需要这些源文件一直保留在原位）。
2. 打开 `chrome://extensions`（或你所用 Chromium 浏览器的扩展管理页），开启**开发者模式**，点击**加载已解压的扩展程序**，选择刚才解压出来的文件夹。

## 功能特性

- 按关键词或账号过滤回复和首页时间线帖子，同时保留当前打开的原帖。
- 将匹配内容模糊、折叠或隐藏；关闭过滤即可恢复页面。
- 支持纯关键词、安全的 `/regex/` 正则、账号 ID、@用户名、个人白名单和可选社区列表。
- 可选过滤推广帖、媒体或外链卡片广告，以及被 X 标记为仿冒、粉丝、评论或自动化的账号。
- 支持导入导出个人规则，也可通过右键菜单添加允许或屏蔽规则。
- 可独立精简 X 界面，隐藏指定的推荐、推广、计数器和导航元素。

## 隐私与权限

BlueNoise 不收集任何遥测或分析数据。它不读取 cookie、不访问账号凭据、不调用 X API，也不会执行拉黑、静音、关注、发帖等账号操作。设置与规则通过浏览器存储保存；网络访问仅用于更新已启用的公开规则列表。

完整内容请阅读[隐私政策](./docs/privacy-policy.md)。

## 开发

需要 Node.js 22 或更高版本，以及 pnpm 10。

```bash
pnpm install
pnpm dev
```

然后在 Chrome/Chromium 中将 WXT 生成的开发目录加载为未打包扩展。其他命令：

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

## 许可证

本项目采用 [MIT 许可证](./LICENSE)。

Copyright (c) 2026 rokcso
