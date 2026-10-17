# Academic Pages Studio

本地优先的桌面编辑器，用于撰写 Markdown 笔记/日志，并把内容按 [Academic Pages](https://github.com/academicpages/academicpages.github.io)（Jekyll + Minimal Mistakes）的目录与 Front Matter 规范同步到 GitHub 博客仓库。

![编辑器](docs/screenshot-editor.png)

- **本地优先**：断网可编辑、可保存；"仅提交到本地"与"提交并推送"是两个独立动作。
- **不破坏配置**：`_config.yml` 用"行区间手术"改写，**注释、对齐、键顺序、其余块逐字节保留**，只替换你改动的那一个值（连 CRLF 也不改）。
- **规范由应用保证**：`YYYY-MM-DD-slug.md` 文件名、`_drafts/` 草稿流、`images/` 图片路径、各内容类型的 Front Matter 字段都来自仓库里真实的 `_layouts/` 与 `_config.yml` 约定。
- **Token 不落地到仓库**：Windows DPAPI / macOS Keychain / Linux libsecret（Electron `safeStorage`）；网络操作走 `isomorphic-git`，Token 不进入 `.git/config`、命令行参数或临时文件。

## 功能

| 视图 | 能力 |
| --- | --- |
| 文档 | 按内容类型（博客 / 页面 / 出版物 / 报告 / 教学 / 自有集合）分目录；草稿与已发布分组；搜索；新建时自动补日期前缀 |
| 编辑器 | Front Matter 表单（含 `_config.yml` defaults 注入提示）+ CodeMirror 6 分屏预览 + 图片拖拽/粘贴入库 + 重命名 / 删除 / 发布草稿 |
| 个人资料 | `author:` 全字段分组编辑、头像上传、学术链接、空值不显示图标；保存前可看行级 diff |
| 导航栏 | `main:` 条目增删改、拖拽/上下移排序；删除只影响顶栏，不删页面 |
| 我的分区 | 一次生成 `collections` + `defaults` + `_pages/<slug>.html` + 导航条目，先预览四个文件再落盘（带回滚） |
| 同步与发布 | 仓库状态、改动文件、提交信息、仅提交 / 提交并推送 / 拉取、冲突文件列表、Token 管理 |

## 快速开始

```bash
npm install          # 若 Electron 二进制下载超时：ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/
npm run dev          # Vite + Electron，开发模式（HMR）
npm start            # 构建渲染层后以生产模式启动
npm test             # 56 个单元/集成测试（含真实 git 远端）
```

打开应用后选择你的仓库目录（必须包含 `_config.yml`），例如：

```
My Github Repository/LiaoYutao1013.github.io/LiaoYutao1013.github.io
```

## 验证

```bash
npm test                                              # 56/56 通过（约 13s）
npm run smoke -- "C:\path\to\clone-of-your-blog"      # 只打印三类配置变更的 diff
npm run smoke -- "C:\path\to\clone-of-your-blog" --write   # 实际写入副本，再用 git diff 检查
```

`smoke` 在仓库副本上验证：author 单行改写、导航重排、新建分区四文件生成。实测 diff：
`_config.yml` +15/−1、`_data/navigation.yml` +9/−3，新增 `_pages/projects.html` 与 `_projects/.gitkeep`。

## 文档

- 完整技术方案、选型对比、架构、IPC 清单、数据模型、模块实现、风险分析：[`docs/DESIGN.md`](docs/DESIGN.md)
- 界面截图见 `docs/screenshot-*.png`。

## 环境提示

- 需要 Node.js ≥ 20 与系统 `git`（本地操作使用系统 git；推送使用纯 JS 的 isomorphic-git）。
- 若环境变量里有 `ELECTRON_RUN_AS_NODE=1`，`npm run dev` / `npm start` 已在启动脚本里剔除，否则 Electron 会以 Node 模式运行、不显示窗口。
- GitHub Token 建议使用 **Fine-grained PAT**，仅授权目标仓库的 `Contents: Read and write`。
- 预览器是 marked（不执行 Liquid / kramdown 扩展），不能替代 `jekyll serve` 的最终渲染。
