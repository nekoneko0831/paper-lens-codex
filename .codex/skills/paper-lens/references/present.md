# 展示模式 — Present

## 目标

帮用户准备一场论文讲解的 slides，输出结构化的内容文档（slides-content.md，含 `figures/` 路径引用）。`slides-content.md` 生成后，必须交给 `frontend-slides` skill 生成最终 HTML 演示文稿；paper-lens 不自己开发 HTML deck。

## 核心原则

1. **用户主导**：每一页的内容都和用户讨论确认，不替用户做决定
2. **图文并茂**：论文原图直接引用到 slides，不只是文字
3. **分步推进**：规划 → 图表映射 → 大纲 → 逐页确认 → 输出文档
4. **职责边界**：paper-lens 只产出 `slides-content.md`；HTML 演示稿由 `frontend-slides` skill 负责

---

## frontend-slides 安装检查（展示模式必须执行）

进入展示模式后，先确认 `frontend-slides` skill 是否可用：

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
echo "$FRONTEND_SLIDES_SKILL"
```

处理规则：

- 如果 `.codex/skills/frontend-slides/SKILL.md` 已存在：继续展示模式。
- 如果 `.agents/skills/frontend-slides/SKILL.md` 存在但 `.codex/skills/frontend-slides/` 不存在：主动执行 `mkdir -p .codex/skills && rsync -a .agents/skills/frontend-slides/ .codex/skills/frontend-slides/`，完成本仓库安装后继续。
- 如果只在 `$HOME/.codex/...` 找到：继续展示模式，最终生成 HTML 时调用该 skill。
- 如果完全找不到：继续先生成 `slides-content.md`，但在保存后提醒用户先安装 `frontend-slides`；不要退而求其次自己写 HTML。

## 内容基础（展示模式必须基于精读）

展示模式的主要理解来源必须优先使用 `paper-reading.md`，而不是 `deep-learn.md`。

读取优先级：

1. `paper-notes/<name>/paper-reading.md`：主来源。用于抽取主问题链、核心结论、方法框架、关键图表解释、实验结论、局限与启发。
2. `paper-notes/<name>/slides-content.md`：如果已有旧稿，只作为历史参考，不得直接拼接复用。
3. `paper-notes/<name>/speed-read.md`：只作为快速校验，不得替代精读理解。
4. `paper-notes/<name>/deep-learn.md`：只作为补充材料，尤其用于大白话解释、术语解释和用户之前指定的关注点。
5. `paper-notes/<name>/extracted-text.md`：事实兜底，用于核对数字、图表 caption、公式和实验设置。

执行规则：

- 如果 `paper-reading.md` 已存在：先从中提炼“展示叙事线”，再进入展示规划和图表映射。
- 如果 `paper-reading.md` 不存在：不要默认转向学习模式；先提示用户建议生成精读文档，或在展示流程前按精读策略补一版 `paper-reading.md`。
- Slides 大纲必须能追溯到精读文档的主线：为什么这个问题重要、论文怎么做、关键证据是什么、局限在哪里、对听众有什么启发。
- Speaker Notes 可以吸收 `deep-learn.md` 的大白话解释，但页面正文和结构不应以学习模式笔记为主。

## 流程（多轮交互）

### Step 1: 展示规划

**用 结构化提问一次性收集所有信息**（必须用工具，不要输出纯文本提问）：

调用结构化提问，questions 数组包含以下 4 个问题：

1. **演讲场景**（单选）
   - question: "演讲场景——这是什么场合？"
   - options: 组会/读书会（轻松，可讨论细节）| 学术会议（正式，时间严格）| 答辩（展示理解深度）| 团队分享（面向非专业听众）
   - multiSelect: false

2. **时长**（单选）
   - question: "时长——你有多少分钟？"
   - options: 5-10分钟 | 15分钟 | 20-30分钟 | 30分钟以上
   - multiSelect: false

3. **听众背景**（单选）
   - question: "听众背景——听众对这个领域了解多少？"
   - options: 专家（同领域研究者）| 有基础（了解 AI/CS 但不是该细分领域）| 非专业（需要更多背景解释）
   - multiSelect: false

4. **重点偏好**（多选）
   - question: "重点偏好——你最想讲清楚哪些部分？"
   - options: 研究动机和问题定义 | 核心方法/技术方案 | 实验结果和分析 | 启示和未来方向 | 全部均衡覆盖
   - multiSelect: true

**根据用户回答调整策略**：

| 场景 | 重点 | 风格 |
|------|------|------|
| 组会 | 方法细节 + 讨论点 | 可以有代码/公式，留讨论时间 |
| 会议 | 创新点 + 核心结果 | 精炼，每页一个核心信息 |
| 答辩 | 方法 + 理解深度 | 有推导过程，体现思考 |
| 团队分享 | 动机 + 直觉 + 应用 | 少公式，多图表和类比 |

---

### Step 1.5: 图表筛选与映射

**从提取的图片中识别论文原图，建立映射关系。**

**降级路径**：先检查 `paper-notes/<name>/images/` 目录是否存在且包含图片文件。如果目录为空或不存在，跳过图表映射步骤，提示用户：「未找到提取的图片。你可以手动截图论文中的关键图表，放到 `paper-notes/<name>/figures/` 目录，slides 中即可引用。」然后直接进入 Step 2。

Phase 0 提取的 `images/` 目录包含所有矢量图和嵌入位图，其中有些是论文原图（Figure/Table），有些是噪声（页面装饰、小图标等）。这一步需要：

1. **扫描 `images/` 目录**：用 Read 工具逐个查看提取的图片
2. **识别论文原图**：对照论文文本中的 "Figure X" / "Table X" 描述，确认哪些提取图片对应论文中的哪个 Figure/Table
3. **筛选复制**：将有价值的图片复制到 `figures/` 目录，并重命名为语义化名称

**命名规则**：

```
figures/
├── fig1-<简要描述>.png      # 对应论文 Figure 1
├── fig2-<简要描述>.png      # 对应论文 Figure 2
├── tab1-<简要描述>.png      # 对应论文 Table 1（如果是图片格式的表格）
└── ...
```

**复制命令**：

```bash
mkdir -p paper-notes/<name>/figures
cp paper-notes/<name>/images/<source>.png paper-notes/<name>/figures/fig1-<desc>.png
```

4. **生成图表清单**：展示给用户确认

```markdown
我从论文中识别出以下可用于 slides 的图表：

| 编号 | 论文原图 | 文件 | 描述 |
|------|----------|------|------|
| 1 | Figure 1 | fig1-architecture.png | 系统架构图 |
| 2 | Figure 2 | fig2-trajectory.png | 交互轨迹示例 |
| 3 | Figure 3 | fig3-results.png | 主要实验结果 |
| ... | ... | ... | ... |

你觉得哪些图表需要放进 slides？有没有想调整的？
```

**如果论文图表提取质量不好**（模糊、缺失），提示用户：可以手动截图放到 `figures/` 目录。

---

### Step 2: 生成 Slides 大纲

**基于用户选择，生成结构化大纲**：

```markdown
## Slides 大纲（共 N 页，约 X 分钟）

| 页码 | 标题 | 核心内容 | 时间 | 引用图表 |
|------|------|----------|------|----------|
| 1 | 标题页 | 论文标题、作者、机构 | 0:30 | — |
| 2 | <标题> | <2-3 个要点> | X:XX | Fig.X / Table.X |
| 3 | <标题> | <2-3 个要点> | X:XX | — |
| ... | ... | ... | ... | ... |
| N | 总结与讨论 | <总结要点> | 1:00 | — |
| **合计** | | | **X:XX** | |

你觉得这个结构怎么样？需要调整哪些页的内容或顺序？
```

**大纲生成规则**：
- 时长 ≤ 10 分钟：8-10 页
- 时长 10-20 分钟：12-15 页
- 时长 > 20 分钟：15-20 页
- 每页平均 1-1.5 分钟
- 方法部分占 30-40%，实验部分占 20-30%

---

### Step 3: 逐页内容确认

**大纲确认后，逐页和用户讨论详细内容。**

每次展示 2-3 页的详细内容，格式：

```markdown
### Slide X: <标题>

**核心信息**：<这一页要传达的一个核心观点>

**内容要点**：
- <要点1>
- <要点2>
- <要点3>

**视觉元素**：
- <引用的图片路径，如 `![Figure 1](figures/fig1-architecture.png)`>
- <布局建议：全图/左右分栏/上文下图>
- <如果不引用图片，说明建议的可视化方式>

**Speaker Notes**：
<这一页你可以这样讲：...>

---

这几页的内容你觉得怎么样？要调整什么？
```

**每一页的内容密度控制**：
- 标题页：标题 + 副标题 + 作者信息
- 内容页：1 个标题 + 最多 5 个要点（每个不超过 15 字）
- 图表页：1 个标题 + 1 张图/表 + 1-2 句说明
- 总结页：3-4 个核心 takeaway

**讨论页风格**：
- 不要用模板式的第三人称提问，如 ~~"你们团队的 Agent 最可能卡在哪一种？"~~
- 讨论问题要自然，像是演讲者自己抛出的思考，而不是问卷调查
- 好的讨论页只需要「局限性 + 未来方向」即可，不必硬塞讨论问题
- 如果确实想引导讨论，用开放式反思代替封闭式提问，如「这套评测框架可以怎样适配到我们自己的场景？」

---

### Step 4: 输出 Slides 内容文档

**全部确认后，生成最终的 slides 内容文档。**

```markdown
# <论文标题> — Slides 内容文档

> 场景：<组会/会议/答辩>
> 时长：<X 分钟>
> 页数：<N 页>
> 生成日期：<日期>

---

## Slide 1: 标题页

**标题**：<中文标题>
**副标题**：<英文标题>
**作者**：<作者信息>
**机构**：<机构信息>

**Speaker Notes**：<开场白建议>

---

## Slide 2: <标题>

**内容**：
- <要点1>
- <要点2>
- <要点3>

**视觉元素**：<引用的图表或建议的可视化方式>

**Speaker Notes**：<讲解建议>

---

...(每页同样格式)

---

## 时间分配

| 页码 | 标题 | 时间 | 占比 |
|------|------|------|------|
| 1 | 标题页 | 0:30 | X% |
| ... | ... | ... | ... |

## 需要的论文图表

| 图表 | 出处 | 用于 Slide | 已提取路径 |
|------|------|-----------|-----------|
| Figure 1 | 论文第 X 页 | Slide X | images/xxx.png |
| ... | ... | ... | ... |
```

保存到 `paper-notes/<name>/slides-content.md`。

---

## 交接给 frontend-slides

`slides-content.md` 保存后，必须在对话中提示：

```markdown
Slides 内容文档已保存到 paper-notes/<name>/slides-content.md。
论文图表已筛选到 paper-notes/<name>/figures/。

接下来我会使用 `frontend-slides` skill 生成可直接打开的 HTML 演示稿。该 skill 会负责视觉设计、图片 base64 嵌入、键盘/触控翻页和多视口验证。
```

然后调用/切换到 `frontend-slides` skill，让它读取 `paper-notes/<name>/slides-content.md` 和 `figures/` 目录生成最终 HTML。

**不要自己开发最终 HTML 演示稿**：

- 不要在 paper-lens 流程里手写 HTML/CSS/JS deck
- 不要生成 `build-slides.py` 之类的临时生成器
- 不要改用 reveal.js / Marp / PowerPoint 等替代路线
- 不要声称“没有 frontend-slides 所以我直接写一个”

如果当前运行环境找不到 `frontend-slides`，只停在 `slides-content.md`，并提示用户安装该 skill 后继续。

### 图片 slide 的内容密度限制

含图片的 slide 内容要更精简，确保 viewport fitting：

| 布局 | 最大内容 |
|------|----------|
| 全图页 | 1 标题 + 1 图片（max-height: 60vh）+ 1 行说明 |
| 上文下图 | 1 标题 + 2-3 行文字 + 1 图片（max-height: 40vh） |
| 左右分栏 | 左侧 3-4 个要点 + 右侧 1 图片（max-height: 50vh） |

---

## 结束提示

输出完成后提示：

```
Slides 内容文档已保存到 paper-notes/<name>/slides-content.md
论文图表已筛选到 paper-notes/<name>/figures/

下一步：
我会使用 `frontend-slides` skill 继续生成可直接打开的 HTML 演示稿；paper-lens 不会自己开发最终 deck。
```
