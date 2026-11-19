import { mapUnlocksForStage, MAX_RECORD_STAGE } from '../domain/arena.mjs';

// Only this game's versioned record is touched. Unlocks add choices, never permanent power.
export const PROFILE_KEY = 'physics-boss-lab:bowling:profile:v1';
export function defaultProfile() {
    return { version: 1, runs: 0, wins: 0, bestStage: 0, unlocks: [] };
}
const integer = (n, max = 1000000) => (Number.isSafeInteger(n) && n >= 0 ? Math.min(n, max) : 0);
function validated(value) {
    if (!value || typeof value !== 'object' || value.version !== 1) return defaultProfile();
    const runs = integer(value.runs),
        wins = Math.min(runs, integer(value.wins)),
        bestStage = integer(value.bestStage, MAX_RECORD_STAGE);
    const unlocks = [];
    if (bestStage >= 3) unlocks.push('spinner');
    unlocks.push(...mapUnlocksForStage(bestStage));
    return { version: 1, runs, wins, bestStage, unlocks };
}
export function loadProfile(storage) {
    try {
        return validated(JSON.parse(storage?.getItem(PROFILE_KEY) || 'null'));
    } catch {
        return defaultProfile();
    }
}
export function saveProfile(storage, profile) {
    try {
        if (!storage || typeof storage.setItem !== 'function') return false;
        storage.setItem(PROFILE_KEY, JSON.stringify(validated(profile)));
        return true;
    } catch {
        return false;
    }
}
// `stage` is the highest reached room, including the room in which a run ended.
export function recordRun(profile, { stage = 0, won = false, total = 8 } = {}) {
    const p = validated(profile);
    return validated({
        ...p,
        runs: Math.min(1000000, p.runs + 1),
        wins: p.wins + (won === true ? 1 : 0),
        bestStage: Math.max(
            p.bestStage,
            won === true ? integer(total, MAX_RECORD_STAGE) : integer(stage, MAX_RECORD_STAGE),
        ),
    });
}
export function resetProfile(storage) {
    try {
        if (!storage || typeof storage.removeItem !== 'function') return false;
        storage.removeItem(PROFILE_KEY);
        return true;
    } catch {
        return false;
    }
}
