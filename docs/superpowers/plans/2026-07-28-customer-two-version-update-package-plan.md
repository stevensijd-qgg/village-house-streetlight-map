# 客户跨两版更新包实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 制作包含路灯道路迁移、面积迁移和标准路灯道路数据的客户更新包，并附小白可用的 Word/PDF 操作手册。

**Architecture:** 不修改生产逻辑，只从当前 `master` 复制已验证文件到独立更新目录。客户原 `data.js` 和照片保持不动；`roads.js` 通过新页面的文件选择器手动载入，以覆盖浏览器中优先级更高的旧道路存档。

**Tech Stack:** 原生 HTML/JavaScript、PowerShell、Node.js 原生测试、Python `python-docx`、项目文档渲染工具。

## Global Constraints

- 更新包最终只含 4 个程序/数据文件和 Word、PDF 两份同内容手册。
- 标准道路必须为 51 条道路、51 条亮化、48 条正数记录、597 盏。
- 不放入或覆盖客户 `data.js`、照片、成品图和浏览器 localStorage。
- 保持网页双击可用、离线优先、手机兼容，不引入运行依赖。
- 坐标保持 GCJ-02，不修改道路坐标。
- 用户已有未跟踪 PDF、道路备份和分类目录不得提交或删除。

---

### Task 1: 整理四个更新文件

**Files:**
- Copy: `04_网页程序/index.html`
- Copy: `04_网页程序/road-data.js`
- Copy: `04_网页程序/area-data.js`
- Copy: `04_网页程序/roads.js`
- Modify: `04_网页程序/更新部分/`

**Interfaces:**
- Consumes: 当前 `master` 的网页入口、道路/面积数据边界和默认道路。
- Produces: 供客户复制到原网页目录的四个同级文件。

- [ ] **Step 1: 校验源文件及标准道路摘要**

Run:

```powershell
node --test "04_网页程序/tests/road-data.test.cjs" "04_网页程序/tests/project-regression.test.cjs"
```

Expected: 所有测试通过，标准道路摘要为 51/51/48/597。

- [ ] **Step 2: 精确清理更新目录并复制四个文件**

先解析并确认目标正是
`04_网页程序\更新部分`，再只清理该目录现有内容；随后使用
`Copy-Item -LiteralPath` 复制四个文件，禁止复制 `data.js`、照片或历史道路备份。

- [ ] **Step 3: 校验文件一致性**

对四对源文件与交付文件计算 SHA-256；每对必须完全一致。检查更新目录中不存在
`data.js`、`photos/` 和额外子目录。

### Task 2: 制作小白客户操作手册

**Files:**
- Create: `04_网页程序/更新部分/客户更新操作手册.docx`
- Create: `04_网页程序/更新部分/客户更新操作手册.pdf`

**Interfaces:**
- Consumes: Task 1 的四文件更新包和 51/51/597 验收数字。
- Produces: 内容一致、可打印的 Word/PDF 客户手册。

- [ ] **Step 1: 按文档技能读取模板与渲染要求**

完整读取 `documents` 技能说明，只加载其指定的必要脚本/模板。若无项目模板，使用
清爽的蓝绿色标题、橙色警告、编号步骤和文件清单设计。

- [ ] **Step 2: 生成 Word 手册**

手册必须包含：

1. 更新前先导出旧道路并复制整个旧网页文件夹；
2. 关闭网页，复制 `index.html`、`road-data.js`、`area-data.js`、`roads.js`；
3. 不覆盖 `data.js`，不删除照片，不清空浏览器数据；
4. 打开原目录 `index.html`，点击“选择道路文件”并选择新版 `roads.js`；
5. 只在摘要为 51 条道路、51 条亮化、597 盏时确认；
6. 检查黄色亮化道路，重新导出道路和面积备份；
7. 常见错误及恢复旧文件夹/旧道路备份的方法。

- [ ] **Step 3: 渲染并逐页视觉检查**

用文档技能指定的 `render_docx.py` 渲染页面 PNG；检查无乱码、遮挡、截断、孤行和
跨页断裂。发现问题时调整字号、段距或分页后重新渲染。

- [ ] **Step 4: 生成并检查 PDF**

从最终 Word 生成同内容 PDF，渲染 PDF 各页并核对版式。Word 与 PDF 均应可正常打开，
且不含房主姓名、电话和照片。

### Task 3: 验证交付包并记录

**Files:**
- Modify: `项目日志.md`
- Modify: `对话交接记录.md`

**Interfaces:**
- Consumes: Task 1 的四个文件和 Task 2 的两份手册。
- Produces: 可直接交付的 6 文件更新包和可追溯验证记录。

- [ ] **Step 1: 检查最终目录清单**

最终只允许：

```text
index.html
road-data.js
area-data.js
roads.js
客户更新操作手册.docx
客户更新操作手册.pdf
```

- [ ] **Step 2: 运行交付验证**

Run:

```powershell
node --check "04_网页程序/更新部分/road-data.js"
node --check "04_网页程序/更新部分/area-data.js"
node --test "04_网页程序/tests/area-data.test.cjs" "04_网页程序/tests/road-data.test.cjs" "04_网页程序/tests/project-regression.test.cjs"
git diff --check
```

Expected: 脚本语法与测试全部通过，Git 无空白错误。

- [ ] **Step 3: 更新记录并提交**

项目日志和交接记录写明更新包文件、道路摘要、文档页数、验证结果和范围边界；只提交
计划和受控文档记录，不提交用户 PDF、照片、历史道路备份或交付目录。
