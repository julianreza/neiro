import { BaseHook, type PredictContext } from "./hooks.js";
export type StabilityProbe = "reorder" | "rename";
export type ReliabilityDecision = "ACCEPT" | "VERIFY" | "ESCALATE";
export interface StabilityVariant {
    name: string;
    order: string[];
    relabel: boolean;
}
export interface VariantOptions {
    nShuffles?: number;
    relabel?: boolean;
    include?: readonly string[] | null;
    reorder?: boolean;
}
export interface CalibrationOptions {
    targetAccuracy?: number;
    maxEscalateAccuracy?: number;
}
export interface OptionStabilityOptions {
    /** Domain-calibrated thresholds; pass null for uncalibrated metrics only. */
    accept: number | null;
    escalate: number | null;
    probes?: "auto" | "all" | StabilityProbe | readonly StabilityProbe[] | null;
    nShuffles?: number;
    relabel?: boolean;
    renameMaxOptions?: number;
    variants?: "full" | "fast" | readonly string[] | null;
    /** Use an explicit seed for cross-language parity with structured states. */
    seed?: string | null;
}
export interface OptionStabilityReport {
    probes: StabilityProbe[];
    option_layout: "parallel" | "sequential";
    decision: ReliabilityDecision | null;
    /** The unrounded mean used by decideReliability and calibrateReliability. */
    soft_stability: number | null;
    stability: number | null;
    rename_stability: number | null;
    reorder_stability: number | null;
    n_variants: number;
    distinct_choices: string[];
    variant_choices: Record<string, string | null>;
    variant_support: Record<string, number>;
}
/** Deterministic option permutations, including the original, with duplicates removed.
 * The CRC32 / Python MT19937 sequence matches laya.hooks.make_variants. Filtering
 * happens after shuffling so a named subset retains the full preset's permutations. */
export declare function makeVariants(labels: readonly string[], seedKey: string, opts?: VariantOptions): StabilityVariant[];
/** Uncalibrated thresholds fail closed; equality with accept accepts, while equality
 * with escalate verifies. A fitted accept of 1.01 accepts no probability score. */
export declare function decideReliability(softStability: number, accept: number | null, escalate?: number | null): ReliabilityDecision | null;
/** Fit [accept, escalate] on labelled examples. Distinct raw scores are candidate
 * cutoffs; equal scores stay together and report JSON can be replayed without rounding.
 * Inputs must be equally sized, non-empty score/label arrays. */
export declare function calibrateReliability(scores: readonly number[], correct: readonly boolean[], opts?: CalibrationOptions): [number, number];
/** Opt-in stability probes, batched with the original choice questions. Metrics are
 * signals for calibration, not correctness probabilities. Layout detection selects
 * probes; it does not add parallel-layout support to a provider. */
export declare class OptionStabilityHook extends BaseHook {
    private readonly accept;
    private readonly escalate;
    private readonly probes;
    private readonly nShuffles;
    private readonly relabel;
    private readonly renameMaxOptions;
    private readonly include;
    private readonly seed;
    private readonly plans;
    constructor(opts: OptionStabilityOptions);
    onPredictStart(ctx: PredictContext): void;
    onPredictEnd(ctx: PredictContext): void;
    onError(ctx: PredictContext): void;
}
