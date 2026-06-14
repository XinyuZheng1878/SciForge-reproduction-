// Template-conformant result envelope (see ../../SciForge VL/Servic_Module_Template.md).
// The service returns structured evidence only — never a user-level final answer.

export interface Provenance {
  serviceId: string;
  operation: string;
  requestId: string;
  startedAt?: string;
  completedAt?: string;
  inputHash?: string;
}

export type ServiceErrorCode =
  | 'INVALID_ARGUMENT'
  | 'UNAUTHENTICATED'
  | 'PERMISSION_DENIED'
  | 'NOT_FOUND'
  | 'TIMEOUT'
  | 'RATE_LIMITED'
  | 'UNAVAILABLE'
  | 'INTERNAL_ERROR';

export interface ServiceError {
  code: ServiceErrorCode;
  message: string;
  retryable: boolean;
  details?: Record<string, unknown>;
}

export type ServiceResult<T = unknown> =
  | { ok: true; summary?: string; data: T; provenance?: Provenance; warnings?: string[] }
  | { ok: false; error: ServiceError; provenance?: Provenance; warnings?: string[] };

// --- modality_translate operation -------------------------------------------

/**
 * The six scientific modalities this router translates. Each maps to one real
 * expert model running on GPU behind the expert-translator provider. The main
 * agent (DeepSeek V4) is text-only, so these non-text inputs must be turned into
 * natural-language evidence before the agent can "see" them.
 */
export type Modality =
  | 'protein' // amino-acid sequence (FASTA) -> ESM-2
  | 'nucleotide' // DNA/RNA sequence (FASTA) -> Nucleotide Transformer
  | 'molecule' // SMILES / small molecule -> ChemLLM
  | 'single_cell' // scRNA-seq expression / marker genes -> SciBERT
  | 'spatial' // spatial transcriptomics (cells x genes + coords) -> SciBERT
  | 'spectrometry'; // MS / spectra peak list -> ChemBERTa

export const MODALITIES: readonly Modality[] = [
  'protein',
  'nucleotide',
  'molecule',
  'single_cell',
  'spatial',
  'spectrometry',
] as const;

export interface ModalityTranslateRequest {
  /** The raw scientific payload as text (FASTA, SMILES, expression matrix, peak list, …). */
  payload: string;
  /**
   * Which expert to use. Omit to let the service auto-detect from the payload.
   * Detection is best-effort; an explicit modality always wins.
   */
  modality?: Modality;
  /** Optional user context so the translator knows what matters. NOT a task to solve. */
  instruction?: string;
  /** Opaque id echoed back into provenance/descriptor (e.g. the upload object id). */
  objectId?: string;
  requestId?: string;
}

/** The natural-language translation of one scientific input. */
export interface ModalityTranslation {
  /** Concise natural-language description composed from real model outputs. */
  summary: string;
  /** Which modality was translated (echoes the resolved modality). */
  modality: Modality;
  /** Which expert model produced the evidence (e.g. `esm2-protein`). */
  model: string;
  /** Whether the modality was auto-detected (`detected`) or caller-supplied (`explicit`). */
  modalitySource: 'explicit' | 'detected';
}
