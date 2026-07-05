#!/usr/bin/env node
/**
 * 自主研究循环 Demo
 * 不依赖 LLM API，直接用代码模拟一次完整的科学研究流程。
 *
 * 运行: npx tsx kun/src/research/demo-autonomous-loop.ts
 */

import { JsonHypothesisStore } from './hypotheses/store.js'
import { JsonExperimentStore } from './experiments/store.js'
import { YamlResearchArtifactStore } from './artifacts/store.js'
import { JsonPaperStore } from './papers/store.js'
import { createExperimentRunner } from './experiments/runner.js'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

async function main() {
  // 创建临时工作区
  const ws = await mkdtemp(join(tmpdir(), 'sciforge-demo-'))
  const now = () => new Date().toISOString()
  console.log('工作区:', ws)

  // 初始化四个子系统
  const hypothesisStore = new JsonHypothesisStore({ workspaceDir: ws, nowIso: now })
  const experimentStore = new JsonExperimentStore({ workspaceDir: ws, nowIso: now })
  const artifactStore = new YamlResearchArtifactStore({ workspaceDir: ws, nowIso: now })
  const paperStore = new JsonPaperStore({ workspaceDir: ws, nowIso: now })
  const runner = createExperimentRunner({ store: experimentStore, workspaceDir: ws })

  // ═══════════════════════════════════════════════════════════════
  // Phase 1: 研究记忆 — 记录初始观察
  // ═══════════════════════════════════════════════════════════════
  console.log('\n━━━ Phase 1: 研究记忆 ━━━')

  const obs = await artifactStore.create({
    type: 'observation',
    title: 'Initial observation: model performance varies with size',
    summary: 'Larger language models appear to perform better on reasoning tasks, but the relationship may not be linear. Preliminary review of 5 papers suggests diminishing returns beyond ~7B parameters.',
    evidenceLevel: 'observation',
    tags: ['model-scaling', 'reasoning', 'nlp'],
    interpretation: 'There seems to be an optimal model size sweet spot for reasoning tasks.',
    nextActions: ['Design controlled experiment', 'Test 3 model sizes on reasoning benchmarks']
  })
  console.log(`✓ 创建观察: ${obs.id} — ${obs.title}`)

  // ═══════════════════════════════════════════════════════════════
  // Phase 3: 自主循环 — 生成假设
  // ═══════════════════════════════════════════════════════════════
  console.log('\n━━━ Phase 3: 生成假设 ━━━')

  const h1 = await hypothesisStore.create({
    id: 'HYP-001',
    title: 'Larger models outperform smaller ones on reasoning',
    statement: 'If model size correlates with reasoning ability, then a 7B model should achieve >10% higher accuracy than a 1B model on the same reasoning benchmark.',
    falsificationCriteria: '7B model accuracy ≤ 1B model accuracy on reasoning benchmark.',
    premises: ['Larger models have more parameters to capture patterns', 'Prior work shows scaling trends on language modeling'],
    predictions: ['7B accuracy > 1B accuracy by at least 10%', '13B accuracy > 7B accuracy by <5% (diminishing returns)'],
    tags: ['model-scaling', 'reasoning'],
    priorConfidence: 0.5
  })
  console.log(`✓ 假设 1: ${h1.id} — ${h1.title}`)
  console.log(`  先验置信度: ${h1.confidence.prior}`)

  const h2 = await hypothesisStore.create({
    id: 'HYP-002',
    title: 'Fine-tuning on reasoning data improves small models more',
    statement: 'If fine-tuning is more impactful on smaller models, then a 1B fine-tuned model should improve by >20% while a 7B fine-tuned model improves by <10%.',
    falsificationCriteria: '1B fine-tuned improvement ≤ 7B fine-tuned improvement.',
    premises: ['Smaller models have less pre-existing reasoning ability', 'Fine-tuning can inject specific capabilities'],
    predictions: ['1B gain > 20%', '7B gain < 10%'],
    tags: ['fine-tuning', 'model-scaling'],
    priorConfidence: 0.6
  })
  console.log(`✓ 假设 2: ${h2.id} — ${h2.title}`)
  console.log(`  先验置信度: ${h2.confidence.prior}`)

  // ═══════════════════════════════════════════════════════════════
  // Phase 2: 实验编排 — 设计并执行实验
  // ═══════════════════════════════════════════════════════════════
  console.log('\n━━━ Phase 2: 设计并执行实验 ━━━')

  // 实验 1: 测试 HYP-001
  const pythonCode1 = `
import json
import random

# Simulated reasoning benchmark results
# In a real experiment, this would load a model, run inference, and compute accuracy
models = {
    "1B":  {"accuracy": 0.52, "latency_ms": 45},
    "7B":  {"accuracy": 0.71, "latency_ms": 120},
    "13B": {"accuracy": 0.76, "latency_ms": 280},
}

print("Model Benchmark Results")
print("=" * 40)
for name, metrics in models.items():
    print(f"{name}: accuracy={metrics['accuracy']:.2f}, latency={metrics['latency_ms']}ms")

# Output final metric as last line for auto-extraction
# 7B vs 1B accuracy difference
diff = models["7B"]["accuracy"] - models["1B"]["accuracy"]
print(f"accuracy_gain_7b_vs_1b: {diff:.4f}")
`.trim()

  const exp1 = await experimentStore.createSpec({
    id: 'EXP-001',
    title: 'Compare model sizes on reasoning benchmark',
    description: 'Benchmark 1B, 7B, and 13B models on a standardized reasoning task to test HYP-001.',
    hypothesisId: 'HYP-001',
    language: 'python',
    code: pythonCode1,
    metrics: [
      { name: 'accuracy_gain', extractor: 'regex', pattern: 'accuracy_gain_7b_vs_1b: ([\\d.]+)', direction: 'maximize' }
    ],
    timeoutSeconds: 30,
    maxRetries: 1,
    tags: ['benchmark', 'reasoning']
  })
  console.log(`✓ 创建实验: ${exp1.id} — ${exp1.title}`)

  // 执行实验
  console.log('  执行中...')
  const result1 = await runner.execute(exp1)
  console.log(`  状态: ${result1.run.status}`)
  console.log(`  退出码: ${result1.exitCode}`)
  console.log(`  指标: ${JSON.stringify(result1.metrics)}`)
  if (result1.output) {
    console.log(`  输出摘要:\n${result1.output.split('\n').slice(0, 5).join('\n')}`)
  }

  // 分析结果 → 更新假设置信度
  const gain1 = result1.metrics['accuracy_gain'] ?? 0
  const supportsH1 = gain1 >= 0.10  // HYP-001 predicted >10% gain
  const updatedH1 = await hypothesisStore.update('HYP-001', {
    recordTrial: { supported: supportsH1, experimentId: 'EXP-001' }
  })
  console.log(`\n  → 假设 HYP-001: ${supportsH1 ? '支持 ✓' : '反驳 ✗'}`)
  console.log(`  后验置信度: ${updatedH1.confidence.posterior.toFixed(3)} (先验: ${updatedH1.confidence.prior})`)
  console.log(`  状态: ${updatedH1.status}`)

  // 实验 2: 测试 HYP-002
  const pythonCode2 = `
import json

# Simulated fine-tuning results
pretrain = {"1B": 0.30, "7B": 0.50}
finetuned = {"1B": 0.58, "7B": 0.62}

print("Fine-tuning Impact Analysis")
print("=" * 40)
for size in ["1B", "7B"]:
    gain = finetuned[size] - pretrain[size]
    pct = gain / pretrain[size] * 100
    print(f"{size}: pre={pretrain[size]:.2f} → ft={finetuned[size]:.2f} (gain={gain:.2f}, +{pct:.1f}%)")

# Extract the 1B improvement percentage
gain_1b_pct = (finetuned["1B"] - pretrain["1B"]) / pretrain["1B"] * 100
print(f"improvement_1b_pct: {gain_1b_pct:.1f}")
`.trim()

  const exp2 = await experimentStore.createSpec({
    id: 'EXP-002',
    title: 'Compare fine-tuning impact by model size',
    description: 'Fine-tune 1B and 7B models on reasoning data, measure improvement.',
    hypothesisId: 'HYP-002',
    language: 'python',
    code: pythonCode2,
    metrics: [
      { name: 'improvement_1b_pct', extractor: 'regex', pattern: 'improvement_1b_pct: ([\\d.]+)', direction: 'maximize' }
    ],
    timeoutSeconds: 30,
    maxRetries: 1,
    tags: ['fine-tuning', 'comparison']
  })
  console.log(`\n✓ 创建实验: ${exp2.id} — ${exp2.title}`)

  console.log('  执行中...')
  const result2 = await runner.execute(exp2)
  console.log(`  状态: ${result2.run.status}`)
  console.log(`  指标: ${JSON.stringify(result2.metrics)}`)
  if (result2.output) {
    console.log(`  输出摘要:\n${result2.output.split('\n').slice(0, 5).join('\n')}`)
  }

  const gain2 = result2.metrics['improvement_1b_pct'] ?? 0
  const supportsH2 = gain2 >= 20  // HYP-002 predicted >20% for 1B
  const updatedH2 = await hypothesisStore.update('HYP-002', {
    recordTrial: { supported: supportsH2, experimentId: 'EXP-002' }
  })
  console.log(`\n  → 假设 HYP-002: ${supportsH2 ? '支持 ✓' : '反驳 ✗'}`)
  console.log(`  后验置信度: ${updatedH2.confidence.posterior.toFixed(3)} (先验: ${updatedH2.confidence.prior})`)
  console.log(`  状态: ${updatedH2.status}`)

  // 多跑几轮实验来触发 validated 状态（贝叶斯更新需要多次试验）
  console.log('\n  额外试验（加速贝叶斯收敛）...')
  for (let i = 0; i < 3; i++) {
    const r = await runner.execute(exp1)
    await hypothesisStore.update('HYP-001', {
      recordTrial: { supported: r.metrics['accuracy_gain'] ? r.metrics['accuracy_gain'] >= 0.10 : true, experimentId: exp1.id }
    })
  }
  const finalH1 = await hypothesisStore.get('HYP-001')
  console.log(`  HYP-001 最终: 置信度=${finalH1!.confidence.posterior.toFixed(3)}, 状态=${finalH1!.status}, 试验=${finalH1!.confidence.totalTrials}`)

  // ═══════════════════════════════════════════════════════════════
  // Phase 4: 论文生成 — 综合研究成果
  // ═══════════════════════════════════════════════════════════════
  console.log('\n━━━ Phase 4: 论文生成 ━━━')

  const paper = await paperStore.create({
    title: 'An Empirical Study of Model Scaling Effects on Reasoning Tasks',
    authors: ['SciForge Autonomous Research System'],
    keywords: ['model scaling', 'reasoning', 'fine-tuning', 'benchmark'],
    hypothesisIds: ['HYP-001', 'HYP-002'],
    experimentIds: ['EXP-001', 'EXP-002'],
    template: 'short_report'
  })
  console.log(`✓ 创建论文: ${paper.id} — ${paper.title}`)

  // 收集研究数据
  const allHypotheses = await hypothesisStore.list()
  const allSpecs = await experimentStore.listSpecs()
  const allArtifacts = await artifactStore.list()

  // 生成论文内容
  const { sections, references } = await paperStore.generateContent(paper, {
    goal: 'Determine how model size and fine-tuning affect reasoning performance',
    hypotheses: await Promise.all(allHypotheses.map(async (h) => ({
      id: h.id,
      title: h.title,
      statement: h.statement,
      status: h.status,
      confidence: h.confidence.posterior,
      totalTrials: h.confidence.totalTrials,
      experimentIds: h.experimentIds
    }))),
    experiments: allSpecs.map(s => ({ id: s.id, title: s.title, language: s.language })),
    artifacts: allArtifacts.slice(0, 5).map(a => ({
      id: a.id, type: a.type, title: a.title, summary: a.summary, evidenceLevel: a.evidenceLevel
    }))
  })

  // 人工润色几个关键章节（模拟 Agent 写论文）
  const introIdx = sections.findIndex(s => s.heading === 'Introduction')
  if (introIdx >= 0) {
    sections[introIdx].content =
      'Recent advances in large language models (LLMs) have demonstrated impressive reasoning capabilities. ' +
      'However, the relationship between model size and reasoning performance remains poorly understood. ' +
      'This study systematically investigates how model scale (1B, 7B, 13B parameters) affects accuracy on ' +
      'standardized reasoning benchmarks, and whether fine-tuning disproportionately benefits smaller models.\n\n' +
      'We conducted controlled experiments comparing pretrained and fine-tuned models across three size classes, ' +
      'measuring both accuracy and latency. Our findings reveal clear scaling trends with diminishing returns, ' +
      'and suggest that fine-tuning is most impactful for smaller architectures.'
    sections[introIdx].status = 'complete'
  }

  const discussIdx = sections.findIndex(s => s.heading === 'Discussion & Conclusion')
  if (discussIdx >= 0) {
    sections[discussIdx].content =
      'Our experiments validated the hypothesis that larger models outperform smaller ones on reasoning tasks, ' +
      `with a 7B model achieving approximately ${gain1 > 0 ? (gain1 * 100).toFixed(0) : '~19'}% higher accuracy ` +
      'than a 1B model. However, we also observed diminishing returns beyond 7B parameters, consistent with ' +
      'prior scaling law research.\n\n' +
      'Interestingly, fine-tuning produced a markedly larger relative improvement for the 1B model ' +
      `(${gain2 > 0 ? gain2.toFixed(0) : '~93'}% gain) compared to the 7B model, supporting the hypothesis that ` +
      'smaller models benefit more from task-specific training.\n\n' +
      'Limitations of this study include the simulated nature of the benchmark and the limited size range tested. ' +
      'Future work should extend to larger models (70B+) and more diverse reasoning tasks.'
    sections[discussIdx].status = 'complete'
  }

  await paperStore.update(paper.id, { sections, references, status: 'completed' })

  // 重新获取最新数据再导出
  const finalPaper = (await paperStore.get(paper.id))!
  const paperPath = await paperStore.exportMarkdown(finalPaper)
  console.log(`✓ 论文已导出: ${paperPath}`)

  // ═══════════════════════════════════════════════════════════════
  // 总结
  // ═══════════════════════════════════════════════════════════════
  console.log('\n╔══════════════════════════════════════════════════╗')
  console.log('║     自主研究循环 Demo 完成                        ║')
  console.log('╠══════════════════════════════════════════════════╣')

  const hypothesisDiag = await hypothesisStore.diagnostics()
  const experimentDiag = await experimentStore.diagnostics()
  const artifactDiag = await artifactStore.diagnostics()
  const paperDiag = await paperStore.diagnostics()

  console.log(`║ 假设: ${hypothesisDiag.totalCount} 个 (${hypothesisDiag.validatedCount} 已验证, ${hypothesisDiag.falsifiedCount} 已证伪)`)
  console.log(`║ 实验: ${experimentDiag.specCount} 个规格, ${experimentDiag.runCount} 次运行`)
  console.log(`║ 记忆: ${artifactDiag.totalCount} 条记录`)
  console.log(`║ 论文: ${paperDiag.totalCount} 篇 (${paperDiag.completedCount} 已完成)`)
  console.log(`║ 平均置信度: ${hypothesisDiag.averageConfidence.toFixed(3)}`)
  console.log(`║ 总试验次数: ${hypothesisDiag.totalTrials}`)
  console.log('╠══════════════════════════════════════════════════╣')
  console.log(`║ 论文导出: ${paperPath}`)
  console.log('╚══════════════════════════════════════════════════╝')

  // 显示论文内容片段
  const { readFile } = await import('node:fs/promises')
  const paperContent = await readFile(paperPath, 'utf-8')
  console.log('\n━━━ 生成的论文预览 ━━━')
  console.log(paperContent.slice(0, 1500))
  if (paperContent.length > 1500) {
    console.log(`\n... (全文共 ${paperContent.length} 字符, ${paperContent.split('\n').length} 行)`)
  }

  // 保留文件供查看
  console.log(`\n文件保留在: ${ws}`)
  console.log(`论文: ${paperPath}`)
  console.log(`假设数据: ${hypothesisStore.getIndexPath()}`)
  console.log(`实验数据: ${experimentStore.getIndexPath()}`)
  console.log(`记忆数据: ${artifactStore.getIndexPath()}`)
}

main().catch(console.error)
