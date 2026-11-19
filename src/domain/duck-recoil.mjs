import { resolveReflectors } from './terrain.mjs';
import { COMBAT_BEAT_MS, deadlineMs, remainingMs } from './combat-clock.mjs';
import { MANUAL } from './locomotion.mjs';
import { PIN_BLAST } from './pin-blast.mjs';

export const BODY_GRAVITY = 640; // Same constant acceleration as airborne pins.
const TURN = Math.PI * 2;
export const DUCK_RECOIL = Object.freeze({
    controlLockMs: COMBAT_BEAT_MS * 0.2,
    maxSettleMs: COMBAT_BEAT_MS * 1.8,
    speed: PIN_BLAST.flightSpeed * 0.8,
    hop: PIN_BLAST.hop * 0.8,
    maxSpeed: PIN_BLAST.flightSpeed * 1.5,
    carry: 0.25,
    wallBounce: 0.4,
    airDrag: 0.9,
    groundDrag: 8,
    steerBrake: 0.25,
    spin: TURN * 2.4,
});
export const duckDashOpen = (b) => !b.recoil?.locked;
export const duckAimOpen = (b) => !b.recoil || (!b.recoil.locked && b.recoil.landed);

export function startDuckRecoil(g, impact) {
    const b = g.boss,
        clock = g.combatClock;
    if (!clock || !Number.isFinite(impact?.x) || !Number.isFinite(impact?.y)) return false;
    const prev = b.recoil,
        dx = b.x - impact.x,
        dy = b.y - impact.y,
        n = Math.hypot(dx, dy);
    // Exact overlap uses the committed push direction if available, otherwise the duck's current heading.
    const direction =
        n > 1e-6
            ? Math.atan2(dy, dx)
            : Number.isFinite(impact.direction)
              ? impact.direction
              : b.facing;
    const strength = Number.isFinite(impact.strength) ? impact.strength : 1,
        scale = DUCK_RECOIL.speed * strength;
    let vx = Math.cos(direction) * scale + (prev?.vx ?? b.moveVx ?? 0) * DUCK_RECOIL.carry;
    let vy = Math.sin(direction) * scale + (prev?.vy ?? b.moveVy ?? 0) * DUCK_RECOIL.carry;
    const limit = Math.min(1, DUCK_RECOIL.maxSpeed / (Math.hypot(vx, vy) || 1));
    vx *= limit;
    vy *= limit;
    b.recoil = {
        vx,
        vy,
        z: Math.max(prev?.z ?? 0, 0),
        vz: Math.max(prev?.vz ?? 0, DUCK_RECOIL.hop),
        roll: 0,
        omega: DUCK_RECOIL.spin * (Math.cos(direction) >= 0 ? 1 : -1),
        fromAngle: direction,
        landed: false,
        locked: true,
        controlled: false,
        unlockAtMs: deadlineMs(clock, DUCK_RECOIL.controlLockMs),
        settleAtMs: deadlineMs(clock, DUCK_RECOIL.maxSettleMs),
    };
    b.dashRemaining = 0;
    // Both pose phases yield to the impact; an already released ball is not touched.
    b.delivery = null;
    b.aiming = false;
    b.aimPower = 0;
    b.facing = direction;
    g.lastBodyImpact = { x: impact.x, y: impact.y, angle: direction, time: g.time };
    return true;
}

export function controlDuckRecoil(b) {
    const r = b.recoil;
    if (!r || r.controlled) return;
    r.controlled = true;
    r.vx *= DUCK_RECOIL.steerBrake;
    r.vy *= DUCK_RECOIL.steerBrake;
    if (r.vz > 0) r.vz = 0; // The dash redirects the climb without snapping the player to the floor.
}

function rebound(position, vel, min, max) {
    if (position < min)
        return {
            p: min + (min - position) * DUCK_RECOIL.wallBounce,
            v: Math.abs(vel) * DUCK_RECOIL.wallBounce,
        };
    if (position > max)
        return {
            p: max - (position - max) * DUCK_RECOIL.wallBounce,
            v: -Math.abs(vel) * DUCK_RECOIL.wallBounce,
        };
    return null;
}

export function stepDuckRecoil(g, dt) {
    const b = g.boss,
        r = b.recoil;
    if (!r) return;
    const oldX = b.x,
        oldY = b.y;
    const nextX = oldX + r.vx * dt,
        nextY = oldY + r.vy * dt,
        hits = [],
        w = g.duckBounds ?? MANUAL;
    const x = rebound(nextX, r.vx, w.minX, w.maxX),
        y = rebound(nextY, r.vy, w.minY, w.maxY);
    b.x = x ? x.p : nextX;
    b.y = y ? y.p : nextY;
    if (x) {
        r.vx = x.v;
        hits.push(nextX < w.minX ? 'left' : 'right');
    }
    if (y) {
        r.vy = y.v;
        hits.push(nextY < w.minY ? 'top' : 'bottom');
    }
    if (hits.length) {
        r.omega *= -DUCK_RECOIL.wallBounce;
        g.lastBodyWall = { x: b.x, y: b.y, sides: hits, time: g.time };
    }
    if (!r.landed) {
        r.vz -= BODY_GRAVITY * dt;
        r.z += r.vz * dt;
        r.roll += r.omega * dt;
        if (r.z <= 0) {
            r.z = 0;
            r.vz = 0;
            r.landed = true;
            g.fx('land', b.x, b.y, 0, b.r * 0.6, '#e6d6a8');
        }
    } else {
        const destination = Math.round(r.roll / TURN) * TURN;
        r.roll = destination + (r.roll - destination) * Math.exp(-DUCK_RECOIL.groundDrag * dt);
    }
    if (g.arena?.reflectors) {
        resolveReflectors(b, g.arena.reflectors, r.z, DUCK_RECOIL.wallBounce, r);
        b.x = Math.max(w.minX, Math.min(w.maxX, b.x));
        b.y = Math.max(w.minY, Math.min(w.maxY, b.y));
    }
    const decay = Math.exp(-(r.landed ? DUCK_RECOIL.groundDrag : DUCK_RECOIL.airDrag) * dt);
    r.vx *= decay;
    r.vy *= decay;
    r.locked = remainingMs(g.combatClock, r.unlockAtMs) > 0;
    const d = Math.hypot(b.x - oldX, b.y - oldY);
    b.moveDistance += d;
    b.moving = b.moving || d > 1e-6;
    b.homeX = b.x;
    b.homeY = b.y;
    if (
        r.landed &&
        (remainingMs(g.combatClock, r.settleAtMs) === 0 ||
            (r.controlled && Math.hypot(r.vx, r.vy) < 3))
    )
        b.recoil = null;
}
