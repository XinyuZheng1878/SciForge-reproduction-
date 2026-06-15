# DeepSeek GUI Runtime 架构治理任务板

更新时间：2026-06-15

## 不可变规则

- [x] 旧逻辑代码和最终目标冲突时，删除旧逻辑，直接实现新版本，不做兼容，保持代码干净。
- [x] 所有修改必须通用，不能为特色例子写硬编码补丁。
- [x] LLM API 只能走model router
- [x] 在能提高时间效率的前提下，尽可能使用 sub agent 并行推进；并行任务必须拆清边界，避免不同 worker 修改同一文件造成冲突。
- [x] 相同功能的工作链路需要统一，不要额外生出旁路。

## 当前目标

合并 GitHub PR #12 `Multimodal plugins`，但按本项目架构约束收敛实现：`sci-modality` 只由 Model Router 调用，Kun/Codex runtime 只负责传递结构化附件引用，不直接调用模型型翻译服务。

目标链路：

```text
GUI attachment picker
  -> Runtime (Kun / Codex)
    -> structured attachment ref
      -> Model Router
        -> external plugin service (sci-modality / vision)
          -> text reasoner
```

## 架构决策

- [x] `plugins/` 是外置服务目录，不作为桌面 app 必然打包内容。
- [x] `sci-modality` 只由 Model Router 调用；Kun/Codex 不直接读取 `SCIFORGE_SCIMODALITY_SERVICE_URL` 调外部专家服务。
- [x] 任意位置拖入的科学文件采用复制模式：复制到 workspace 内 `.sciforge/uploads/` 后，以结构化附件引用交给 Model Router。
- [x] 默认自动科学模态识别只覆盖明确科学扩展名，不包含泛用 `.txt`、`.csv`、`.tsv`。
- [x] `.txt`、`.csv`、`.tsv` 默认作为普通文本/文件引用；后续如需科学分析，需要显式“作为科学数据分析”的用户动作。

## 合并任务

- [x] 合并 PR #12 `multimodal-plugins` 到当前 `gui` 分支。
- [x] 手工解决 `packages/workers/model-router/src/router.ts` 冲突：保留当前 `gui` 的 tool transcript hydrate/cache 逻辑，再接入 scientific modality fallback。
- [x] 移除或绕开 Kun 侧直接调用 `sci-modality` 的路径，确保 runtime 只传结构化附件引用。
- [x] 实现科学附件复制模式：外部文件复制到 workspace `.sciforge/uploads/`，再传安全相对引用。
- [x] 收紧科学扩展名 gating：默认不让 `.txt`、`.csv`、`.tsv` 自动外发到专家服务。
- [x] 保留 PR 新增的 `plugins/sci-modality-router-service`，并保留/迁移 `plugins/vision-router-service` 作为外置插件服务。
- [x] 按外置插件策略修正 `electron-builder.config.cjs`、`scripts/after-pack.cjs` 和 packaging tests，不再要求插件目录随 app 打包。
- [x] 更新文档和设置文案：明确 scientific modality 是外置插件服务，未配置时不启用。

## 回归测试

- [x] `npm --workspace @sciforge/model-router run test`
- [x] `npm --workspace sciforge-sci-modality-router-service run test`
- [x] `npm --workspace sciforge-vision-router-service run test`
- [x] `npm --prefix kun test -- attachment-store`
- [x] `npx vitest run src/main/packaging-config.test.ts`
- [x] `npm run typecheck`
- [x] `npm run build`

## 验收标准

- PR #12 的科学多模态能力可用，但模型型翻译服务调用只发生在 Model Router。
- Kun/Codex runtime 不直接调用 `sci-modality`，不会产生 runtime-specific 模型服务旁路。
- 外部科学文件通过复制到 workspace 的 `.sciforge/uploads/` 获得稳定、安全、可审计的引用。
- 明确科学格式可自动进入 sci-modality；泛用文本/表格格式默认不外发。
- `plugins/` 外置策略与打包、测试、文档一致，不破坏 release 链路。
- `SCIFORGE_SCIMODALITY_SERVICE_URL` 未配置或服务不可用时，普通文本、图片、PDF 和聊天流程保持可用。
