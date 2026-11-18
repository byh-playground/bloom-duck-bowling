import { ARENA } from './arena.mjs';
import { COMBAT_BEAT_MS, DUCK_COMBAT, deadlineMs, remainingMs } from './combat-clock.mjs';

// Telegraph, idle, and spacing are real-time; the recoil uses ordinary bowling physics.
const CLOSE_RANGE = 100;
export const PIN_BLAST = Object.freeze({
    trigger: CLOSE_RANGE,
    radius: CLOSE_RANGE * 1.2,
    recoilGoal: CLOSE_RANGE * 1.5,
    flightSpeed: CLOSE_RANGE * 3,
    hop: CLOSE_RANGE * 2,
    tellMs: COMBAT_BEAT_MS * 0.8,
    recoverMs: COMBAT_BEAT_MS * 2.5,
    gapMs: COMBAT_BEAT_MS * 0.25,
    hitGapMs: COMBAT_BEAT_MS,
    maxWarn: 3,
});
const dot = (x, y, nx, ny) => x * nx + y * ny;
function recoilDirection(u, warn, arena = ARENA) {
    const { nx, ny } = warn;
    const left = arena.left + u.r + 3,
        right = arena.right - u.r - 3,
        top = arena.top + u.r + 3,
        bottom = arena.bottom - u.r - 3;
    const limits = (x, y) =>
        Math.max(
            0,
            Math.min(
                x > 0 ? (right - u.x) / x : x < 0 ? (left - u.x) / x : Infinity,
                y > 0 ? (bottom - u.y) / y : y < 0 ? (top - u.y) / y : Infinity,
            ),
        );
    const original = Math.atan2(ny, nx);
    let chosen = { nx, ny },
        best = -Infinity;
    for (let i = 0; i < 16; i++) {
        const a = original + (i * Math.PI) / 8,
            x = Math.cos(a),
            y = Math.sin(a),
            room = Math.min(PIN_BLAST.recoilGoal, limits(x, y));
        const fx = u.x + x * room,
            fy = u.y + y * room,
            along = dot(x, y, nx, ny);
        // At a rail prefer a clear tangent over striking the wall and rebounding into the duck.
        const value =
            Math.hypot(fx - warn.duckX, fy - warn.duckY) +
            room * 0.3 +
            along * PIN_BLAST.trigger * 0.4;
        if (value > best) {
            best = value;
            chosen = { nx: x, ny: y };
        }
    }
    return chosen;
}
export function isRegularPinBlast(game, u) {
    return !!game.pinBlastMode && u.meleePattern === 'pin-blast';
}
export function pinBlastDrive(u) {
    if (u.attackStage === 'pin-warn' || u.attackStage === 'pin-recover') return { vx: 0, vy: 0 };
    return null;
}
export function stepPinBlast(g, u) {
    const b = g.boss,
        clock = g.combatClock;
    if (u.attackStage === 'pin-recover') {
        if (remainingMs(clock, u.pinRecoveryEndsAtMs) === 0 && u.z <= 8 && u.stun <= 0)
            u.attackStage = 'idle';
        return;
    }
    if (u.hp <= 0 || u.z > 8 || u.stun > 0) {
        u.attackStage = 'idle';
        u.pinBlast = null;
        u.attackTelegraph = 0;
        return;
    }
    const warning = u.pinBlast;
    if (warning) {
        warning.timeMs = remainingMs(clock, warning.endsAtMs);
        u.attackTelegraph = 1 - warning.timeMs / warning.durationMs;
        if (warning.timeMs > 0) return;
        const overlapped = Math.hypot(b.x - warning.x, b.y - warning.y) <= warning.radius;
        const hit =
            overlapped &&
            g.damageBoss(DUCK_COMBAT.damagePerHit, 'pin-blast', {
                x: warning.x,
                y: warning.y,
                direction: Math.atan2(-warning.ny, -warning.nx),
            });
        const dir = recoilDirection(u, warning, g.arena);
        u.pinBlast = null;
        u.attackStage = 'pin-recover';
        u.pinRecoveryEndsAtMs = deadlineMs(clock, PIN_BLAST.recoverMs);
        u.attackTelegraph = 0;
        u.attached = false;
        u.sourceShot = null;
        u.scoreCause = null;
        u.chainDepth = 0;
        u.vx = dir.nx * PIN_BLAST.flightSpeed;
        u.vy = dir.ny * PIN_BLAST.flightSpeed;
        u.z = Math.max(10, u.z);
        u.vz = PIN_BLAST.hop;
        u.spin = (u.id % 2 ? 1 : -1) * 9;
        if (u.pinSlot) u.pinSlot.rack.active = false;
        g.fx('pin-blast', warning.x, warning.y, 0, warning.radius, '#f2a24c');
        g.pinBlastStats.total++;
        if (hit) g.pinBlastStats.hit++;
        else if (!overlapped) g.pinBlastStats.whiff++;
        else g.pinBlastStats.blocked++;
        return;
    }
    const dx = u.x - b.x,
        dy = u.y - b.y,
        d = Math.hypot(dx, dy);
    if (
        d > PIN_BLAST.trigger ||
        remainingMs(clock, clock.nextPinWarningAtMs) > 0 ||
        g.enemies.filter((e) => e.pinBlast && e.hp > 0).length >= PIN_BLAST.maxWarn
    )
        return;
    clock.nextPinWarningAtMs = deadlineMs(clock, PIN_BLAST.gapMs);
    const nx = d > 1e-6 ? dx / d : Math.cos(((u.id % 16) * Math.PI) / 8),
        ny = d > 1e-6 ? dy / d : Math.sin(((u.id % 16) * Math.PI) / 8);
    u.pinBlast = {
        x: u.x,
        y: u.y,
        radius: PIN_BLAST.radius,
        timeMs: PIN_BLAST.tellMs,
        durationMs: PIN_BLAST.tellMs,
        endsAtMs: deadlineMs(clock, PIN_BLAST.tellMs),
        duckX: b.x,
        duckY: b.y,
        nx,
        ny,
    };
    u.attackStage = 'pin-warn';
    u.attackTelegraph = 0;
    u.vx = u.vy = 0;
    if (u.pinSlot) u.pinSlot.rack.active = false;
}
