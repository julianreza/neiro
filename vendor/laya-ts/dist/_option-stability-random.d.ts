/** Python's integer-seeded random.Random, restricted to the shuffle operation used by
 * option stability. Keep it private: changing the RNG changes which probes run. */
export declare class StabilityRandom {
    private readonly state;
    private index;
    constructor(seedKey: string);
    private next;
    private below;
    shuffle<T>(values: T[]): void;
}
