// Mulberry32. Each consumer owns its own seed and draw sequence.
export function nextRandom(previous) {
    const seed = (previous + 0x6d2b79f5) >>> 0;
    let n = Math.imul(seed ^ (seed >>> 15), seed | 1);
    n ^= n + Math.imul(n ^ (n >>> 7), n | 61);
    return { seed, value: ((n ^ (n >>> 14)) >>> 0) / 4294967296 };
}
