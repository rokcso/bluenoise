# Chrome 网上应用店文案

## 名称

BlueNoise - 让 X 重新值得阅读

## 简短说明

在本地过滤嘈杂回复、时间线帖子和广告，使用可逆规则，并可按需精简 X 界面。

## 详细说明

BlueNoise 让 X 的回复区和首页时间线更容易阅读。它在本地过滤匹配内容，不会替你操作账号。

可以做什么

- 按关键词或账号过滤回复和首页时间线帖子，同时保留当前打开的原帖。
- 将匹配内容模糊、折叠或隐藏；关闭过滤即可恢复页面。
- 支持普通关键词、安全的 `/正则/flags`、账号 ID、@用户名、个人白名单和可选社区列表。
- 可选过滤推广帖、媒体或外链卡片广告，以及被 X 标记为仿冒、粉丝、评论或自动化的账号。
- 支持导入导出个人规则，也可通过右键菜单添加允许或屏蔽规则。
- 可独立隐藏 X 中指定的推荐、推广、计数器和导航元素。

不会做什么

- 不读取 cookie，不调用 X API。
- 不拉黑、静音、关注、取关、发帖或修改 X 账号 —— 被屏蔽的账号仅在本地被模糊或隐藏，不会在 X 上产生任何操作。
- 不收集分析数据，也不会将你的规则上传到服务器。

### 权限说明

扩展只申请实现单一用途所需的最小权限：

- `storage`：通过 Chrome 同步行为设置，并在本地保存个人规则和公开列表缓存。
- `unlimitedStorage`：让本地缓存的社区过滤列表（几 MB 的关键词与账号名单）可以超过 `storage.local` 默认约 10 MB 的配额。
- `alarms`：安排低频的后台刷新，定时更新公开过滤列表（关键词每 12 小时、账号名单每 6 小时）。
- `contextMenus`：在 X 页面选中文本后提供允许或屏蔽关键词和账号的右键操作。
- `raw.githubusercontent.com`：下载扩展中提供的公开关键词列表。
- `x.zuoluo.tv`：仅在你启用外部账号名单时下载公开社区账号黑/白名单（Make X Great Again）。

### 隐私与源码

- 隐私政策：https://github.com/rokcso/bluenoise/blob/main/docs/privacy-policy.md
- 源码与问题反馈：https://github.com/rokcso/bluenoise

---

## 权限审核说明（Chrome 应用商店提审表单）

供 Chrome 网上应用店权限审核表单填写的说明（正式提交时请以英文版为准）。

### Single purpose（单一用途说明）

BlueNoise 的单一用途是让 X（原 Twitter）更易阅读：根据用户控制的关键词与账号规则，在本地过滤回复和首页时间线帖子。匹配内容可以模糊、折叠或隐藏。所有过滤都只是视觉层面的、可逆的；BlueNoise 不读取 cookie、不调用 X API，也不会修改用户的 X 账号。

### storage（存储权限说明）

`storage` 权限用于 Chrome 的两种存储区域：

- `chrome.storage.sync` 保存总开关、显示模式、语言、主题和启用的规则源等行为设置，使其可随 Chrome 账号同步。
- `chrome.storage.local` 保存个人关键词/账号规则、公开列表缓存和可选诊断日志，避免将较大或私人的规则数据放入同步存储。

扩展不读取或存储 cookie、X 账号凭据、浏览历史或其他网站的数据，也不会将个人规则发送给 BlueNoise 或第三方应用服务器。

### unlimitedStorage（无限制存储说明）

BlueNoise 将公开社区过滤列表缓存在 `chrome.storage.local` 中，以便离线使用和即时匹配：

- 下载的关键词列表每个上限 2 MB（代码内强制校验）。
- 社区账号黑名单（lite 产物，schema v2）约 9 MB 原始 / 约 4 MB 传输体积，代码内设 25 MB 校验上限，另有上限 2 MB 的白名单。

这些缓存列表可能超过 Chrome 默认的 `storage.local` 配额。`unlimitedStorage` 使其可保留在本地，避免重复下载。下载体积仍在代码中受到约束和校验（关键词列表 2 MB、账号产物 25 MB），且只存储紧凑的列表数据。

### alarms（定时任务说明）

`alarms` 权限仅用于在后台 Service Worker 中按低频计划刷新公开过滤列表：

- `keyword-sync`：每 12 小时（720 分钟）刷新订阅的关键词列表，用户无需打开扩展即可获得更新。
- `account-list-sync`：每 6 小时（360 分钟）在用户启用外部账号名单时刷新社区账号黑/白名单。
- 两者也会在安装后或浏览器启动后的 1–2 分钟内各调度一次，以便在不保持 Service Worker 常驻的情况下取到最新副本。

定时任务只为这些计划内的列表更新而触发。没有持续的后台处理、没有跟踪、没有分析，也不会为其他目的唤醒。

### contextMenus（右键菜单说明）

BlueNoise 注册四个右键菜单项，仅在用户在 X 页面选中文本时出现（`documentUrlPatterns` 限定为 `https://x.com/*` 与 `https://twitter.com/*`）：

- 将选中文本加入关键词白名单或屏蔽列表。
- 将选中的 X 数字用户 ID 或 @用户名加入账号白名单或屏蔽列表。

这些菜单项纯粹是为了方便：用户可以直接在阅读的页面添加过滤规则，而不必切到设置页。菜单绝不会出现在其他网站上，不会读取其他标签页或页面内容，只会把用户自己的选中文本写入本地 `storage.local`。

### Host permission（主机权限说明）

扩展申请两个收窄的站点权限。`https://raw.githubusercontent.com/*` 用于下载设置页中展示的公开关键词列表（BlueNoise、x-spam-filter 与 x-comment-blocker）。`https://x.zuoluo.tv/*` 用于在用户启用对应外部名单时下载 Make X Great Again 的公开账号黑/白名单。下载发生在初始设置、手动同步或定时刷新时。这些权限绝不用来在这些主机上执行脚本或读取其他内容；BlueNoise 不会在 X 之外的页面注入或观察。下载文件在使用前会经过校验，请求不附带任何 cookie 或凭据。

### Are you using remote code?（是否使用远程代码？）

不使用。所有代码都已打包并随扩展版本发布（由本仓库经 WXT/Vite 构建）。BlueNoise 不加载也不执行任何远程脚本、CDN 代码或动态代码——没有 `eval`、没有 `new Function`、没有可执行代码的远程配置。唯一远程下载的资源是纯文本/JSON 数据（公开关键词与账号名单），会被严格当作数据校验与解析，绝不执行。

源码：https://github.com/rokcso/bluenoise
