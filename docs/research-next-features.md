# BlueNoise 下一步功能机会调研

> 调研日期：2026-08-28  
> 范围：Chrome Web Store 同类扩展、同类开源项目、X 官方帮助、Chrome Extensions 官方文档。优先引用产品或平台所有者的一手资料；GitHub issue 只作为需求/风险信号，不把单条反馈外推为总体事实。

## 结论先行

BlueNoise 已经覆盖“关键词/账号名单 + 模糊或隐藏 + 社区规则 + 界面清理”的基础层。下一阶段最有价值的方向不是自动拉黑，也不是把帖子上传给云端 AI，而是建立一个**可解释、可纠错、可组合的本地信息降噪系统**：用户能看见为什么被过滤、能在原地纠正误杀、能按页面和内容形态组合规则，并能知道规则到底替自己挡掉了什么。

建议按以下顺序推进：

1. **P0：过滤收件箱（历史、原因、原地纠错）**——解决规则系统最大的信任缺口，也形成后续调参的数据闭环。
2. **P0：结构化内容过滤器**——过滤视频、Grok 卡片、付费合作、Made with AI、低互动帖子、纯转帖等，不再要求用户自己写脆弱正则。
3. **P1：作用域规则与预设场景**——按首页/搜索/通知/帖子回复、语言、关注关系等限定规则，显著降低误杀。
4. **P1：模板化垃圾/重复回复检测**——在本地识别同一线程中的近重复文案，补足静态词库追不上变体的问题。
5. **P1：浏览会话与注意力控制**——已读折叠、停止无限滚动、每次会话过滤摘要，让“少看噪音”扩展为“少被信息流牵引”。
6. **P2：Firefox 与移动端覆盖**——先验证跨浏览器构建，再考虑 Safari；这是分发增长项，不应抢在过滤闭环之前。

不建议近期做：自动批量拉黑/静音、读取 cookie 调 X 私有接口、默认云端 AI 分类、账号“可信度打分”。这些方向会扩大权限和风控面，并把可解释的内容工具变成难以治理的裁决系统。

## 现状与竞品能力

BlueNoise 当前 README 已列出本地关键词/安全正则、账号黑白名单、社区列表同步、推广与特殊账号标签过滤、页面清理、JSON 导入导出和右键添加规则等能力。[BlueNoise README（项目一手资料）](../README.zh-CN.md)

### 同类产品已经验证的需求

| 产品 | 已公开能力 | 对 BlueNoise 的启示 |
| --- | --- | --- |
| X Spam Filter | 命中词原文高亮、页面内一键加白名单、可调透明度、社区词库、拆字/零宽字符归一化；明确避免自动拉黑和 X API | “解释命中 + 就地纠错”是自然的下一步，而且与 BlueNoise 定位完全相容。[项目 README](https://github.com/ZPVIP/x-spam-filter#readme) · [Chrome Web Store](https://chromewebstore.google.com/detail/x-spam-filter/gpfkmempinhlopfkomklkkbdeggaknmo) |
| X(Twitter) Comment Blocker | 最近 5000 条拦截历史、统计、特殊字符/emoji、Grok 分享卡片过滤、用户白名单、完整备份；同时提供手动/批量/自动拉黑 | 历史与结构化类型过滤已有用户价值信号；但账号写操作不是 BlueNoise 应复制的部分。[项目 README](https://github.com/amahteru/x-comment-blocker#readme) · [Chrome Web Store](https://chromewebstore.google.com/detail/xtwitter-comment-blocker/gagacedifiphcndckimeihhcbcclkach) |
| Control Panel for Twitter | 大量时间线与界面控制，桌面和移动浏览器支持 | 高级时间线筛选、停止无限滚动、过滤视频/反应帖等需求持续出现；与此同时，X 改版会频繁破坏 DOM 适配。[项目 README](https://github.com/insin/control-panel-for-twitter#readme) · [产品官网](https://soitis.dev/control-panel-for-twitter) |
| Make X Great Again | 社区账号名单、本地隐藏、误判申诉；规划账号画像、Profile 摘要、社交图谱提示和数据导出；覆盖 Chrome、Firefox、Safari/iOS | 社区名单能扩大覆盖，但公开 issue 中密集的误判申诉说明必须先做好本地豁免和治理；“账号可信评分”已被竞品占位且治理成本高。[项目 README](https://github.com/foru17/make-x-great-again#readme) · [Chrome Web Store](https://chromewebstore.google.com/detail/make-x-great-again/aeoldnecphbkkckeedfgfcdcekkljdea) · [误判申诉示例](https://github.com/foru17/make-x-great-again/issues/332) |

### 可观察的用户痛点信号

- 用户不仅想过滤关键词，还想过滤**内容形态**：视频、低互动帖子、“reaction to”、Made with AI、付费合作、Grok 自动翻译等均有明确 feature request。[视频过滤 #862](https://github.com/insin/control-panel-for-twitter/issues/862) · [低点赞阈值 #850](https://github.com/insin/control-panel-for-twitter/issues/850) · [reaction 帖 #895](https://github.com/insin/control-panel-for-twitter/issues/895) · [AI/付费合作 #875](https://github.com/insin/control-panel-for-twitter/issues/875) · [Grok 翻译 #869](https://github.com/insin/control-panel-for-twitter/issues/869)
- 用户希望控制消费节奏，而不只是 CSS 清理；“关闭无限滚动”已有直接请求。[Control Panel for Twitter #916](https://github.com/insin/control-panel-for-twitter/issues/916)
- DOM 深度改造维护成本很高：同一项目持续出现帖子消失、媒体页失效、DM 不可用、隐藏 For You 失效等回归报告。因此 BlueNoise 应优先选择**语义分类 + 可逆标记**，谨慎重排或重建 X UI。[#908](https://github.com/insin/control-panel-for-twitter/issues/908) · [#906](https://github.com/insin/control-panel-for-twitter/issues/906) · [#856](https://github.com/insin/control-panel-for-twitter/issues/856) · [#905](https://github.com/insin/control-panel-for-twitter/issues/905)
- 对 X 发起额外或自动化请求存在实际账号风险信号：Control Panel 项目报告“分 tab 展示转帖”可能因过多请求触发锁号；X Spam Filter 也明确以此为理由不做自动拉黑。[Control Panel #931](https://github.com/insin/control-panel-for-twitter/issues/931) · [X Spam Filter 说明](https://github.com/ZPVIP/x-spam-filter#为什么不拉黑账号)

## 平台原生能力留下的空白

X 官方“已隐藏的字词”可以作用于首页时间线和通知，支持词语、短语、用户名、emoji、hashtag 以及永久/定时隐藏；但官方流程仍以逐条添加为主，且不同通知来源有作用范围限制。BlueNoise 的批量词库、正则、页面内解释和细粒度作用域仍有明显空间。[X Help：How to use advanced muting options](https://help.x.com/en/using-x/advanced-x-mute-options)

X Lists 允许用户创建或关注多个精选时间线，甚至无需关注列表内账号。这意味着 BlueNoise 不宜复制“列表管理”，更适合做一层横跨 For You、Following、List、搜索和回复页的统一过滤策略。[X Help：About X Lists](https://help.x.com/en/using-x/x-lists)

Community Notes 依赖不同观点贡献者对帖子上下文达成共识，目标是给可能误导的帖子补充背景，而非替用户过滤广告、重复回复或个人不感兴趣内容。BlueNoise 可以把“是否已有 Community Note”作为展示信号，但不应把它当真实性判定器。[X Help：About Community Notes](https://help.x.com/en/using-x/community-notes)

## 推荐功能详案

### P0. 过滤收件箱：让过滤可见、可撤销、可学习

**用户故事**：我能看到最近被过滤的内容、作者、页面、命中规则和时间；误杀时可立即“仅放行此作者 / 此规则 / 此帖子”，无需去设置页猜是哪条规则。

建议最小版本：

- 本地环形历史，默认最多 500～1000 条；保存截断后的正文摘要、作者 handle/ID、命中规则 ID、分类、页面类型和时间，不保存完整 HTML。
- 模糊卡片展示“被哪条规则、哪个来源命中”；提供“临时查看”“放行作者”“停用规则”。
- 设置页按规则、来源、页面、日期聚合命中数；显示“高命中”和“经常被纠错”的规则。
- 历史默认关闭正文留存或只留短摘要，并提供一键清空、保留期限和导出时显式勾选。

**为什么优先**：竞品已验证历史与页面内白名单；社区名单误判也是现实治理问题。没有这层，新增任何智能过滤都会降低用户信任。[X Comment Blocker README](https://github.com/amahteru/x-comment-blocker#readme) · [MXGA 申诉 #332](https://github.com/foru17/make-x-great-again/issues/332)

**成功指标**：每千次过滤的“临时查看率”、纠错后同类误杀下降、7 日仍启用率；全部可只在本地计算，不必加遥测。

### P0. 结构化内容过滤器

把常见需求变成稳定开关，而不是要求用户编写关键词：

- 视频、GIF、图片、外链卡片、Grok 分享卡片；
- 转帖、引用帖、自引用回复、纯媒体回复；
- X 标记的 `Made with AI`、付费合作/推广；
- 互动阈值（点赞/回复/转帖低于或高于 N），并允许限定在用户 Profile 或搜索结果；
- 可选语言过滤（“只保留这些语言”比“屏蔽几十种语言”易用）。

实现时将 DOM/Fiber 提取集中成 `ArticleFacts`，规则层只消费结构化字段。每个识别器都应支持“不确定/未知”，避免页面改版时错误地把未知当作命中。需求依据见 [#875](https://github.com/insin/control-panel-for-twitter/issues/875)、[#862](https://github.com/insin/control-panel-for-twitter/issues/862)、[#850](https://github.com/insin/control-panel-for-twitter/issues/850)、[#882](https://github.com/insin/control-panel-for-twitter/issues/882) 与 [X Comment Blocker README](https://github.com/amahteru/x-comment-blocker#readme)。

### P1. 作用域规则与场景预设

目前同一规则全局生效容易误伤。建议给规则增加可选作用域：

- 页面：For You、Following、Lists、搜索、通知、Profile、帖子回复；
- 关系：关注中、未关注、已验证、账号标签；
- 内容：正文、显示名、handle、媒体 alt、引用内容；
- 动作：隐藏、折叠、降亮度、只标记；
- 有效期：永久、24 小时、7 天、30 天。

提供三到四个预设而不是空白规则构建器，例如“净化评论区”“专注 Following”“搜索去广告”“选举/赛事期间静音”。X 原生已证明定时静音和页面作用域是用户可理解的模型，但 BlueNoise 可补上批量规则和更细作用域。[X advanced muting](https://help.x.com/en/using-x/advanced-x-mute-options)

### P1. 本地模板垃圾与重复回复检测

静态词库无法及时覆盖拼写变体和新话术，但同一评论区的机器人常复用模板。建议先做无需模型的本地检测：

1. 对可见回复做现有文本归一化；
2. 用字符 n-gram/SimHash 聚类近重复文本；
3. 同线程出现达到阈值时折叠为“发现 N 条相似回复”；
4. 用户展开后可逐条看，并把模板加入个人规则。

边界：只比较当前已加载 DOM，不跨站上传，不把“相似”直接等同于“垃圾”；默认折叠而非隐藏。这能形成 BlueNoise 相比名单型竞品的明显差异，同时保持隐私承诺。

### P1. 浏览会话与注意力控制

- 可选“已看过的帖子降亮/折叠”，只保存 tweet ID 与时间；
- 每加载 N 条后显示柔性断点：“本次已浏览 50 条，过滤 18 条”；
- 可选关闭无限滚动或达到会话上限后要求主动继续；
- 结束时给本地会话摘要，不做成带压力的生产力计分。

这一方向紧扣“让 X 重新可读”，也已有停止无限滚动的直接需求信号。[Control Panel #916](https://github.com/insin/control-panel-for-twitter/issues/916)

### P2. 跨浏览器和移动端

MXGA 与 X Comment Blocker 已公开支持 Firefox，前者还覆盖 Safari/iOS，说明移动端确有竞争价值。[MXGA README](https://github.com/foru17/make-x-great-again#readme) · [X Comment Blocker README](https://github.com/amahteru/x-comment-blocker#readme)

建议顺序：Firefox 桌面 → Firefox Android 实测 → Safari macOS/iOS。先抽离 `browser` API 差异、构建和商店发布流程；不要在过滤核心仍快速迭代时同时承担三套 DOM 兼容矩阵。

## Chrome 扩展约束与设计原则

- 内容脚本能读取和修改宿主页面 DOM，但运行在隔离世界；与页面 JS 共享 DOM、不共享 JS 变量。继续把页面提取放在 content 层、纯分类放在 domain 层是正确方向。[Chrome：Content scripts](https://developer.chrome.com/docs/extensions/develop/concepts/content-scripts)
- Manifest V3 service worker 会在空闲后终止，全局变量会丢失；持久状态必须放 `chrome.storage`，周期任务需要在启动时检查/重建 alarm，不能假设 worker 常驻。[Chrome：Extension service worker lifecycle](https://developer.chrome.com/docs/extensions/develop/concepts/service-workers/lifecycle) · [Chrome：Alarms API](https://developer.chrome.com/docs/extensions/reference/api/alarms)
- 新增 host/API 权限可能向用户显示警告；官方建议最小权限并使用 optional permissions。任何 X 账号操作、跨站列表源或云服务都应单独申请且由用户触发。[Chrome：Declare permissions](https://developer.chrome.com/docs/extensions/develop/concepts/declare-permissions) · [Chrome：Permissions API](https://developer.chrome.com/docs/extensions/reference/api/permissions)
- Chrome Web Store 的 Manifest V3 要求扩展逻辑可从提交代码中确定，禁止远程托管代码。可以下载 JSON/文本规则，但不能下载并执行 JS，也不宜下发可表达任意程序的规则 DSL。[Chrome Web Store：Remote hosted code](https://developer.chrome.com/docs/webstore/program-policies/mv3-requirements)
- 规则和历史增长要考虑存储配额；`storage.sync` 适合小型偏好，较大的用户规则、社区快照和历史应继续放 `storage.local`，并设计清理上限。[Chrome：Storage API](https://developer.chrome.com/docs/extensions/reference/api/storage)

## 取舍矩阵

| 机会 | 用户价值 | 差异化 | 实现/维护成本 | 隐私与账号风险 | 建议 |
| --- | --- | --- | --- | --- | --- |
| 过滤历史 + 原地纠错 | 高 | 中高 | 中 | 低（需控制本地留存） | **立即做** |
| 结构化内容过滤 | 高 | 中 | 中 | 低 | **立即做** |
| 规则作用域与预设 | 高 | 高 | 中高 | 低 | P1 |
| 本地近重复检测 | 高 | 高 | 中高 | 低 | P1 小实验 |
| 会话/无限滚动控制 | 中高 | 中高 | 中 | 低 | P1 |
| Firefox/移动端 | 中高 | 中 | 高 | 低 | P2 |
| Profile 摘要/KOL 评分 | 中 | 低（竞品已规划） | 高 | 中高（公平性/解释性） | 暂缓 |
| 自动拉黑/静音 | 中 | 低 | 高 | **高** | 不做 |
| 默认云端 AI 分类 | 不确定 | 中 | 高 | **高**（内容外传/成本） | 不做；若试验须完全 opt-in |

## 建议的三个版本

### v0.5：信任闭环

- 被模糊内容显示精确命中原因；
- 页面内停用规则、放行作者、临时查看；
- 本地过滤历史与按规则统计；
- 历史容量、保留期限和清空控制。

### v0.6：组合过滤

- `ArticleFacts` 结构化提取层；
- 视频/Grok/AI/付费合作/转帖/低互动等过滤器；
- 首页、搜索、Profile、回复的页面作用域；
- 一组保守预设和配置迁移。

### v0.7：自适应降噪

- 当前线程近重复聚类与折叠；
- 已读折叠和柔性会话断点；
- Firefox 构建 beta；
- 基于本地纠错数据给出“建议停用这条高误杀规则”，由用户确认，绝不静默学习。

## 验证方式

在开发前先做低成本验证：

1. 给现有用户展示“历史/纠错、结构化过滤、重复折叠、会话断点”四张概念图，只问最近一次具体遭遇，不问泛泛偏好。
2. v0.5 先不做遥测；在过滤历史页提供用户主动导出的匿名诊断摘要，明确预览将导出的字段。
3. 用固定 DOM fixture 建立页面类型 × 内容形态兼容矩阵；对“未知”状态做 fail-open，X 改版时宁可暂时不过滤也不要误隐藏。
4. 每个新分类器先以“仅标记”灰度，再开放折叠/隐藏动作。

## 一手资料索引

- [BlueNoise README](../README.zh-CN.md)
- [X Help：How to use advanced muting options](https://help.x.com/en/using-x/advanced-x-mute-options)
- [X Help：About X Lists](https://help.x.com/en/using-x/x-lists)
- [X Help：About Community Notes](https://help.x.com/en/using-x/community-notes)
- [Chrome Extensions：Content scripts](https://developer.chrome.com/docs/extensions/develop/concepts/content-scripts)
- [Chrome Extensions：Service worker lifecycle](https://developer.chrome.com/docs/extensions/develop/concepts/service-workers/lifecycle)
- [Chrome Extensions：Declare permissions](https://developer.chrome.com/docs/extensions/develop/concepts/declare-permissions)
- [Chrome Extensions：Storage API](https://developer.chrome.com/docs/extensions/reference/api/storage)
- [Chrome Web Store：Manifest V3 remote hosted code](https://developer.chrome.com/docs/webstore/program-policies/mv3-requirements)
- [X Spam Filter README](https://github.com/ZPVIP/x-spam-filter#readme) · [Chrome Web Store listing](https://chromewebstore.google.com/detail/x-spam-filter/gpfkmempinhlopfkomklkkbdeggaknmo)
- [X(Twitter) Comment Blocker README](https://github.com/amahteru/x-comment-blocker#readme) · [Chrome Web Store listing](https://chromewebstore.google.com/detail/xtwitter-comment-blocker/gagacedifiphcndckimeihhcbcclkach)
- [Control Panel for Twitter README/issues](https://github.com/insin/control-panel-for-twitter) · [Product site](https://soitis.dev/control-panel-for-twitter)
- [Make X Great Again README/issues](https://github.com/foru17/make-x-great-again) · [Chrome Web Store listing](https://chromewebstore.google.com/detail/make-x-great-again/aeoldnecphbkkckeedfgfcdcekkljdea)

