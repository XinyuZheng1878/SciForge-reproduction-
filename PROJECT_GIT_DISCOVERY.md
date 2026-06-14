# DeepSeek GUI Git 发现修复任务板

更新时间：2026-06-14

## 核心目标

引入 Kun 的 Git root 向上查找修复：当 workspace root 是仓库子目录时，DeepSeek-GUI 仍能找到最近的 `.git` 根并正确列出/切换分支。

这是低风险、独立 bug fix。

## 上游参考目录

Kun 上游仓库在本机：

`/Applications/workspace/ailab/research/app/Kun`

实现时优先阅读并移植 Kun 中对应的现成代码，不从头造车；但必须按 DeepSeek-GUI 当前架构、命名、配置、产品原则做必要适配。不得整仓 merge、不得引入本任务“不引入范围”里的 Kun 品牌化或旁路能力。

## 必须遵守的原则约束

1. 旧逻辑代码和最终目标冲突时，删除旧逻辑，直接实现新版本，不做兼容，保持代码干净。
2. 所有修改必须通用，不能为特例写硬编码补丁。
3. 在能提高时间效率的前提下，尽可能使用 sub agent 并行推进；并行任务必须拆清边界，避免不同 worker 修改同一文件造成冲突。
4. 对话、工作链路需要统一，不要额外生出旁路。

## 引入范围

- [x] 新增或替换通用 `findNearestGitRoot(workspaceRoot)` 逻辑。
- [x] `getGitBranches`、`switchGitBranch`、`createAndSwitchGitBranch` 使用最近 Git root。
- [x] 对 subdirectory workspace root 增加集成测试。
- [x] 对非 Git workspace 保持可解释失败。
- [x] 执行 Git 命令时固定诊断语言环境，避免中文/本地化 git stderr 影响“非仓库”错误分类。

## Kun v0.2.10 增量纳入项

- [x] 纳入 `fix(git): detect non-repo dirs regardless of git locale`：参考 Kun `src/main/services/git-service.ts` 中 `LC_ALL=C` / `LANG=C` 设置。
- [x] 错误分类逻辑必须基于通用 git 语义，不为某一种本地化字符串写特例补丁。

## 不引入范围

- [x] 不新增 Git UI。
- [x] 不改变分支选择器的视觉设计。
- [x] 不引入 Kun branding。
- [x] 不改变 workspace 绑定策略。

## 并行边界

本任务可以独立并行推进，修改范围很小。

优先修改范围：

- `src/main/services/git-discovery.ts`
- `src/main/services/git-service.ts`
- `src/main/services/git-service.test.ts`
- `src/main/services/git-discovery.test.ts`

不要修改：

- chat store / sidebar 项目列表。
- runtime / agent loop。
- IM channel workspace 绑定逻辑。

## 参考来源

- Kun `src/main/services/git-discovery.ts`
- Kun `src/main/services/git-service.test.ts`
- Kun commits: `fix(git): walk up directory tree to find nearest .git root`
- Kun commit: `fix(git): detect non-repo dirs regardless of git locale`

## 验收清单

- [x] workspace 指向仓库根时，分支功能正常。
- [x] workspace 指向仓库子目录时，能找到最近 `.git` 根。
- [x] 嵌套 Git 仓库时，选择最近的 Git root。
- [x] 非 Git 目录返回可解释错误，不抛未处理异常。
- [x] macOS/Windows/Linux 上 git stderr 本地化不影响非仓库状态识别。
