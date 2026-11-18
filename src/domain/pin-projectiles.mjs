import { COMBAT_BEAT_MS, DUCK_COMBAT, deadlineMs, remainingMs } from './combat-clock.mjs';
import { BODY_GRAVITY } from './duck-recoil.mjs';
import { PIN_BLAST } from './pin-blast.mjs';

const DISTANCE = PIN_BLAST.trigger;
const HOP_UP = PIN_BLAST.hop * 1.15,
    HOP_SECONDS = (2 * HOP_UP) / BODY_GRAVITY;
const BASE_RADIUS = DISTANCE * 0.08;
export const PIN_PROJECTILES = Object.freeze({
    hop: Object.freeze({
        near: DISTANCE * 1.4,
        far: DISTANCE * 2.65,
        tellMs: COMBAT_BEAT_MS,
        cooldownMs: COMBAT_BEAT_MS * 5,
        travel: DISTANCE * 1.05,
    }),
    straight: Object.freeze({
        near: DISTANCE * 1.45,
        far: DISTANCE * 4.5,
        tellMs: COMBAT_BEAT_MS,
        cooldownMs: COMBAT_BEAT_MS * 6,
        speed: DISTANCE * 4.3,
        radius: BASE_RADIUS,
        travel: DISTANCE * 5.5,
    }),
    lob: Object.freeze({
        near: DISTANCE * 1.7,
        far: DISTANCE * 4.5,
        tellMs: COMBAT_BEAT_MS * 1.3,
        cooldownMs: COMBAT_BEAT_MS * 7,
        flightMs: COMBAT_BEAT_MS * 1.5,
        radius: BASE_RADIUS,
        blastRadius: DISTANCE * 0.62,
    }),
    maxWarnings: 2,
    maxActive: 5,
    warningGapMs: COMBAT_BEAT_MS * 0.7,
});
const clamp = (x, min, max) => Math.max(min, Math.min(max, x));
const mix = (a, b, t) => a + (b - a) * t;
const sphereSegment = (ax, ay, az, bx, by, bz, r) => {
    const vX = bx - ax,
        vY = by - ay,
        vZ = bz - az,
        t = clamp(-(ax * vX + ay * vY + az * vZ) / (vX * vX + vY * vY + vZ * vZ || 1), 0, 1);
    return Math.hypot(ax + vX * t, ay + vY * t, az + vZ * t) <= r;
};

// First contact, rather than closest approach, determines whether cover arrives in time.
function sphereEntry(ax, ay, az, bx, by, bz, r) {
    const dx = bx - ax,
        dy = by - ay,
        dz = bz - az,
        offset = ax * ax + ay * ay + az * az - r * r;
    if (offset <= 0) return 0;
    const vv = dx * dx + dy * dy + dz * dz,
        approach = ax * dx + ay * dy + az * dz;
    if (vv <= 0 || approach >= 0) return Infinity;
    const discriminant = approach * approach - vv * offset;
    if (discriminant < 0) return Infinity;
    const t = (-approach - Math.sqrt(discriminant)) / vv;
    return t >= 0 && t <= 1 ? t : Infinity;
}
function straightExpiry(p, x, y, distance, a) {
    const dx = p.x - x,
        dy = p.y - y,
        speed = Math.hypot(dx, dy),
        r = p.radius;
    const end = (d, origin, low, high) =>
        d > 0 ? (high - origin) / d : d < 0 ? (low - origin) / d : Infinity;
    if (x < a.left + r || x > a.right - r || y < a.top + r || y > a.bottom - r) return 0;
    return clamp(
        Math.min(
            1,
            speed > 0 ? distance / speed : Infinity,
            end(dx, x, a.left + r, a.right - r),
            end(dy, y, a.top + r, a.bottom - r),
        ),
        0,
        1,
    );
}
function firstBallBlock(p, x, y, z, ballPrevious, limit) {
    let first = Infinity;
    for (const b of ballPrevious) {
        if (
            !b?.end ||
            !b.inWorld ||
            b.ready ||
            b.held ||
            b.life <= 0 ||
            b.vault ||
            b.recalling ||
            b.z > 1e-6 ||
            b.end.vault ||
            b.end.z > 1e-6
        )
            continue;
        const q = b.end,
            radius = b.radius;
        if (Math.hypot(q.x - b.x, q.y - b.y) <= 1e-7) continue;
        const t = sphereEntry(
            x - b.x,
            y - b.y,
            z - (b.z ?? 0) - radius,
            p.x - q.x,
            p.y - q.y,
            p.z - (q.z ?? 0) - radius,
            p.radius + radius,
        );
        if (t <= limit && t < first) first = t;
    }
    return first;
}

function launch(g, u, w) {
    const cfg = PIN_PROJECTILES[w.kind],
        dx = w.targetX - u.x,
        dy = w.targetY - u.y,
        d = Math.hypot(dx, dy) || 1;
    if (w.kind === 'hop') {
        u.projectileHop = true;
        u.vx = dx / HOP_SECONDS;
        u.vy = dy / HOP_SECONDS;
        u.vz = HOP_UP;
        u.z = 0.01;
        return;
    }
    if (g.enemyProjectiles.length >= PIN_PROJECTILES.maxActive) return;
    const p = {
        ...w,
        id: ++g.enemyProjectileSerial,
        radius: cfg.radius,
        x: u.x,
        y: u.y,
        z: DISTANCE * 0.28,
        originX: u.x,
        originY: u.y,
    };
    if (w.kind === 'straight') {
        p.vx = (dx / d) * cfg.speed;
        p.vy = (dy / d) * cfg.speed;
        p.left = cfg.travel;
    } else {
        const duration = cfg.flightMs / (1000 * (g.realTimeScale ?? 1));
        p.vx = dx / duration;
        p.vy = dy / duration;
        p.vz = (BODY_GRAVITY * duration * duration * 0.5 - p.z) / duration;
        p.blastRadius = cfg.blastRadius;
    }
    g.enemyProjectiles.push(p);
    g.enemyProjectileStats[w.kind].fired++;
}

export function stepPinProjectileThreat(g, u) {
    const kind = u.projectilePattern,
        clock = g.combatClock;
    if (!kind || !clock || !g.enemyProjectiles) return false;
    if (u.hp <= 0 || u.stun > 0 || (u.z > 8 && !u.projectileHop)) {
        u.projectileWarning = null;
        return false;
    }
    if (u.projectileHop) return true;
    const active = u.projectileWarning,
        cfg = PIN_PROJECTILES[kind];
    if (active) {
        active.timeMs = remainingMs(clock, active.endsAtMs);
        if (active.timeMs === 0) {
            u.projectileWarning = null;
            u.projectileReadyAtMs = deadlineMs(clock, cfg.cooldownMs);
            launch(g, u, active);
        }
        return true;
    }
    if (
        u.pinBlast ||
        u.attackStage === 'pin-recover' ||
        u.pinSlot?.rack.active ||
        remainingMs(clock, u.projectileReadyAtMs ?? 0) > 0 ||
        remainingMs(clock, g.nextProjectileWarningAtMs) > 0 ||
        g.enemies.filter((e) => e.hp > 0 && e.projectileWarning).length >=
            PIN_PROJECTILES.maxWarnings
    )
        return false;
    const b = g.boss,
        dx = b.x - u.x,
        dy = b.y - u.y,
        d = Math.hypot(dx, dy);
    if (d < cfg.near || d > cfg.far) return false;
    let targetX = b.x,
        targetY = b.y;
    if (kind === 'hop') {
        const a = g.arena,
            pad = u.r + 1;
        targetX = clamp(u.x + (dx / d) * cfg.travel, a.left + pad, a.right - pad);
        targetY = clamp(u.y + (dy / d) * cfg.travel, a.top + pad, a.bottom - pad);
    }
    u.projectileWarning = {
        kind,
        x: u.x,
        y: u.y,
        targetX,
        targetY,
        radius: cfg.blastRadius ?? (kind === 'hop' ? u.r : cfg.radius),
        timeMs: cfg.tellMs,
        durationMs: cfg.tellMs,
        endsAtMs: deadlineMs(clock, cfg.tellMs),
    };
    u.vx = u.vy = 0;
    g.nextProjectileWarningAtMs = deadlineMs(clock, PIN_PROJECTILES.warningGapMs);
    return true;
}

export function stepEnemyProjectiles(g, dt, previousDuck, ballPrevious = null) {
    const shots = g.enemyProjectiles;
    if (!shots?.length) return;
    const b = g.boss,
        a = g.arena,
        duckZ = b.recoil?.z ?? 0;
    const finish = (p, hit) => {
        const stats = g.enemyProjectileStats[p.kind];
        if (!hit) {
            stats.whiff++;
            return;
        }
        const source = p.kind === 'straight' ? 'pin-straight' : 'pin-lob';
        const point =
            p.kind === 'straight' ? { x: p.originX, y: p.originY } : { x: p.targetX, y: p.targetY };
        if (
            g.damageBoss(DUCK_COMBAT.projectileDamage, source, {
                ...point,
                direction: Math.atan2(p.vy, p.vx),
                strength: 0.5,
                damageClass: 'projectile',
            })
        )
            stats.hit++;
        else stats.blocked++;
    };
    g.enemyProjectiles = shots.filter((p) => {
        const oldX = p.x,
            oldY = p.y,
            oldZ = p.z;
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        if (p.kind === 'straight') {
            const distance = p.left;
            p.left -= Math.hypot(p.x - oldX, p.y - oldY);
            const height = b.r * 0.52,
                r = b.r * 0.74 + p.radius;
            const xyZ = [
                oldX - previousDuck.x,
                oldY - previousDuck.y,
                oldZ - (previousDuck.z ?? 0) - height,
                p.x - b.x,
                p.y - b.y,
                p.z - duckZ - height,
                r,
            ];
            if (ballPrevious) {
                const limit = straightExpiry(p, oldX, oldY, distance, a),
                    duckT = sphereEntry(...xyZ),
                    ballT = firstBallBlock(p, oldX, oldY, oldZ, ballPrevious, limit);
                if (Number.isFinite(ballT) && ballT <= duckT) {
                    const stats = g.enemyProjectileStats.straight;
                    stats.shattered = (stats.shattered || 0) + 1;
                    g.fx(
                        'straight-shatter',
                        mix(oldX, p.x, ballT),
                        mix(oldY, p.y, ballT),
                        mix(oldZ, p.z, ballT),
                        p.radius * 1.75,
                        '#c7f4ff',
                    );
                    return false;
                }
                if (duckT <= limit) {
                    finish(p, true);
                    return false;
                }
            } else if (sphereSegment(...xyZ)) {
                finish(p, true);
                return false;
            }
            if (
                p.left <= 0 ||
                p.x < a.left + p.radius ||
                p.x > a.right - p.radius ||
                p.y < a.top + p.radius ||
                p.y > a.bottom - p.radius
            ) {
                finish(p, false);
                return false;
            }
        } else {
            const oldVZ = p.vz;
            p.z += oldVZ * dt - 0.5 * BODY_GRAVITY * dt * dt;
            p.vz -= BODY_GRAVITY * dt;
            if (p.z <= 1e-8) {
                g.fx('pin-lob-burst', p.targetX, p.targetY, 0, p.blastRadius, '#f0a979');
                const t = clamp(
                    (oldVZ + Math.sqrt(oldVZ * oldVZ + 2 * BODY_GRAVITY * oldZ)) /
                        (BODY_GRAVITY * dt),
                    0,
                    1,
                );
                const x = mix(previousDuck.x, b.x, t),
                    y = mix(previousDuck.y, b.y, t),
                    z = mix(previousDuck.z ?? 0, duckZ, t);
                finish(
                    p,
                    z <= BASE_RADIUS * 2 &&
                        Math.hypot(x - p.targetX, y - p.targetY) <= p.blastRadius,
                );
                return false;
            }
        }
        return true;
    });
}
