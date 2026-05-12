---
name: paper-lens
description: "论文阅读助手：速览/精读/学习/展示四模式阅读 + 批量检索/批量下载。当用户提供论文 PDF、要求分析/阅读论文、说「帮我读这篇论文」「精读文档」「全文关键点梳理」「搜索/检索论文」、或粘贴多个 arXiv 链接时触发。"
---

# Paper Lens — 论文阅读 & 检索助手

通过不同的「镜头」阅读论文，支持批量检索和下载。

## 所有模式

| 模式 | 适合场景 | 耗时 | 交互方式 |
|------|----------|------|----------|
| **速览** | 快速判断是否值得深读 | 5分钟 | 一次性输出 |
| **精读** | 论文级精读文档，适合系统学习和发飞书 | 20-40分钟 | 一次性生成 + 可追问修改 |
| **学习** | 深度理解、实践落地 | 20-40分钟 | 多轮确认 |
| **展示** | 准备 slides 汇报 | 15-30分钟 | 逐页讨论 |
| **PDF 导出** | 导出排版精美的 PDF | 1分钟 | 一键导出 |
| **批量检索** | 按主题搜索论文 | 3-5分钟 | 表格 + 选择下载 |
| **批量下载** | 粘贴链接批量下载 | 1-3分钟 | 自动去重下载 |

---

## Phase -1: 环境探测（每次 skill 加载时执行）

**核心原则**：**不要主动打开任何浏览器窗口**。只探测 Web UI 是否已在运行，然后一次性告诉用户使用路径。用户如果没跑 Web UI，保持纯 CLI 模式继续；如果用户想启动 Web UI，只提示前端命令，因为前端 dev 脚本会自动启动并守护后端。

### Step 1: 轻量探测

```bash
# 前端（paper-lens-codex-web, Next.js，默认 3001）
WEB_UI=""
if curl -s -o /dev/null -w "%{http_code}" http://localhost:3001 2>/dev/null | grep -q "200"; then
  WEB_UI="http://localhost:3001"
fi

# 后端（paper-lens-codex backend, FastAPI，默认 8766）
BACKEND=""
if curl -s -o /dev/null -w "%{http_code}" http://localhost:8766/api/papers 2>/dev/null | grep -q "200"; then
  BACKEND="http://localhost:8766"
fi

# 是否能在工作目录或 ~/.codex 下找到 paper-lens-codex-web 项目
HAS_WEB_PROJECT="no"
if find . ~/.codex -path "*/paper-lens-codex/paper-lens-web/package.json" -not -path "*node_modules*" 2>/dev/null | head -1 | grep -q package.json; then
  HAS_WEB_PROJECT="yes"
fi

echo "WEB_UI=$WEB_UI"
echo "BACKEND=$BACKEND"
echo "HAS_WEB_PROJECT=$HAS_WEB_PROJECT"
```

### Step 2: 主动确保 frontend-slides skill 可用

展示模式会在生成 `slides-content.md` 后交给 `frontend-slides` 生成最终 HTML 演示文稿，因此每次加载 paper-lens 时都要轻量检查：

```bash
FRONTEND_SLIDES_SKILL=""
for d in \
  ".codex/skills/frontend-slides" \
  ".agents/skills/frontend-slides" \
  "$HOME/.codex/skills/frontend-slides" \
  "$HOME/.codex/skills/codex-primary-runtime/frontend-slides"
do
  if [ -f "$d/SKILL.md" ]; then
    FRONTEND_SLIDES_SKILL="$d"
    break
  fi
done

echo "FRONTEND_SLIDES_SKILL=$FRONTEND_SLIDES_SKILL"
```

处理规则：

| 状态 | 行为 |
|------|------|
| `FRONTEND_SLIDES_SKILL` 非空 | 继续正常流程；展示模式结束后可直接转交 `frontend-slides` |
| 当前仓库存在 `.codex/skills/frontend-slides/SKILL.md` | 视为已安装，不需要重复操作 |
| 当前项目根存在 `.agents/skills/frontend-slides/SKILL.md` 但 `.codex/skills/frontend-slides/` 不存在 | 主动执行 `mkdir -p .codex/skills && rsync -a .agents/skills/frontend-slides/ .codex/skills/frontend-slides/` 完成本仓库安装，然后继续 |
| 以上路径都不存在 | 明确告诉用户：`未找到 frontend-slides skill，展示模式仍会先生成 slides-content.md；生成后请先安装 frontend-slides，再继续生成 HTML 演示稿。` |

### Step 3: 根据探测结果给出提示（不自动 open）

根据 Step 1 输出，**只输出文字提示，不要执行 `open` 命令**：

| 状态 | 提示内容 |
|------|---------|
| `WEB_UI` 和 `BACKEND` 都活 | `Paper Lens (Codex) Web UI 已在运行 · http://localhost:3001 · 你可以打开浏览器继续，或继续在这里对话。` |
| 只有 `BACKEND` | `后端已运行。如果想用浏览器界面，运行 cd paper-lens-web && npm run dev；前端会复用现有后端。` |
| `HAS_WEB_PROJECT=yes` 但两者都不活 | `可选：运行 cd paper-lens-web && npm run dev 启动 Web UI；这个命令会自动启动并守护后端。或者继续在这里对话。` |
| `HAS_WEB_PROJECT=no` | 纯 CLI 模式，不提示 Web UI（如果想试 Web UI，可以 clone https://github.com/nekoneko0831/paper-lens-codex 仓库） |

### Step 4: 绝对禁止

- ❌ **绝对不要** 运行 `nohup python3 server.py &` 或任何后台启动命令
- ❌ **绝对不要** 运行 `open http://...` 或 `open -a Safari ...`
- ❌ **绝对不要** 提示用户手动启动后端作为常规路径；常规路径只说 `cd paper-lens-web && npm run dev`
- ❌ **绝对不要** 把"探测完成"当作一个已完成任务（它不是任务，只是环境检查）
- ❌ **绝对不要** 在 Phase -1 阶段创建 Task 条目

### Step 5: 继续正常流程

如果用户附带了论文参数（路径/URL），直接进入 Phase 0 解析论文。否则等待用户指令。

---

## Phase 0: 论文解析（所有模式共用）

### 0.1 获取论文 PDF

用户可能通过以下方式提供论文：

| 输入形式 | 处理方式 |
|----------|----------|
| 本地 PDF 路径 | 直接复制到 `paper-notes/<name>/paper.pdf` |
| arXiv URL（如 `https://arxiv.org/pdf/2506.07982`） | 用 `curl -L -o paper.pdf <url>` 下载 |
| arXiv abs URL（如 `https://arxiv.org/abs/2506.07982`） | 自动转换为 pdf URL 后下载 |
| 其他 URL（.pdf 结尾） | 用 `curl -L -o paper.pdf <url>` 下载 |

**下载命令**：

```bash
curl -L -o "paper-notes/<name>/paper.pdf" "<url>"
```

- 必须用 `-L` 跟随重定向
- 下载后用 PyMuPDF 验证文件有效性（`fitz.open()` 不报错即可）
- 如果下载失败，提示用户手动下载后提供本地路径

### 0.2 创建目录 + 提取内容

```bash
# 1. 创建标准目录
mkdir -p paper-notes/<name>/images

# 2. 提取全文文本
python3 -c "
import fitz
doc = fitz.open('paper-notes/<name>/paper.pdf')
text = ''
for i, page in enumerate(doc):
    text += f'\n\n===== PAGE {i+1} =====\n\n'
    text += page.get_text()
with open('paper-notes/<name>/extracted-text.md', 'w') as f:
    f.write(text)
doc.close()
"

# 3. 提取图片（动态定位脚本，兼容不同安装位置）
EXTRACT_SCRIPT=$(find .codex/skills/paper-lens/scripts ~/.codex/skills/codex-primary-runtime/paper-lens/scripts -name "extract_figures.py" 2>/dev/null | head -1)
python3 "$EXTRACT_SCRIPT" \
    paper-notes/<name>/paper.pdf \
    paper-notes/<name>/images/
```

### 标准输出目录

```
paper-notes/<paper-name>/
├── paper.pdf              # 原始论文
├── extracted-text.md      # 提取的全文文本
├── images/                # 提取的所有图表（矢量图 + 嵌入位图）
├── figures/               # 【展示模式】筛选后的关键图表（重命名为 fig1-xxx.png）
├── speed-read.md          # 速览模式输出
├── paper-reading.md       # 精读模式输出（论文级精读文档）
├── deep-learn.md          # 学习模式输出（增量保存，每步追加）
├── slides-content.md      # 展示模式输出
└── *.pdf                  # PDF 导出（与源 md 同名）
```

### 论文简称命名规则

- 小写，用 `-` 连接关键词
- 希腊字母写英文：`τ²-bench` → `tau2-bench`
- 特殊符号删除或转写：`@` → `at`，`#` → 删除
- 示例：`swe-compass`、`attention-is-all-you-need`、`tau2-bench`、`pass-at-k`

---

## Phase 1: 模式路由

**自动判断模式**（按优先级匹配）：

| 用户输入特征 | 进入模式 | 跳过 Phase 0 |
|-------------|---------|-------------|
| 包含「搜索/检索/survey/综述」+ 主题词 | **批量检索** | ✅ 是 |
| 包含 ≥2 个 arXiv URL 或 arXiv ID | **批量下载** | ✅ 是 |
| 包含「论文级精读文档/精读文档/全文关键点梳理/像 CodeTracer 那种飞书文档」 | **精读** | 视情况 |
| 提供单篇论文 PDF/URL | 进入 Phase 0 → 询问阅读模式 | ❌ 否 |

**阅读模式询问**（单篇论文解析完成后）：

> 论文已解析完成。你想用哪种模式来阅读？
>
> 1. **速览** — 5 分钟消化核心，快速判断值不值得深读
> 2. **精读** — 生成论文级精读文档，适合系统学习和发飞书
> 3. **学习** — 大白话深度理解，适合想真正搞懂这篇论文的人
> 4. **展示** — 准备一场论文讲解的 slides

**默认**：如果用户没有明确选择，默认使用速览模式。

**模式可串联**：用户可以先速览，觉得有价值再切换到精读、学习或展示模式。已有速览/学习/展示内容可被后续模式参考，但不能简单拼接。

---

## Phase 2: 执行模式

### 「结构化提问」是什么

在多个 references 里我们要求用「结构化提问」收集用户选择。Codex Web UI 使用 backend-owned 协议，不依赖 Default mode 下可能不可用的 `request_user_input`。

1. **Web UI 首选**：输出隐藏 fenced block，后端会拦截并转成前端 question card，不显示原始 JSON：

```paper_lens_question
{"questions":[{"id":"focus","header":"阅读重点","question":"你更想看哪类内容？","options":[{"label":"方法","description":"重点拆解方法流程"},{"label":"实验","description":"重点解读结果和指标"}],"multiSelect":true}]}
```

2. **纯 CLI 兜底**：把同样的问题列表渲染成 Markdown 嵌套清单（每组 ≤4 选项 + 一行「其他/自定义」），输出到对话里，等用户用普通文本回复。

每个问题至少包含 `id`、`header`、`question`、`options: [{label, description}]`、`multiSelect`。不论走哪条路：每组问题最多 4 个选项，按主题/关联分组；**始终保留「其他/自定义」** 让用户自由输入；术语英文必须带中文注释（≤8 字）。精读模式默认一次性生成，不强制结构化提问。

### 速览模式

加载 `references/speed-read.md` 执行。

核心输出：基本信息卡片 → 核心创新 → 主要方法 → 实验结果 → 总结与QA。

一次性输出到对话中，同时保存到 `paper-notes/<name>/speed-read.md`。

### 学习模式

加载 `references/deep-learn.md` 执行。

**核心体验：边学边存，随时可读。**

多轮交互流程：
1. 先输出速览内容（复用速览模式）→ 创建笔记文件
2. 名词提取 → **请求结构化用户输入**（codex `requestUserInput`，多选 + 自定义输入；或纯 CLI 下用 plain-text Markdown 列表 + 等用户回复）
3. 名词的大白话解释（英文术语后必须带中文注释）→ 追加到笔记
4. 核心方法的大白话拆解 → 追加到笔记
5. 公式确认 → **请求结构化用户输入** → 拆解后追加到笔记
6. 附录精华提炼 → 追加到笔记
7. 实践指导 → 追加到笔记

**关键机制**：
- **增量保存**：每个 Step 完成后自动追加到 `paper-notes/<name>/deep-learn.md`，用户全程可随时打开文件查看已学内容
- **交互选择**：术语和公式的确认环节优先使用 codex 的 `requestUserInput` 服务端请求（Web UI 会渲染成卡片选择，多选 + 自定义输入）；若运行在纯 CLI 且无前端，则 fallback 为 Markdown 列表 + 等待用户文本回复
- **全程可对话**：用户随时可用自然语言追问、补充术语、修改笔记、跳步或回溯，产生的新内容实时更新到笔记文件

### 精读模式

加载 `references/paper-reading.md` 执行。

**核心体验：一次性生成完整的论文级精读文档，后续可自然语言追问修改。**

执行说明：
- 输出固定保存到 `paper-notes/<name>/paper-reading.md`
- 可以复用已有 `speed-read.md` / `deep-learn.md` / `slides-content.md` 的理解和图表线索，但不得只拼接旧内容
- 图表、公式、指标解读必须顺着融入「方法拆解」「数据与实验设置」「实验结果分析」「局限与外推边界」等对应章节，不单独开“图表公式解读”大章节
- Q&A 只保留信息熵最高的 5-7 个问题
- Codex 版不为精读模式强制结构化提问，默认一次性生成；用户可在生成后继续要求修改、增删章节或改写风格

### 展示模式

加载 `references/present.md` 执行。

**核心体验：图文并茂的 slides 内容，可直接生成带原文图片的 HTML 演示文稿。**

多轮交互流程：
1. 展示规划（场景/时长/听众/重点）
2. **图表筛选与映射**（从提取的图片中识别论文原图，重命名到 `figures/` 目录）
3. 生成 slides 大纲（每页标注引用的图表）
4. 逐页内容讨论与确认
5. 输出 slides 内容文档（含图片路径引用）

**关键机制**：
- **图表映射**：从 `images/` 中识别论文原图（Figure 1, 2, 3...），复制并重命名到 `figures/` 目录（如 `fig1-architecture.png`），方便后续引用
- **HTML 生成交接**：slides-content.md 中用 `![描述](figures/xxx.png)` 引用图片；生成最终演示文稿时必须交给 `frontend-slides` skill 处理，由它负责视觉设计、图片 base64 嵌入和视口验证

最终保存到 `paper-notes/<name>/slides-content.md`。保存后必须明确提示用户：

> `slides-content.md` 已完成。接下来我会使用 `frontend-slides` skill 生成可直接打开的 HTML 演示稿。

**禁止**：paper-lens 自己手写 HTML/CSS/JS 演示稿、自己生成 `build-slides.py`、自己直接开发 deck。paper-lens 的职责到 `slides-content.md` 为止；最终演示稿必须由 `frontend-slides` skill 生成。

### 批量检索模式

加载 `references/batch-search.md` 执行。

**触发**：用户说"搜索 XXX 相关论文"、"检索 coding benchmark"、"帮我找 agent evaluation 的论文"等。

**核心流程**：WebSearch 搜索 arXiv → WebFetch 获取详情 → 生成表格 → 询问是否下载 → 调用批量下载。

输出到 `paper-notes/survey-<主题>/search-results.md`。

### 批量下载模式

加载 `references/batch-download.md` 执行。

**触发**：用户粘贴多个 arXiv 链接/ID，或从批量检索中选择论文。

**核心流程**：提取 URL/ID → 三层去重（输入/本地/arXiv ID）→ 获取标题 → 批量 curl 下载 → 生成汇总表格。

输出到 `paper-notes/batch-<日期>/download-summary.md`。

### PDF 导出

加载 `references/export-pdf.md` 执行。

**核心体验：一键将任意模式的 md 笔记导出为排版精美的 PDF。**

- 支持三种排版样式：学术风格（academic）、简洁风格（clean）、紧凑风格（compact）
- 自动嵌入图片（`figures/`、`images/` 目录下的引用图片）
- LaTeX 公式渲染为数学符号图片（需 matplotlib）
- 中英混排、表格、代码块均正确渲染
- 自动添加页码

触发方式：用户说"导出 PDF"、"生成 PDF"、"转 PDF" 等。

---

## 通用写作规范

### 必须做

- 用中文输出所有内容
- **所有英文术语后必须带中文注释**：如 `Pass@1（单次通过率）`、`Active Learning（主动学习）`、`SWE-bench（软件工程评测基准）`。中文注释不超过 8 个字，优先用通用译法
- 保持客观准确，基于论文内容分析
- 公式和符号严格对应论文原文

### 必须避免

- **AI 套话**：不说"本文的核心贡献是..."、"值得注意的是..."、"综上所述..."
- **空洞评价**：不说"这是一篇重要的工作"、"为该领域提供了新思路"
- **过度装饰**：不滥用 emoji、不每句话都加粗
- **不必要的第一人称**：不说"我认为..."、"我的理解是..."

### 大白话风格指南（学习模式核心）

- 想象你在给一个聪明但非本领域的朋友解释
- 先给直觉，再给细节
- 类比只用在真正抽象难懂的概念上，简单概念直接技术解释
- 每个概念最多一个比喻，一击即中，不堆叠多个类比
- 避免"翻译原文"，要"用自己的话重新讲"
- 不连续使用「打个比方」「简单来说」「就像」等过渡语

---

## 参考文件

- `references/speed-read.md` — 速览模式详细指令和输出模板
- `references/paper-reading.md` — 精读模式详细指令（论文级精读文档）
- `references/deep-learn.md` — 学习模式详细指令（名词提取、大白话拆解、公式解读、附录提炼）
- `references/present.md` — 展示模式详细指令（规划、大纲、逐页确认、输出规范）
- `references/export-pdf.md` — PDF 导出指令（样式选择、脚本执行）
- `references/batch-search.md` — 批量检索指令（WebSearch + WebFetch → 表格）
- `references/batch-download.md` — 批量下载指令（提取 URL → 去重 → curl 下载）
- `scripts/extract_figures.py` — 论文图片提取脚本（依赖 PyMuPDF）
- `scripts/md_to_pdf.py` — Markdown → PDF 转换脚本（依赖 PyMuPDF + markdown）

## 依赖

```bash
# 核心依赖
pip install pymupdf markdown
# 推荐（LaTeX 公式渲染为数学符号）
pip install matplotlib
```
