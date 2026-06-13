# DeepSeek GUI Git 发现修复任务板

更新时间：2026-06-13

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

- [ ] 新增或替换通用 `findNearestGitRoot(workspaceRoot)` 逻辑。
- [ ] `getGitBranches`、`switchGitBranch`、`createAndSwitchGitBranch` 使用最近 Git root。
- [ ] 对 subdirectory workspace root 增加集成测试。
- [ ] 对非 Git workspace 保持可解释失败。

## 不引入范围

- [ ] 不新增 Git UI。
- [ ] 不改变分支选择器的视觉设计。
- [ ] 不引入 Kun branding。
- [ ] 不改变 workspace 绑定策略。

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

## 验收清单

- [ ] workspace 指向仓库根时，分支功能正常。
- [ ] workspace 指向仓库子目录时，能找到最近 `.git` 根。
- [ ] 嵌套 Git 仓库时，选择最近的 Git root。
- [ ] 非 Git 目录返回可解释错误，不抛未处理异常。
