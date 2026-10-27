import type { TokenizerLike } from "./tokenizer.js";
export type QType = "choice" | "score" | "noul";
export interface InternalQ {
    t: QType;
    ins: string;
    crit: unknown;
    labels?: {
        false: string;
        true: string;
    };
    /** The caller's option indices in the order the head should see them: slot `s` shows option
    `optionOrder[s]`. Set by `toInternal` from a question's `option_order`. */
    optionOrder?: number[];
}
export declare function serializeState(state: unknown): string;
/** The text of a criterion: the string itself, else the JSON the model was shown.
 *
 * Exported because `agent.ts` needs it for a `score` answer's `legend`, which maps an index to the
 * text of that level. Putting the raw value in made the response's JSON types depend on the
 * caller's input -- a numeric scale came back as `{"0": 1}`, a boolean as `{"0": true}` and a null
 * as `{"0": null}`, which a Jev client refuses to parse (#302).
 */
export declare function renderCriterion(v: unknown): string;
export declare function renderOptions(q: InternalQ): string[];
export interface OptionStats {
    /** Options the question defines, not the markers that survived the sequence clamp. */
    total: number;
    /** How many of them still have a token span of their own. */
    distinct: number;
    /** The per-option cap the head budget forced, or null when none was applied. */
    tokens_per_option: number | null;
}
export interface QuestionPrefix {
    /** [CLS] head [SEP] options [SEP] — the state-independent part of the sequence. */
    ids: number[];
    /** Mask-marker positions (absolute; the prefix sits at the start of the final sequence). */
    markers: number[];
    nOptions: number;
    optionStats: OptionStats;
}
export declare function buildQuestionPrefix(tok: TokenizerLike, q: InternalQ, maxLen?: number, headMaxLen?: number, optionOrder?: number[]): QuestionPrefix;
export interface SequenceStats {
    /** Encoded length of the full state, before the window clamp. */
    state_tokens: number;
    /** State tokens that actually reached the encoder after the final maxLen clamp. */
    state_tokens_used: number;
    /** State tokens dropped by the clamp: state_tokens - state_tokens_used. */
    state_tokens_dropped: number;
    /** True when the clamp dropped any state token. */
    truncated: boolean;
    /** What the head budget did to this question's options (Python `build_sequence`'s other stats). */
    options: OptionStats;
}
/** Append pre-encoded state tokens to a question prefix. Identical output to building the
 * whole sequence in one pass, but the state only needs encoding once per state, not once
 * per (state, question) pair.
 *
 * The state is clamped to whatever room the head leaves; `stats` reports that clamp so callers
 * never have to guess it from the character length of what they sent (issue #174, Python #181). */
export declare function sequenceWithState(prefix: QuestionPrefix, stateIds: number[], sepId: number, maxLen?: number, truncateLeft?: boolean): {
    ids: number[];
    markers: number[];
    stats: SequenceStats;
};
/** The questions whose options no longer have a token span each, keyed by question id.
 *
 * `total` is what the question defines, not the number of markers that reached the sequence, so a
 * report cannot say "43 of 43" about a question whose 28 missing options never entered the input
 * at all. Mirrors Python `laya.common.collapsed_options`; empty when nothing collapsed, which is
 * the overwhelming majority of requests, so the agents add the key only when it says something. */
export declare function collapsedOptions(qids: string[], stats: (SequenceStats | undefined)[]): Record<string, OptionStats>;
export declare function buildSequence(tok: TokenizerLike, state: unknown, q: InternalQ, maxLen?: number, headMaxLen?: number, optionOrder?: number[], truncateLeft?: boolean): {
    ids: number[];
    markers: number[];
    stats: SequenceStats;
};
/** Put a slot-ordered probability row back into the caller's option order.
 *
 * `buildQuestionPrefix` puts option `order[s]` in slot `s`, so a head row comes back indexed by
 * slot, while everything downstream indexes by option -- `keys[best]` for a choice, `i * p[i]` for a
 * score level, `p[1]` for noul-true. Without the inverse the probabilities stay attached to the
 * wrong options, which is silent. Mirrors `laya.common.unpermute_probs` (`laya/common.py:557`): a
 * missing order, or one whose length is not the row's, returns the row untouched, so the canonical
 * path is unaffected. */
export declare function unpermuteProbs(p: number[], order?: number[] | null): number[];
export declare function softmax(z: number[]): number[];
export declare function confidenceFromProbs(p: number[]): number;
export declare function answerConfidence(p: number[]): number;
/** The option types and option-count sizes `optionBucket`/`tempBucket` can produce. The bucket
 *  type and the runtime `BUCKET_KEY` check below are both derived from these, so what the type
 *  accepts cannot drift from the keys the runtime produces. */
declare const BUCKET_TYPES: readonly ["choice", "score", "noul"];
declare const BUCKET_SIZES: readonly ["2", "3-5", "6-10", "11+"];
/** One bucket key the runtime can produce, e.g. "choice:2" or "score:11+". */
export type MinConfidenceBucket = `${(typeof BUCKET_TYPES)[number]}:${(typeof BUCKET_SIZES)[number]}`;
/** A `MinConfidenceMap` key: a bucket the runtime can produce, or "default" for the rest. */
export type MinConfidenceKey = MinConfidenceBucket | "default";
export type MinConfidenceMap = {
    [K in MinConfidenceKey]?: number;
};
export type MinConfidence = number | MinConfidenceMap;
/**
 * Validate a per-bucket abstention-threshold map (#394).
 *
 * Keys are option-count bucket strings like "choice:2", "choice:3-5", "score:6-10", "noul:2",
 * plus an optional "default". Values are numbers in [0.0, 1.0].
 */
export declare function checkMinConfidenceMap(m: unknown): MinConfidenceMap;
/**
 * Validate opt-in abstention threshold `min_confidence` (#361, #394).
 *
 * Either a real number in [0.0, 1.0] or a per-bucket mapping. Booleans are rejected.
 */
export declare function checkMinConfidence(v: unknown): MinConfidence;
export declare function optionBucket(answer: Record<string, unknown>): string | null;
export declare function resolveMinConfidence(answer: Record<string, unknown>, thresholds: MinConfidenceMap, defaultVal?: number): number;
/**
 * Opt-in abstention marker (#361, #394): flag answers whose confidence falls below `min_confidence`.
 *
 * Reads `answer_confidence` (the calibrated max(p) confidence, invariant to label count k),
 * falling back to `confidence` whenever `answer_confidence` is not a usable number -- see
 * `gateConfidence`, which mirrors Python's `_gate_confidence`.
 * The raw answer and confidence stay intact; `low_confidence: true` is added when the answer
 * falls below the threshold, and removed if a previously-flagged answer now clears it (e.g.
 * when a result dict is reused or re-evaluated with a different threshold).
 *
 * Supports both a scalar number in [0.0, 1.0] and a per-bucket mapping of thresholds.
 *
 * Exactly 0.0 runs this same loop rather than short-circuiting out of it. Nothing falls below
 * it, so it marks no answer -- and the pass is what clears a marker an earlier, stricter threshold
 * left on a reused payload (#910).
 */
export declare function flagLowConfidence(results: Array<Record<string, unknown>> | Record<string, unknown>, minConfidence: MinConfidence): void;
export declare const TEMP_MIN = 0.5, TEMP_MAX = 5;
/**
 * A usable temperature: `t` confined to [`TEMP_MIN`, `TEMP_MAX`], falling back to the neutral 1.0
 * when it is not a number. Parity with py `common.clamp_temperature`, which asks that question with
 * `float()`.
 *
 * `Number()` asks it more loosely, so a value that is not a number at all reaches the clamp as one.
 * Measured as `clamp_temperature(t)` / `clampTemperature(t)` over the values a checkpoint config can
 * hold:
 *
 *     t        py     ts (before)
 *     " "      1.0    0.5     Number(" ") is 0, float(" ") raises
 *     []       1.0    0.5     Number([]) is 0
 *     [2]      1.0    2.0     Number([2]) is 2
 *     ["2"]    1.0    2.0     Number(["2"]) is 2
 *
 * The nested lists are the worse half: 2.0 is inside the range, so the loader's own diagnostic
 * compared it, found it equal, and said nothing about the value the reference refuses outright.
 * Whichever number landed then scales the logits every published confidence comes from. Take an
 * answer the neutral 1.0 puts at 0.60: the port's old 0.5 reads it as 0.69 among two options and
 * 0.92 among six, and its old 2.0 reads the same answer as 0.55 and 0.35. So one malformed field
 * made a coin flip look certain or a real preference look like noise, depending on which way
 * `Number()` happened to coerce it. Only a number, or a string that holds one, reaches the clamp.
 */
export declare function clampTemperature(t: unknown): number;
export declare function tempBucket(qtype: number, k: number): string;
export interface BinningEntry {
    bins: number;
    values: number[];
}
export type BinningMap = Record<string, BinningEntry>;
/**
 * Validate a histogram-binning recalibration map.
 *
 * Keys are option-count bucket strings like "choice:2", "choice:3-5", "score:6-10", "noul:2".
 * Values are objects with an integer `bins >= 1` and a `values` array of length `bins`
 * where each number is in [0.0, 1.0].
 */
export declare function checkBinningMap(m: unknown): BinningMap;
/**
 * Recalibrate one `answer_confidence` for its option-count `bucket` (tempBucket).
 *
 * Returns the confidence unchanged when the map has no entry for the bucket, so a bucket the map
 * was not fit for passes through rather than being forced to a wrong value.
 */
export declare function applyBinningMap(confidence: number, bucket: string, binningMap?: BinningMap | null): number;
/** Max of a length list without spread (Math.max(...arr) throws RangeError past ~100k args). */
export declare function maxOf(values: ArrayLike<number>, fallback?: number): number;
export interface CollateItem {
    ids: number[];
    markers: number[];
    qtype: number;
    label?: number;
    target?: number[];
    [k: string]: unknown;
}
export interface CollatedBatch {
    inputIds: number[][];
    attentionMask: number[][];
    markerPos: number[][];
    markerMask: boolean[][];
    qtype: number[];
    label: number[];
    meta: Record<string, unknown>[];
    target?: number[][];
}
/** TS parity of py `collate_items(batch, pad_id)`: batch = list of groups. */
export declare function collateItems(batch: CollateItem[][], padId: number): CollatedBatch | null;
export {};
