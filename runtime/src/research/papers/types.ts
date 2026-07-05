import { z } from 'zod'

// ── Paper Status ───────────────────────────────────────────────
export const PaperStatus = z.enum([
  'draft',
  'outlined',
  'writing',
  'completed',
  'published'
])
export type PaperStatus = z.infer<typeof PaperStatus>

// ── Reference ──────────────────────────────────────────────────
export const PaperReference = z.object({
  /** Citation key, e.g. 'smith2024' */
  key: z.string().min(1),
  /** Type of referenced item */
  type: z.enum(['hypothesis', 'experiment', 'artifact', 'external']),
  /** ID of the referenced item (for hypothesis/experiment/artifact) */
  id: z.string().optional(),
  /** Full citation text */
  citation: z.string().min(1),
  /** URL or DOI */
  url: z.string().optional()
}).strict()
export type PaperReference = z.infer<typeof PaperReference>

// ── Section ────────────────────────────────────────────────────
/** Sub-section with heading and content */
export const SubSection = z.object({
  heading: z.string().min(1),
  content: z.string().default(''),
  status: z.enum(['pending', 'draft', 'complete']).default('pending')
})
export type SubSection = z.infer<typeof SubSection>

export const PaperSection = z.object({
  /** Section heading */
  heading: z.string().min(1),
  /** Section content in Markdown */
  content: z.string().default(''),
  /** Subsections (one level deep) */
  subsections: z.array(SubSection).default([]),
  /** Reference keys cited in this section */
  citedRefs: z.array(z.string()).default([]),
  /** Status of this section */
  status: z.enum(['pending', 'draft', 'complete']).default('pending')
})
export type PaperSection = z.infer<typeof PaperSection>

// ── Paper ──────────────────────────────────────────────────────
export const Paper = z.object({
  /** Unique paper ID */
  id: z.string().min(1),
  /** Paper title */
  title: z.string().min(1),
  /** Authors (comma-separated or list) */
  authors: z.array(z.string()).default([]),
  /** Paper abstract */
  abstract: z.string().default(''),
  /** Keywords */
  keywords: z.array(z.string()).default([]),
  /** Current status */
  status: PaperStatus,
  /** Target venue / journal (optional) */
  venue: z.string().default(''),
  /** Paper sections */
  sections: z.array(PaperSection).default([]),
  /** References / bibliography */
  references: z.array(PaperReference).default([]),
  /** Links to research data */
  hypothesisIds: z.array(z.string()).default([]),
  experimentIds: z.array(z.string()).default([]),
  artifactIds: z.array(z.string()).default([]),
  /** Generated file path */
  outputPath: z.string().default(''),
  /** Timestamps */
  createdAt: z.string(),
  updatedAt: z.string()
}).strict()
export type Paper = z.infer<typeof Paper>

// ── Paper Index ────────────────────────────────────────────────
export const PaperIndex = z.object({
  version: z.literal(1),
  papers: z.array(Paper).default([]),
  lastUpdated: z.string()
}).strict()
export type PaperIndex = z.infer<typeof PaperIndex>

// ── Standard Outlines ──────────────────────────────────────────

/** Default IMRaD outline for empirical research papers */
export const IMRAD_OUTLINE: PaperSection[] = [
  {
    heading: 'Abstract',
    content: '',
    subsections: [],
    citedRefs: [],
    status: 'pending'
  },
  {
    heading: 'Introduction',
    content: '',
    subsections: [],
    citedRefs: [],
    status: 'pending'
  },
  {
    heading: 'Related Work',
    content: '',
    subsections: [],
    citedRefs: [],
    status: 'pending'
  },
  {
    heading: 'Method',
    content: '',
    subsections: [
      { heading: 'Experimental Setup', content: '', status: 'pending' },
      { heading: 'Evaluation Metrics', content: '', status: 'pending' }
    ],
    citedRefs: [],
    status: 'pending'
  },
  {
    heading: 'Results',
    content: '',
    subsections: [],
    citedRefs: [],
    status: 'pending'
  },
  {
    heading: 'Discussion',
    content: '',
    subsections: [
      { heading: 'Limitations', content: '', status: 'pending' }
    ],
    citedRefs: [],
    status: 'pending'
  },
  {
    heading: 'Conclusion',
    content: '',
    subsections: [],
    citedRefs: [],
    status: 'pending'
  },
  {
    heading: 'References',
    content: '',
    subsections: [],
    citedRefs: [],
    status: 'pending'
  }
]

/** Compact outline for short technical reports */
export const SHORT_REPORT_OUTLINE: PaperSection[] = [
  { heading: 'Abstract', content: '', subsections: [], citedRefs: [], status: 'pending' },
  { heading: 'Introduction', content: '', subsections: [], citedRefs: [], status: 'pending' },
  { heading: 'Method & Results', content: '', subsections: [], citedRefs: [], status: 'pending' },
  { heading: 'Discussion & Conclusion', content: '', subsections: [], citedRefs: [], status: 'pending' },
  { heading: 'References', content: '', subsections: [], citedRefs: [], status: 'pending' }
]

// ── CRUD Requests ──────────────────────────────────────────────
export const PaperCreateRequest = z.object({
  id: z.string().min(1).optional(),
  title: z.string().min(1),
  authors: z.array(z.string()).default([]),
  abstract: z.string().default(''),
  keywords: z.array(z.string()).default([]),
  venue: z.string().default(''),
  template: z.enum(['imrad', 'short_report', 'custom']).default('imrad'),
  customSections: z.array(PaperSection).optional(),
  hypothesisIds: z.array(z.string()).default([]),
  experimentIds: z.array(z.string()).default([]),
  artifactIds: z.array(z.string()).default([])
}).strict()
export type PaperCreateRequest = z.input<typeof PaperCreateRequest>

export const PaperUpdateRequest = z.object({
  title: z.string().min(1).optional(),
  abstract: z.string().optional(),
  authors: z.array(z.string()).optional(),
  keywords: z.array(z.string()).optional(),
  status: PaperStatus.optional(),
  sections: z.array(PaperSection).optional(),
  references: z.array(PaperReference).optional(),
  outputPath: z.string().optional()
}).strict()
export type PaperUpdateRequest = z.input<typeof PaperUpdateRequest>

// ── Diagnostics ────────────────────────────────────────────────
export const PaperDiagnostics = z.object({
  indexPath: z.string(),
  totalCount: z.number().int().nonnegative(),
  byStatus: z.record(z.string(), z.number().int().nonnegative()),
  totalReferences: z.number().int().nonnegative(),
  totalSections: z.number().int().nonnegative(),
  completedCount: z.number().int().nonnegative()
})
export type PaperDiagnostics = z.infer<typeof PaperDiagnostics>
