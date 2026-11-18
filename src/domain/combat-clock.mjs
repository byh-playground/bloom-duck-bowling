// Only the new real-time combat windows use this clock. The existing physics and dash step stay unchanged.
export const COMBAT_BEAT_MS = 500;
const MAX_HP = 100,
    HITS_TO_DEFEAT = 5,
    CONTACT_DAMAGE = MAX_HP / HITS_TO_DEFEAT;
export const DUCK_COMBAT = Object.freeze({
    maxHp: MAX_HP,
    hitsToDefeat: HITS_TO_DEFEAT,
    damagePerHit: CONTACT_DAMAGE,
    projectileDamage: CONTACT_DAMAGE / 2,
    roomHealFraction: 0.2,
});
export const combatClock = () => ({
    nowMs: 0,
    remainderMs: 0,
    damageReadyAtMs: 0,
    nextPinWarningAtMs: 0,
});
export const deadlineMs = (clock, windowMs) => clock.nowMs + windowMs;
export const remainingMs = (clock, endAtMs) => Math.max(0, endAtMs - clock.nowMs);
export function advanceCombatClock(clock, seconds, realTimeScale) {
    const elapsedMs = clock.remainderMs + seconds * realTimeScale * 1000;
    const wholeMs = Math.floor(elapsedMs + 1e-9);
    clock.nowMs += wholeMs;
    clock.remainderMs = elapsedMs - wholeMs;
}
