# Academic Pages Studio — 技术方案与架构设计

> 目标仓库：`LiaoYutao1013/LiaoYutao1013.github.io`（Academic Pages / Jekyll + Minimal Mistakes）
> 应用代码：本目录（Electron 主进程 + React 渲染进程，Node 20+）
> 本文所有字段、目录与模板均以该仓库的真实文件为准（`_config.yml`、`_data/navigation.yml`、`_layouts/`、`_includes/author-profile.html`），未虚构配置项。

---

## 0. 交付概览

| 交付物 | 位置 | 说明 |
| --- | --- | --- |
| 技术方案 / 架构 / 风险 | `docs/DESIGN.md`（本文） | 选型对比、架构图、IPC 清单、数据模型、风险 |
| 主进程 | `src/main/` | 文件系统、YAML 手术、Git、密钥、IPC |
| 渲染进程 | `src/renderer/` | React 18 + CodeMirror 6，五类视图 |
| 测试 | `tests/`（56 用例） | 真实 `_config.yml` 快照、真实 git 远端（fetch/rebase/push/冲突） |
| 验证脚本 | `scripts/smoke.mjs` | 在仓库副本上预览/应用三类配置变更并输出 diff |
| 启动脚本 | `scripts/dev.mjs` | Vite + Electron 一次拉起 |

---

## 1. 技术选型对比与最终结论

### 1.1 桌面框架：Electron vs Tauri

| 维度 | Electron | Tauri 2 |
| --- | --- | --- |
| 运行时 | 自带 Chromium + Node.js | 系统 WebView + Rust 核心 |
| 安装包 | ~120 MB | ~10 MB |
| 本应用逻辑落点 | 90% 在 Node 侧（fs / YAML / git / 进程） | 需 Rust 实现或 sidecar；JS 侧只能做 UI |
| 关键能力 | `safeStorage`（系统钥匙串）、`shell.trashItem`、`dialog` 开箱即用 | 需插件或自写 command |
| 攻击面 | 较大，必须 `contextIsolation` + `sandbox` + CSP | 权限模型更细，默认更收敛 |
| 构建链 | 仅需 Node | 需 Rust 工具链（Windows 还要 MSVC） |
| 调试 | DevTools 与 Node 一致 | WebView 调试因平台而异 |

**结论：Electron。** 本应用不是"展示型"应用，而是**文件与 Git 的工具**：读写 361 行的 `_config.yml`、运行 git、管理 Token。这些能力在 Node 生态里成熟且可测试；换 Tauri 只会把同一批逻辑推到 Rust/sidecar 边界，收益（体积）与成本（重写 + 双栈维护 + Windows 构建链）不匹配。体积敏感不是本项目的主要矛盾。

### 1.2 前端框架：React vs Vue

两者都能胜任，这里选 **React 18**：

- 本应用是"表单密集 + 一个命令式编辑器"的混合体。CodeMirror 6 是命令式 API，需要 `useRef` + `useEffect` 精确控制实例生命周期；React 的 ref/effect 模型与它对接直接，不需要把 CM 包成响应式对象。
- Diff 预览、文件树、文档列表等都需要细粒度条件渲染，JSX 比模板指令更少心智负担。
- 生态上 `marked`、`dompurify`、CodeMirror 都是框架无关的，不构成偏好理由；真正的理由是团队与代码风格一致。

Vue 3 + `<script setup>` 同样可行，没有技术性阻断点。**这是可替换决策，不是架构约束。**

### 1.3 编辑器：CodeMirror 6 vs Monaco

| 维度 | CodeMirror 6 | Monaco |
| --- | --- | --- |
| 体积 | 按需组合，~200 KB | 数 MB + worker |
| Markdown 支持 | 一等公民（`@codemirror/lang-markdown`） | 基础语法高亮 |
| 中文 IME | 好（CM6 重写了输入法组合处理） | 好，但更重 |
| 扩展方式 | Extension 组合，写拖拽/快捷键很轻 | 配置项多，定制成本高 |
| 适用场景 | 轻量文本编辑器 | 完整 IDE（TS 语言服务、调试） |

**结论：CodeMirror 6。** 我们只需要 Markdown 编辑、快捷键、拖拽插图与受控内容同步，不需要语言服务器；CM6 的体积与 IME 表现更适合"笔记"场景。

### 1.4 Markdown 渲染：marked vs remark

| 维度 | marked | remark / unified |
| --- | --- | --- |
| 体积/速度 | 小、同步解析、快 | 插件化，AST 链路更重 |
| 扩展 | 自定义 renderer 即可 | 生态强（mdast 插件） |
| 本项目需求 | GFM 表格、代码块、标题、脚注（可选） | 相同 |

**结论：marked + DOMPurify。** 实时预览是"写作参考"，不是 Jekyll 渲染器：它不执行 Liquid、不实现 kramdown 的 `{: .notice}` 属性列表与 `^` 脚注等扩展。这一点在 UI 中明确标注（见 §5.11），避免用户误以为预览即线上效果。

### 1.5 Git：系统 git vs isomorphic-git（混合方案）

| 维度 | 系统 `git` | isomorphic-git |
| --- | --- | --- |
| 依赖 | 需安装 git | 纯 JS，零依赖 |
| 速度 | 快（C 实现） | 慢（JS 解析 pack，大仓库明显） |
| 索引/钩子/属性 | 完整（`core.autocrlf`、hooks、LFS） | 部分或不支持 |
| 冲突与 rebase | 完整 | 有限 |
| HTTPS + PAT | Token 需进 remote URL / argv / askpass 脚本 | `onAuth` 内存回调，**Token 不落盘** |
| SSH | 直接支持（ssh-agent） | 不支持 |
| 注入风险 | 子进程，必须用参数数组 | 无子进程 |

**最终方案：混合。**

- **本地操作**（`status` / `diff` / `add` / `commit` / `rebase` / `log`）→ 系统 git。这些操作需要正确维护索引、尊重 `autocrlf`，系统 git 更可靠。
- **带凭据的网络操作**（`push` / `fetch`）→ 有 Token 时走 isomorphic-git。这是唯一能让 PAT **不进入** `.git/config`、命令行参数、`GIT_ASKPASS` 临时脚本的路径。
- **无 Token 时** → 系统 git（`ssh-agent` 或系统凭据管理器），因此 **SSH 密钥方案天然可用**，只是应用不管理 SSH key 本身。

代价：两条路径的行为差异（例如 isomorphic-git 不更新远端跟踪引用，我们在 push 后用 `git update-ref` 补齐）。测试覆盖了本地 bare remote 上的 fetch → rebase → push → 冲突全链路。

### 1.6 YAML 保真：js-yaml vs `yaml`(CST) vs 行区间手术

这是本项目**最关键**的选型。

| 维度 | js-yaml（parse→dump） | `yaml` (eemeli) Document API | 行区间手术（本项目） |
| --- | --- | --- | --- |
| 注释 | **全部丢失** | 保留节点注释 | **完全保留** |
| 空行/对齐 | 重排 | 可能重排 | 不变 |
| 键顺序 | JS 对象顺序 | 保留 | 保留 |
| 未识别字段 | 取决于合并逻辑 | 保留 | 不动 |
| 变更范围 | 整个文件 | 整个文件 | **仅目标行/块** |
| 风险 | 一次 dump 破坏全文件 | 节点放置错误全局扩散 | 手术函数错误局部可见 |
| 代码量 | 低 | 中 | 中（约 400 行 + 独立回归测试） |

**结论：读用 js-yaml，写用行区间手术。**

- `js-yaml` 负责**解析与校验**（`yaml.load`），拿到 `author`、`collections`、`defaults` 的真值。
- 写入时**绝不 `dump` 整个文件**，而是：
  1. `locateBlock` 找到顶层块（`author:` / `collections:` / `defaults:` / `main:`）的行区间；
  2. 对 `author` 这类标量映射，`setMappingValues` 只替换每行"值 token"，保留原前缀（缩进 + 键 + 对齐空格 + 引号风格 + 行尾注释）；
  3. 对 `collections` / `defaults`，`appendMappingEntry` / `appendSequenceEntry` 在块末尾插入新条目；
  4. 对 `navigation` 的 `main:` 列表，`replaceBlockBody` 只替换该块体，块外 9 行注释原样保留。

**为什么不用 `yaml` 的 CST**：它确实保留注释，但仍然"重写整个文档"——空行、对齐、引号风格会漂移，而且任何节点放置 bug 都会波及全文。本应用需要的编辑动作只有四类，全部是局部操作；把爆炸半径限制在"我打算改的那几行"比追求通用 CST 更可靠，也更容易用测试证明。

实测 diff（在你仓库的克隆上运行 `npm run smoke`）：

```diff
@@ -25,7 +25,7 @@ author:
   # Biographic information
   avatar           : "My_Selfish.jpg"
   name             : "Liao Yutao"
-  pronouns         :
+  pronouns         : he/him
   bio              : "Undergraduate student at South China University of Technology, ..."
```

只改一行；注释、对齐、引号、CRLF 全部保持。

### 1.7 Token 存储：keytar vs Electron safeStorage

| 维度 | keytar | `safeStorage`（选用） |
| --- | --- | --- |
| 形态 | 原生模块 | Electron 内置 |
| 构建 | 需按 Electron ABI 重编译（node-gyp / MSVC） | 无 |
| 后端 | 系统钥匙串 | Windows DPAPI / macOS Keychain / Linux libsecret |
| 维护状态 | 社区维护，历史上长期停滞 | 随 Electron 发布 |
| 失败回退 | 需自己处理 | 可检测 `isEncryptionAvailable()` |

**结论：`safeStorage` + 加密文件。** Token 用 `safeStorage.encryptString()` 加密后写入 `userData/credentials.json`（0600）；若系统加密不可用，**只在内存保存并在 UI 明示**，绝不写明文。

---

## 2. 应用架构

### 2.1 进程与模块图（文字版）

```
┌──────────────────────── Renderer（Chromium，sandbox）────────────────────────┐
│ React 18                                                                     │
│  ├─ 视图：文档 / 个人资料 / 导航栏 / 我的分区 / 同步与发布                    │
│  ├─ CodeMirror 6（Markdown + 拖拽插图）                                      │
│  ├─ marked + DOMPurify（实时预览）                                           │
│  └─ DiffView（FilePreview.hunks 渲染）                                       │
│  能做的只有 window.studio.*；没有 Node、没有 fs、没有 Token                   │
└───────────────────────────────┬──────────────────────────────────────────────┘
                                │ contextBridge（preload.cjs，sandbox:true）
                                │ invoke(channel, payload)
                                │ ← {ok:true,data} | {ok:false,error:{code,message,details}}
┌───────────────────────────────▼──────────────────────────────────────────────┐
│ Main（Node.js）                                                              │
│  ipc/handlers.js        通道注册、参数校验、编排、错误归一、进度事件           │
│  config/                                                                     │
│    siteConfig.js        读取 _config.yml、校验仓库、defaults 合并             │
│    yamlText.js          ★ 行区间手术（locateBlock/setMappingValues/append…）  │
│    authorService.js     author 字段模型、校验、补丁                           │
│    navigationService.js main 列表解析/序列化/排序/校验                        │
│    collectionsService.js 四文件模板生成、预览、回滚写入                       │
│  content/                                                                    │
│    frontmatter.js       --- 分隔、解析、序列化、defaults 注入                 │
│    templates.js         内容类型字段表（post/page/publication/talk/…）        │
│    contentService.js    列表/读取/新建/保存/重命名/删除/草稿发布              │
│    assetsService.js     images/ files/ 导入、Markdown 片段生成                │
│  git/                                                                        │
│    gitRunner.js         spawn 参数数组、stdin 提交信息、超时                   │
│    isoGit.js            isomorphic-git push/fetch（onAuth 内存凭据）          │
│    gitService.js        status/commit/rebase/push/sync、冲突归一              │
│  security/credentialStore.js  safeStorage 加解密、内存回退                    │
│  util/                  fsSafe（原子写/回滚/路径约束）、lineDiff、settings     │
└───────────────┬──────────────────────────────────┬───────────────────────────┘
                │ execFile('git', args[])           │ HTTPS + PAT
        ┌───────▼────────┐                  ┌──────▼──────────────┐
        │ 系统 git 2.x    │                  │ GitHub API/仓库      │
        └───────┬────────┘                  └─────────────────────┘
                │
        ┌───────▼──────────────────────────────────────────────────┐
        │ 本地 Jekyll 仓库：_config.yml / _data/navigation.yml /    │
        │ _posts / _drafts / _pages / _talks / _publications / …    │
        └──────────────────────────────────────────────────────────┘
```

### 2.2 职责边界

| 能力 | 主进程 | 渲染进程 | 理由 |
| --- | --- | --- | --- |
| 文件读写 | ✅ | ❌ | 需要路径约束、原子写、mtime 冲突检测 |
| YAML 解析/改写 | ✅ | ❌ | 保真逻辑必须单点、可测试 |
| Front Matter 组装 | ✅ | ❌ | 依赖 `_config.yml` defaults 与类型字段表 |
| Git 全部操作 | ✅ | ❌ | 凭据、子进程、冲突处理 |
| Token | ✅（加密存储） | ❌ 永不可见 | 最小暴露面 |
| Markdown 编辑/预览 | ❌ | ✅ | 纯 UI |
| 表单与校验提示 | ❌ | ✅（后端仍复验） | 即时反馈；**后端是最终裁判** |
| 差异预览 | 生成 diff 数据 | 渲染 | 主进程持有 before/after |

渲染进程拿不到 `ipcRenderer`、`require`、`fs`、`process`；preload 只暴露一组语义化方法（见 `src/main/preload.cjs`）。所有 IPC 返回统一信封，错误带稳定 `code`。

### 2.3 进程安全策略

`src/main/main.js`：

```js
webPreferences: {
  preload: path.join(__dirname, 'preload.cjs'),
  contextIsolation: true,
  nodeIntegration: false,
  sandbox: true,
  spellcheck: true,
}
```

- `session.defaultSession.setPermissionRequestHandler((_wc, _p, cb) => cb(false))`：拒绝摄像头/麦克风/通知等一切权限。
- `setWindowOpenHandler` 拒绝新窗口，`http(s)` 交给系统浏览器；`will-navigate` 阻止应用内跳转（防止被 Markdown 里的链接劫持成远程页面）。
- `index.html` 内 CSP：`default-src 'self'; script-src 'self'; img-src 'self' data: https:; connect-src 'self'`。
- 路径一律经 `resolveInside(root, rel)`，拒绝 `..` 逃逸与绝对路径。
- Token 只在主进程解密使用；IPC 没有"取 Token"通道（只有 set/status/clear）。
- `app:openExternal` 只允许 `http(s)`。

### 2.4 数据流

**内容发布（文档 → 线上）**

```
新建/编辑 → docs.save
  → splitDocument 保留正文
  → buildFrontMatter（defaults 注入 + 模板字段 + 用户额外字段）
  → serializeDocument（date 去引号）
  → 原子写（tmp + rename）+ expectedMtimeMs 守卫
→ 同步页 git.status（主进程实时读）
→ git.commit（系统 git add/commit）
→ git.sync：
      commit（如有未提交）
      → fetch（isomorphic-git，有 Token）
      → rebase origin/<branch>（系统 git；冲突则 abort 并返回冲突文件）
      → push（isomorphic-git）→ 更新本地远端跟踪引用
→ 返回 {committed, rebased, pushed, status}
```

**配置变更（个人资料 / 导航 / 分区）**

配置变更与内容发布**刻意分开**：

1. 任何配置页面点击"保存"前，先调用 `preview`，主进程用**纯函数**算出 `after` 文本，返回 `FilePreview[]`（含行级 diff）。
2. 用户在 Diff 弹窗确认后才 `apply`（原子写）。
3. `apply` 只写文件，**不提交、不推送**；用户再到"同步与发布"统一 review 后提交。

理由：`_config.yml` 是站点全局单点，误改会影响所有页面；预览 + 二次确认 + 统一提交，比"点保存就 push"安全得多。

### 2.5 IPC 接口清单

所有通道：`invoke(channel, payload)`，返回 `{ok:true,data}` 或 `{ok:false,error:{code,message,details}}`。

**工作区**

| 通道 | 参数 | 返回 |
| --- | --- | --- |
| `workspace:init` | – | `{repoPath, recentRepos, token, encryptionAvailable, gitAvailable, contentDirs}` |
| `workspace:choose` | – | `{canceled, repoPath?}`（系统目录选择器） |
| `workspace:open` | `{repoPath}` | `{root, name, site, contentTypes, contentDirs, counts, git, gitError, token}` |
| `workspace:forget` | – | `{ok}` |

**个人资料**

| 通道 | 参数 | 返回 |
| --- | --- | --- |
| `config:author:get` | – | `{fields, groups, values, extras}` |
| `config:author:preview` | `{values}` | `{files, warnings, changedKeys}` |
| `config:author:apply` | `{values}` | `{files, warnings, changedKeys, path}` |

**导航栏**

| 通道 | 参数 | 返回 |
| --- | --- | --- |
| `nav:get` | – | `{items, blankBetween}` |
| `nav:preview` | `{items}` | `{files, warnings, items}` |
| `nav:apply` | `{items}` | `{files, warnings, items}` |

**自定义分区**

| 通道 | 参数 | 返回 |
| --- | --- | --- |
| `collection:check` | `CollectionInput` | `{errors, warnings}` |
| `collection:preview` | `CollectionInput` | `{plan, errors, warnings, files}` |
| `collection:apply` | `CollectionInput` | `{plan, paths}` |

**文档**

| 通道 | 参数 | 返回 |
| --- | --- | --- |
| `doc:list` | `{typeId?}` | `{docs, types, config}` |
| `doc:read` | `{path}` | `DocumentDetail`（含 `flatData`、`spec`、`inherited`） |
| `doc:create` | `{typeId,title,slug?,date?,draft?,values?,body?}` | `{doc, types}` |
| `doc:save` | `{path,values,body,frontMatterText?,expectedMtimeMs?}` | `{doc}` |
| `doc:rename` | `{path,slug?,date?}` | `{doc}` |
| `doc:delete` | `{path}` | `{ok, trashed, path}`（走系统回收站） |
| `doc:publish` | `{path,date?,slug?}` | `{doc}` |
| `doc:suggestPath` | `{typeId,title,date?,draft?}` | `{slug,path,available}` |

**资源**

| 通道 | 参数 | 返回 |
| --- | --- | --- |
| `asset:import` | `{sourcePath?,dataBase64?,fileName,alt?,kind?}` | `{kind,name,repoPath,url,plainUrl,markdown,bytes}` |
| `asset:avatar` | `{sourcePath?,dataBase64?,fileName}` | `{name,repoPath,plainUrl}` |
| `dialog:pickFile` | `{kind:'image'|'any'}` | `{canceled,sourcePath?,fileName?}` |
| `app:reveal` | `{path}` | `{ok,path}` |

**Git**

| 通道 | 参数 | 返回 |
| --- | --- | --- |
| `git:status` | – | `GitStatus` |
| `git:diff` | `{paths?,staged?}` | `{unstaged,staged}`（补丁文本） |
| `git:log` | `{limit?}` | `[{hash,shortHash,author,date,subject}]` |
| `git:commit` | `{message,paths?}` | `{committed,hash,message,nothingStaged?}` |
| `git:push` | – | `{ok,method,branch}` |
| `git:pull` | – | `{rebased,reason?}` |
| `git:sync` | `{message,pull}` | `{committed,commitHash,rebased,pushed,upToDate,status}` |

**密钥 / 应用**

| 通道 | 参数 | 返回 |
| --- | --- | --- |
| `secret:status` | – | `{hasToken,username,storage,encryptionAvailable}` |
| `secret:set` | `{token,username?}` | `{hasToken,storage,persisted}` |
| `secret:clear` | – | `{hasToken,storage}` |
| `app:info` | – | `{name,version,platform,userData,repoPath}` |
| `app:openExternal` | `{url}` | `{ok}` |
| `app:reveal` | `{path}` | `{ok, path}` |
| `window:state` | – | `{repoPath}` |

**主 → 渲染事件**：`git:progress` → `{stage, message}`（通过 `window.studio.onGitProgress` 订阅）。

**错误码**（`src/main/util/errors.js`）：`REPO_INVALID` `REPO_NOT_FOUND` `FILE_NOT_FOUND` `FILE_OUTSIDE_REPO` `FILE_CONFLICT` `CONFIG_BLOCK_MISSING` `CONFIG_KEY_MISSING` `CONFIG_DUPLICATE_KEY` `YAML_INVALID` `FRONT_MATTER_INVALID` `VALIDATION` `GIT_UNAVAILABLE` `GIT_ERROR` `GIT_AUTH_MISSING` `GIT_AUTH_FAILED` `GIT_CONFLICT` `GIT_NON_FAST_FORWARD` `CRYPTO_UNAVAILABLE` `UNKNOWN`。

---

## 3. 目录与数据模型

### 3.1 应用目录

```
AcademicPagesStudio/
├─ package.json                 Electron 33 / React 18 / Vite 5 / js-yaml / isomorphic-git
├─ vite.config.mjs              root=src/renderer, out=dist/renderer, base=./ (file:// 可用)
├─ scripts/
│  ├─ dev.mjs                   Vite createServer → spawn electron（剔除 ELECTRON_RUN_AS_NODE）
│  └─ smoke.mjs                 仓库副本上的三类变更 diff 演练
├─ src/main/
│  ├─ main.js                   窗口、菜单、单实例、安全策略、IPC 注册
│  ├─ preload.cjs               contextBridge API（sandbox 下 CJS）
│  ├─ ipc/handlers.js           38 个通道
│  ├─ config/…                  siteConfig / yamlText / author / navigation / collections
│  ├─ content/…                 frontmatter / templates / contentService / assetsService
│  ├─ git/…                     gitRunner / isoGit / gitService
│  ├─ security/credentialStore.js
│  └─ util/…                    errors / fsSafe / text / lineDiff / settings
├─ src/renderer/
│  ├─ index.html                CSP
│  └─ src/…                     main.jsx / App.jsx / components / lib / styles.css
├─ tests/                       56 用例 + fixtures（真实 _config.yml、navigation.yml）
└─ docs/DESIGN.md
```

### 3.2 被管理的仓库约定（实测）

| 路径 | 作用 | 应用如何写 |
| --- | --- | --- |
| `_config.yml` | 站点配置：`author:`、`collections:`、`defaults:` | 行区间手术，仅改目标值/追加条目 |
| `_data/navigation.yml` | `main:` 列表，顺序即顶栏顺序 | 只替换 `main:` 块体，保留 9 行注释前言 |
| `_posts/` | 博客文章 `YYYY-MM-DD-slug.md` | 新建/草稿发布 |
| `_drafts/` | 草稿（无日期前缀） | 新建草稿；发布时移动 |
| `_pages/` | 独立页面与 archive 页 | 新建页面；分区归档页 |
| `_publications/` `_talks/` `_teaching/` `_portfolio/` | 四个已有集合 | 集合条目 |
| `images/` | 头像、teaser、正文图片 | 拖拽导入 |
| `files/` | PDF、BibTeX 等附件 | 拖拽导入 |
| `_data/authors.yml` | 多作者数据（模板自带） | 不写；应用管理 `site.author` |

仓库中真实存在的默认值（应用会**自动注入**到新文件）：

```yaml
defaults:
  - scope: { path: "", type: posts }
    values: { layout: single, author_profile: true, read_time: true, comments: true, share: true, related: true }
  - scope: { path: "", type: pages }
    values: { layout: single, author_profile: true }
  - scope: { path: "", type: talks }
    values: { layout: talk, author_profile: true, share: true }
  # publications / teaching / portfolio 同理
```

### 3.3 核心类型（TS 语义，代码为 JS + JSDoc）

```ts
type ContentTypeId = 'post' | 'page' | 'publication' | 'talk' | 'teaching' | 'portfolio' | `collection:${string}`;

interface DocMeta {
  path: string;            // 仓库相对路径，'/' 分隔
  typeId: ContentTypeId | null;
  collection: string | null;
  draft: boolean;
  title: string;
  date: string;            // 'YYYY-MM-DD'
  slug: string;
  permalink: string | null;
  categories: string[];
  tags: string[];
  frontMatterError: { message: string; line: number | null } | null;
  size: number;
  mtimeMs: number;
}

interface FieldSpec {
  key: string;             // 支持 'header.teaser'
  label: string;
  type: 'text' | 'textarea' | 'date' | 'list' | 'select' | 'boolean' | 'url';
  required?: boolean;
  help?: string;
  options?: { value: string; label: string }[];
}

interface TypeSpec {
  id: ContentTypeId;
  label: string;
  dir: string;             // '_posts' | '_talks' | '_pages' | ...
  collection: string | null;
  defaultsType: string;    // 'posts' | 'talks' | ... 对应 defaults.scope.type
  datePrefix: boolean;
  draftable: boolean;
  fields: FieldSpec[];
}

interface DocumentDetail extends DocMeta {
  raw: string;
  frontMatterText: string;
  data: Record<string, unknown>;
  flatData: Record<string, unknown>;   // header.teaser 展开
  body: string;
  hasFrontMatter: boolean;
  spec: TypeSpec | null;
  inherited: Record<string, unknown>;
}

interface AuthorField {
  key: string;
  label: string;
  kind: 'text' | 'textarea' | 'url' | 'email' | 'username' | 'file';
  group: string;
  help?: string;
}

interface NavItem { title: string; url: string; [extra: string]: unknown }

interface CollectionPlan {
  label: string; title: string; permalink: string;
  dir: string; pagePath: string; archiveUrl: string;
  layout: 'single' | 'talk'; includeNav: boolean;
  intro: string; share: boolean; comments: boolean;
}

interface FilePreview {
  path: string;
  action: 'create' | 'update';
  before: string;
  after: string;
  diff: { hunks: { header: string; lines: { type: 'add'|'del'|'context'; text: string }[] }[]; added: number; removed: number; changed: boolean };
}

interface GitStatus {
  branch: string; upstream: string | null;
  ahead: number; behind: number; clean: boolean; hasCommits: boolean;
  remoteUrl: string | null;
  staged: StatusEntry[]; unstaged: StatusEntry[]; untracked: StatusEntry[];
  conflicts: string[];
}
```

### 3.4 配置实体的统一抽象

`author`、`navigation`、`collections` 三个配置实体看起来不同（映射 / 序列 / 映射+序列），但写入动作可归为三种原语：

| 原语 | 作用 | 使用者 |
| --- | --- | --- |
| `setMappingValues(text, block, patch)` | 就地替换块内标量值 | author（以及任何顶层映射块） |
| `appendMappingEntry(text, block, key, body)` | 在块末追加一个嵌套条目 | collections |
| `appendSequenceEntry(text, block, itemLines)` | 在块末追加一个序列项 | defaults |
| `replaceBlockBody(text, block, lines)` | 整体替换块体 | navigation `main:` |

所有原语都是 `string → string` 的纯函数，因此：
- 可以用**真实文件快照**做回归测试；
- 可以先算出 `after` 做预览，再决定是否落盘；
- 不依赖 Electron，可在 Node 里直接跑（`tests/` 就是这么做的）。

### 3.5 文档生命周期

```
          ┌────────────┐  docs.save   ┌───────────┐  git.commit  ┌────────────┐  git.push   ┌─────────┐
新建 ───▶ │  草稿      │ ───────────▶ │ 本地已修改 │ ───────────▶ │ 本地已提交 │ ──────────▶ │ 远端一致 │
          │ _drafts/   │              └───────────┘              └────────────┘             └─────────┘
          └─────┬──────┘                    ▲                          │
                │ doc:publish               │ 继续编辑                  │ 远端有新提交
                ▼                           └──────────────────────────┴──── fetch → rebase → push
          ┌────────────┐
          │ _posts/    │
          │ YYYY-MM-DD │
          └────────────┘
```

---

## 4. 核心模块实现

### 4.1 YAML 块级手术（`src/main/config/yamlText.js`）

块定位：块体从键行之后开始，到**第一个非空且缩进 ≤ 键缩进**的行结束。缩进为 0 的注释会终止块——这正是我们要的：`# Publication Category` 属于下一节，改写 `author:` 时不能吞掉它。

```js
export function locateBlock(lines, key, opts = {}) {
  const wantIndent = opts.indent ?? 0;
  const re = keyLineRegex(key);
  for (let i = 0; i < lines.length; i += 1) {
    const match = re.exec(lines[i]);
    if (!match || match[1].length !== wantIndent) continue;

    const keyIndent = match[1].length;
    let lastContent = i;
    for (let j = i + 1; j < lines.length; j += 1) {
      const line = lines[j];
      if (isBlank(line)) continue;
      if (indentWidth(line) > keyIndent) { lastContent = j; continue; }
      break;
    }
    return { key, keyLine: i, keyIndent, bodyStart: i + 1, bodyEnd: lastContent + 1 };
  }
  throw new AppError(codes.CONFIG_BLOCK_MISSING, `_config.yml 中找不到顶层块 "${key}:"`, { key });
}
```

就地改值：从行里拆出 `前缀`（缩进 + 键 + 对齐空格）、`值`、`行尾注释`，只重建值部分。空字段补空格、引号风格沿用原行：

```js
const token = formatScalar(value, entry.style);   // 'double' → JSON.stringify，'plain' → 必要时加引号
let head = entry.head;
if (token && !/[ \t]$/.test(head)) head += ' ';   // 原来是 `key:`，补一个空格，避免变成标量
const next = token
  ? `${head}${token}${entry.comment ? ` ${entry.comment}` : ''}`
  : entry.comment
    ? `${head}${/[ \t]$/.test(head) ? '' : ' '}${entry.comment}`
    : head.replace(/[ \t]+$/, '');
```

关键不变量（都有测试）：
1. 未编辑的行**逐字节不变**（含 CRLF、行尾空格、注释）。
2. 编辑行保留冒号对齐列（本仓库为第 19 列）、引号风格、行内注释。
3. 新增键追加在块内末尾，并按现有冒号列对齐。
4. 文件行数在"只改已有键"时不变。

`formatScalar` 处理 YAML 陷阱：`yes/no/on/off`（Psych 会转布尔）、纯数字、ISO 日期、以 `-?:#[]{}&*!|>'"%@`` 开头、含 `: ` 或 ` #`、首尾空格——都强制加双引号。

### 4.2 author 块保真读写（`src/main/config/authorService.js`）

字段表**逐项来自 `_includes/author-profile.html`**，并标注"模板按用户名拼接"还是"直接当 URL 用"：

```js
export const AUTHOR_FIELDS = [
  { key: 'avatar', label: '头像文件名', kind: 'file', group: '基本信息', help: '放在 images/ 下；模板自动拼 /images/' },
  { key: 'name', label: '姓名', kind: 'text', group: '基本信息' },
  { key: 'bio', label: '简介', kind: 'textarea', group: '基本信息' },
  { key: 'uri', label: '个人主页', kind: 'url', group: '基本信息' },
  { key: 'googlescholar', label: 'Google Scholar', kind: 'url', group: '学术主页' },
  { key: 'orcid', label: 'ORCID', kind: 'url', group: '学术主页' },
  { key: 'researchgate', label: 'ResearchGate', kind: 'url', group: '学术主页' },
  { key: 'pubmed', label: 'PubMed', kind: 'url', group: '学术主页' },
  { key: 'github', label: 'GitHub', kind: 'username', group: '代码与作品', help: '只填用户名，模板拼 https://github.com/{{value}}' },
  { key: 'steam', label: 'Steam', kind: 'username', group: '社交媒体', help: '本仓库模板拼 steamcommunity.com/id/{{value}}' },
  // …共 43 个字段，与模板一一对应
];
```

写入流程：`readAuthor`（js-yaml 取真值 + 找未知键）→ 合并补丁 → `validateAuthor`（邮箱/头像路径/URL 类型）→ `setMappingValues`。

```js
export function updateAuthor(configText, patch) {
  const { values } = readAuthor(configText);
  const merged = { ...values };
  for (const [key, value] of Object.entries(patch)) {
    merged[key] = key === 'avatar' ? normalizeAvatarName(value) : value;
  }
  const { errors, warnings } = validateAuthor(merged);
  if (errors.length) throw new AppError(codes.VALIDATION, errors[0].message, { errors, warnings });

  const result = setMappingValues(configText, 'author', cleanPatch);
  return { text: result.text, changedKeys: result.changedKeys, warnings };
}
```

- 头像上传：`asset:avatar` 把图片以冲突安全的名字写入 `images/`，返回 `name`，前端回填 `author.avatar`（`images/` 前缀会被 `normalizeAvatarName` 去掉）。
- **发现并提示的真实问题**：该仓库 `steam` / `zhihu` 填的是完整 URL，但 `author-profile.html` 按用户名拼接，会生成 `steamcommunity.com/id/https://...` 这类坏链接。应用把这类字段标为 `username` 并在填写 URL 时给出警告（不阻断保存，因为现状如此）。
- 空值：写入 `field:`（保持行内注释），模板 `{% if author.x %}` 为假 → 图标不显示，符合"留空不显示图标"。

### 4.3 navigation 增删改排序（`src/main/config/navigationService.js`）

读取用 `js-yaml` 验证结构；写入整体替换 `main:` 块体，保留块外注释与空行风格：

```js
export function updateNavigation(text, items, opts = {}) {
  const normalized = normalizeItems(items);            // trim；内部链接补 '/'
  const { errors, warnings } = validateNavigation(normalized);
  if (errors.length) throw new AppError(codes.VALIDATION, errors[0].message, { errors, warnings });

  const blankBetween = opts.blankBetween ?? detectBlankBetween(text);  // 沿用文件原有空行风格
  const body = serializeNavigation(normalized, { blankBetween });
  return { text: replaceBlockBody(text, 'main', body), items: normalized, warnings };
}
```

- 排序：前端 HTML5 拖拽 + 上移/下移按钮，`moveItem` 纯函数；顺序即 `main:` 顺序，即顶栏顺序（`_includes/masthead.html` 直接遍历）。
- 删除：仅移除 `main:` 条目；`_pages/` 文件不受影响（UI 明确说明）。
- URL 校验：内部链接必须以 `/` 开头（自动补全并提示）；外部仅允许 `http(s)`；拒绝 `javascript:`/`data:` 等 scheme；空格报错；重复 URL 仅警告。
- 嵌套 `children`：模板支持，但本应用不编辑；检测到对象值会给出"保存时忽略"的警告，而不是静默丢弃。

### 4.4 自定义集合（分区）创建（`src/main/config/collectionsService.js`）

一次创建要**原子地**改四个地方。先 `planCollection`（纯函数）生成计划，`previewCollection` 产出四个文件内容与 diff，`applyCollectionPlan` 在回滚事务里写入。

**① `_config.yml` → `collections:` 追加**（模板生成后由 `appendMappingEntry` 插入）

```yaml
  # Projects
  projects:
    output: true
    permalink: /:collection/:path/
```

**② `_config.yml` → `defaults:` 追加**（`appendSequenceEntry`，缩进取 `defaults:` 现有序列项的缩进 2）

```yaml
  # _projects
  - scope:
      path: ""
      type: projects
    values:
      layout: single
      author_profile: true
      share: true
      comments: true
```

**③ `_pages/projects.html`**（新建）

```html
---
layout: archive
title: "Projects"
permalink: /projects/
author_profile: true
---

{% include base_path %}

Selected engineering and software work.

{% for post in site.projects %}
  {% include archive-single.html %}
{% endfor %}
```

> `layout: talk` 的分区会自动改用 `archive-single-talk.html`（与 `_pages/talks` 的实现一致）。这里刻意复用仓库已有的 `layout: archive` 与 include，而不是发明新布局。

**④ `_data/navigation.yml` → `main:` 追加**

```yaml
  - title: "Projects"
    url: /projects/
```

同时创建 `_projects/.gitkeep`，让目录立刻存在（Jekyll 对空集合目录不做要求，但 git 不跟踪空目录，留 `.gitkeep` 便于提交）。

写入用 `withRollback` 包住三个文件：任一失败就恢复原内容/删除新文件：

```js
await withRollback(root, ['_config.yml', plan.pagePath, '_data/navigation.yml'], async () => {
  await writeTextFileAtomic(configAbs, nextConfig);
  await writeTextFileAtomic(pageAbs, archivePageSource(plan));
  if (nextNav !== null) await writeTextFileAtomic(navAbs, nextNav);
  await fs.mkdir(dirAbs, { recursive: true });
});
```

校验（`checkPlan`）：label 必须 `^[a-z][a-z0-9_-]{0,39}$`、不能是 Jekyll 保留字（`posts`/`pages`/`data`/…）、不能与现有集合重复、permalink 必须含 `:collection`、归档页文件不能已存在、导航 URL 不能重复。重复标题只警告（本仓库已有 `Projects → /portfolio/`，新建 `projects` 会产生同名导航项，UI 会提示）。

### 4.5 Front Matter 表单化（`src/main/content/templates.js`）

字段表对应仓库真实布局读取的键：

| 类型 | 目录 | 主要字段 | 自动注入的 defaults |
| --- | --- | --- | --- |
| `post` | `_posts/`（草稿 `_drafts/`） | `title` `date` `categories[]` `tags[]` `excerpt` `header.teaser` `header.overlay_image` `header.overlay_filter` `header.caption` `last_modified_at` | `layout: single` `author_profile` `read_time` `comments` `share` `related` |
| `page` | `_pages/` | `title` `permalink` `layout`(single/archive/splash/default) `author_profile` `sitemap` `redirect_from[]` `excerpt` | `layout: single` `author_profile` |
| `publication` | `_publications/` | `title` `date` `venue` `category` `excerpt` `citation` `paperurl` `slidesurl` `bibtexurl` `header.teaser` + `collection`/`permalink` | `layout: single` `author_profile` `share` `comments` |
| `talk` | `_talks/` | `title` `date` `type` `talk_type` `venue` `location` `excerpt` + `collection`/`permalink` | `layout: talk` `author_profile` `share` |
| `teaching` | `_teaching/` | `title` `date` `type` `venue` `location` `excerpt` + `collection`/`permalink` | `layout: single` `author_profile` `share` `comments` |

`publication.category` 的下拉项来自 `_config.yml` 的 `publication_category`（本仓库为 `books`/`manuscripts`/`conferences`），不是硬编码。`talk.type` 用于列表页（`archive-single-talk.html` 的 `{{post.type}}`），`talk_type` 用于详情页（`_layouts/talk.html` 的 `{{page.talk_type}}`）——这两个键在该模板里分工不同，应用都提供。

组装顺序：**defaults → 模板字段 → 计算键（collection/permalink）→ 用户手写额外字段**。空值被 `pruneEmpty` 丢弃；`false` 与 `0` 保留；`header` 子对象全空时整个丢弃。

```js
const data = buildFrontMatter({
  inherited: defaultsFor(config.defaults, { type: spec.defaultsType }),
  ordered: spec.fields,
  values,                                  // 'header.teaser' 这类扁平键
  computed: { collection: 'talks', permalink: '/talks/2025-11-06-my-talk/' },
  extra: extraKeys(currentData, managedKeys(spec)),  // 用户手写字段原样保留
});
```

序列化时把 js-yaml 给日期加的引号去掉（匹配仓库风格）：

```js
header = header.replace(/^(date|last_modified_at|published): '(\d{4}-\d{2}-\d{2})'$/gm, '$1: $2');
```

### 4.6 文件名与草稿

```js
// templates.js
if (draft) return `${slug}.md`;                        // _drafts/ 无日期前缀
if (spec.datePrefix) return `${date}-${slug}.md`;      // _posts/ _talks/ …
return `${slug}.md`;                                   // _pages/
```

- 博客文件名强制 `YYYY-MM-DD-slug.md`，日期来自表单（默认今天）。
- 同名自动 `-2`/`-3`，绝不覆盖。
- 草稿发布：`_drafts/slug.md` → `_posts/YYYY-MM-DD-slug.md`，同时把 `date` 写进 Front Matter，删除旧文件（先写新、再删旧，失败也不会丢内容）。
- 重命名：同步更新日期前缀与 YAML `date`，避免文件名与内容不一致。

### 4.7 图片拖拽（`src/main/content/assetsService.js` + `MarkdownEditor.jsx`）

- 图片 → `images/`，其他附件 → `files/`；单文件上限 25 MB。
- 文件名 sanitize 为 ASCII slug（保留扩展名），冲突自动加 `-2`。
- 生成的 Markdown：`![alt](/images/name.png)`；若 `baseurl` 非空则生成 `![alt]({{ '/images/name.png' | relative_url }})`，避免 GitHub Pages 项目站点的路径错误。
- Electron 32+ 移除了 `File.path`，preload 暴露 `webUtils.getPathForFile(file)`；剪贴板图片没有路径，则读成 base64 交给主进程。

### 4.8 Git 封装（`src/main/git/`）

提交信息通过 **stdin** 传给 `git commit -F -`，避免任何 shell 引号问题：

```js
const result = await runGitInput(root, ['commit', '-F', '-'], `${message}\n`, { timeout: 60_000 });
```

同步编排（`gitService.sync`）：**先提交，再拉取，再推送**。

```js
const commitResult = await commit(root, { message });          // 1. 本地提交（不会因为拉取失败而丢内容）
await fetchRemote(root, { token });                            // 2. 有 Token → isomorphic-git；否则系统 git
const rebaseResult = await rebaseOntoUpstream(root);           // 3. 落后则 rebase；冲突立即 abort 并抛出文件列表
await push(root, { token });                                   // 4. 推送；成功后 update-ref 补齐远端跟踪引用
```

冲突处理：`rebase` 失败后先 `git diff --name-only --diff-filter=U` 取冲突文件，再 `git rebase --abort`，抛出 `GIT_CONFLICT`（附 `files`）。工作区永远不会停在半合并状态——测试 `rebase conflicts abort cleanly` 验证了这一点。

非快进推送：识别 `rejected|non-fast-forward` → `GIT_NON_FAST_FORWARD`，UI 提示"先拉取合并"，**不提供强制推送**。

### 4.9 Token 安全（`src/main/security/credentialStore.js`）

```js
const encrypted = this.safeStorage.encryptString(token).toString('base64');
await fs.writeFile(this.file, JSON.stringify({ version: 1, tokenEnc: encrypted, username }), { mode: 0o600 });
```

- 无系统加密时：只存内存，`status()` 返回 `storage: 'memory'`，UI 显示"仅本次运行有效"。
- 渲染进程只能 `set/status/clear`，没有任何"读取 Token"通道。
- 有 Token 时，push/fetch 走 isomorphic-git 的 `onAuth` 回调，Token 不进入 `.git/config`、不进入 argv、不写临时脚本。
- 已保存 Token 但 `_config.yml` 里 remote 是 `https://user:token@github.com/...` 时，Token 会留在 `.git/config`；应用会在同步页提示改为不带凭据的 URL（规避建议见 §5.5）。

### 4.10 渲染进程要点

- **CodeMirror 生命周期**：每个文档挂载一次 `EditorView`，外部值变化时用事务同步，避免每敲一个字重建实例（否则会丢光标/输入法状态）。
- **Front Matter 表单**：`spec.fields` 驱动，`inherited` 以只读 chip 展示并标注"来自 `_config.yml` defaults，已自动写入"。
- **差异预览**：主进程返回 `FilePreview[]`，`DiffView` 渲染 hunk 行号与 `+/-` 着色；确认后才 apply。
- **图片拖放**：`dragover` 阻止默认、`drop` 取文件 → `assets.pathForFile` → `assets.import` → 在光标处插入 `result.markdown`。
- **预览**：`marked.parse` → `DOMPurify.sanitize` → `dangerouslySetInnerHTML`；CSP 禁止内联脚本，Liquid 标签按纯文本显示（符合"预览非 Jekyll"的定位）。

### 4.11 测试

`npm test` → 56 用例、5 个测试文件，全部通过（约 13 s，其中 git 集成占约 10 s）：

| 文件 | 覆盖 |
| --- | --- |
| `tests/author.test.js` | 只改目标行、注释/对齐/引号/CRLF 保持、清空保留注释、缺键追加对齐、未知键保留、头像规范化、校验 |
| `tests/navigation.test.js` | 排序、增删、前言注释保留、空行风格、危险 scheme 拒绝、重复 URL 警告、含 `:`/`&` 标题加引号 |
| `tests/collections.test.js` | 模板内容、四文件预览、真实落盘、重复创建失败、YAML 仍合法、顶层键不变 |
| `content.test.js` | posts/talks/pages 命名与 defaults 注入、草稿发布、额外字段保留、mtime 冲突、列表、重命名、类型识别、扁平 header |
| `git.test.js` | status/commit/log、diff、merge 冲突识别、本地 bare remote 的 fetch→rebase→push、rebase 冲突回滚 |
| `frontmatter.test.js` | 分隔/序列化、日期去引号、错误上报、defaults/嵌套/额外字段、标量引号、slug、行 diff |

真实仓库的 `_config.yml`、`_data/navigation.yml` 已快照到 `tests/fixtures/`，测试不依赖、也不修改你的工作区。

### 4.12 界面实录

以下截图由真实 Electron 进程渲染（`STUDIO_SMOKE=1` 启动后 `capturePage()`），仓库为本文所述仓库的克隆。

**工作区 / 文档列表**（草稿与已发布分组、分支与未提交提示）

![工作区](screenshot-workspace.png)

**编辑器**（Front Matter 表单 + defaults 只读 chip + CodeMirror 分屏预览）

![编辑器](screenshot-editor.png)

**个人资料**（按模板字段分组；头像单独一张卡片并支持上传）

![个人资料](screenshot-profile.png)

**导航栏**（拖拽/上下移排序，删除只影响顶栏）

![导航栏](screenshot-navigation.png)

**我的分区**（先说明会改哪四个文件，再生成并预览）

![我的分区](screenshot-collections.png)

**同步与发布**（状态、改动文件、提交信息、仅提交 / 提交并推送、Token 管理）

![同步与发布](screenshot-sync.png)

---

## 5. 关键风险与规避

| 风险 | 影响 | 规避方案 | 验证 |
| --- | --- | --- | --- |
| YAML 注释/格式丢失 | 配置 diff 不可读、误删说明 | 行区间手术；只改值 token；预览 diff 后才写 | `author.test.js` 逐行比对 + 真实 diff |
| YAML 语义陷阱（`yes/no`、日期、`key:value`） | 值被解析成布尔/日期，或整块损坏 | `formatScalar` 强制引号；空值补空格；CRLF 保持 | 标量测试 + CRLF 测试 |
| 键顺序/重复键 | Jekyll 行为变化 | 只追加、不重排；重复键写入前检查 | `collections` 顶层键不变 |
| Git 冲突 | 工作区半合并、内容丢失 | 先提交再 rebase；失败即 abort；返回冲突文件列表 | `rebase conflicts abort cleanly` |
| 非快进推送 | 覆盖远端提交 | 检测 `rejected` → 提示先拉取；无强制推送入口 | `git` 错误映射 |
| Token 泄漏 | 仓库/日志/进程列表泄露 | safeStorage；isomorphic-git `onAuth`；无读取通道；不写日志 | 代码审查 + 无 token 通道 |
| 远端 URL 内含凭据 | `.git/config` 明文 Token | 同步页提示；建议改用无凭据 URL | UI 提示 |
| 多文件写入中断 | 集合只建了一半 | `withRollback` 快照/恢复；原子写 tmp+rename | `apply` 测试 |
| 外部程序同时改文件 | 覆盖他人修改 | `expectedMtimeMs` 守卫 → `FILE_CONFLICT` | `content.test.js` |
| Jekyll 构建失败 | 线上 404/空白 | 严格校验 label/permalink/文件名；可选预跑 `bundle exec jekyll build` | 校验测试 |
| 预览与线上不一致 | 误判排版 | UI 标注"预览不执行 Liquid/kramdown 扩展"；不承诺像素级一致 | 文档 |
| 大文件/仓库配额 | Pages 构建/推送失败 | 25 MB 上限；提示 GitHub 100 MB 单文件限制 | `assetsService` |
| 时区/日期偏移 | 文章日期错一天 | 只写 `YYYY-MM-DD`；仓库 `timezone: Etc/UTC`，UI 说明 | 模板 |
| 嵌套导航 `children` | 保存时结构被抹掉 | 检测对象值 → 警告"保存时忽略"，不静默处理 | `navigation` 测试 |
| 中文路径/IME | 文件名乱码、输入丢字 | slug 允许 CJK；CM6 原生支持组合输入 | 手动验证 |
| 空仓库无 HEAD | 状态读取失败 | `symbolic-ref` 优先，`rev-parse` 兜底 | `git` 测试（空仓库初始化） |

**本仓库特有的两个坑（已在应用中体现）**

1. `_includes/author-profile.html` 把 `steam` / `zhihu` 当**用户名**拼接，而 `_config.yml` 里存的是完整 URL → 现有链接已坏。应用的字段模型标为 `username` 并警告，但不会擅自改你的数据。
2. `_layouts/talk.html` 用 `talk_type` 渲染副标题，而 `_includes/archive-single-talk.html` 用 `type` 渲染列表；两个键都提供，避免"填了 type 详情页却空白"。

---

## 6. 运行与验证

```bash
npm install            # Electron 下载超时可用 ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/
npm test               # 56/56 通过
npm run dev            # 开发模式
npm start              # 生产构建 + 启动
npm run smoke -- "<仓库副本>" --write   # 真实 diff 演练
```

已验证（本机，Node 22 / Electron 33.4.11 / git 2.x）：

- `npm test`：56 通过，0 失败。
- `npm run smoke -- <clone> --write`：`_config.yml` +15/−1、`_data/navigation.yml` +9/−3，新增 `_pages/projects.html`、`_projects/.gitkeep`；与预期一致。
- 主进程所有模块均通过真实文件与真实 git 仓库执行，不是 mock。

---

## 7. 后续可扩展

1. **Jekyll 预检**：提交前跑 `bundle exec jekyll build --safe`，把构建错误挡在推送之前（需要用户环境有 Ruby）。
2. **三路合并 UI**：目前冲突是"中止 + 列出文件 + 命令行解决"；可在主进程解析冲突标记做三方编辑。
3. **SSH 密钥管理**：当前依赖系统 ssh-agent；可加 `ssh-keygen` 引导与 `~/.ssh/config` 检查。
4. **LFS / 大附件**：图片可接 `git-lfs` 或转 WebP 压缩。
5. **多仓库/多作者**：`_data/authors.yml` 管理、站点切换。
6. **i18n**：UI 文案抽取，支持英文界面。
