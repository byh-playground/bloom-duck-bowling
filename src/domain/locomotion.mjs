import { ARENA } from './arena.mjs';
// Deliberately slower than approaching enemies. No teleport, invulnerability or global path slots.
export const MOBILITY = {
    minX: ARENA.left + 120,
    maxX: ARENA.right - 120,
    minY: 140,
    maxY: 730,
    speed: 32,
    trigger: 170,
    clear: 225,
    decision: 0.32,
};
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
export function freezeMovement(b) {
    b.moveVx = 0;
    b.moveVy = 0;
    b.moving = false;
    b.moveDecision = 0;
    b.homeX = b.x;
    b.homeY = b.y;
}
export function stepMobility(game, dt) {
    const b = game.boss;
    if (b.aiming || b.delivery) {
        freezeMovement(b);
        return;
    }
    const near = game.enemies.filter(
            (u) => u.hp > 0 && u.z < 20 && Math.hypot(u.x - b.x, u.y - b.y) < 300,
        ),
        distance = near.reduce((n, u) => Math.min(n, Math.hypot(u.x - b.x, u.y - b.y)), Infinity);
    b.nearestThreat = distance;
    if (!b.evading && distance < MOBILITY.trigger) b.evading = true;
    else if (b.evading && distance > MOBILITY.clear) b.evading = false;
    b.moveDecision = (b.moveDecision || 0) - dt;
    let goalX = 0,
        goalY = 0;
    if (b.evading) {
        if (b.moveDecision <= 0) {
            b.moveDecision = MOBILITY.decision;
            let best = -Infinity,
                heading = b.moveHeading ?? Math.PI / 2;
            const previous = b.moveHeading;
            for (let i = 0; i < 24; i++) {
                const a = (i * Math.PI) / 12,
                    dx = Math.cos(a),
                    dy = Math.sin(a),
                    reach = 62,
                    px = clamp(b.x + dx * reach, MOBILITY.minX, MOBILITY.maxX),
                    py = clamp(b.y + dy * reach, MOBILITY.minY, MOBILITY.maxY),
                    travel = Math.hypot(px - b.x, py - b.y);
                if (travel < 22) continue;
                let risk = 0,
                    closest = 500;
                for (const u of near) {
                    const predictedX = u.x + u.vx * 0.4,
                        predictedY = u.y + u.vy * 0.4,
                        ex = predictedX - px,
                        ey = predictedY - py,
                        d = Math.hypot(ex, ey);
                    closest = Math.min(closest, d);
                    risk += Math.max(0, 190 - d) ** 2 / 180;
                    const sx = u.x - (b.x + dx * 28),
                        sy = u.y - (b.y + dy * 28);
                    risk += Math.max(0, 82 - Math.hypot(sx, sy)) * 3;
                }
                const edge = Math.min(
                        px - MOBILITY.minX,
                        MOBILITY.maxX - px,
                        py - MOBILITY.minY,
                        MOBILITY.maxY - py,
                    ),
                    continuity = previous == null ? 0 : Math.cos(a - previous) * 18,
                    score =
                        closest * 0.7 -
                        risk +
                        travel * 0.5 +
                        Math.min(45, edge) * 0.32 +
                        continuity;
                if (score > best) {
                    best = score;
                    heading = Math.atan2(py - b.y, px - b.x);
                }
            }
            b.moveHeading = heading;
        }
        goalX = Math.cos(b.moveHeading) * MOBILITY.speed;
        goalY = Math.sin(b.moveHeading) * MOBILITY.speed;
    }
    const k = 1 - Math.exp(-6 * dt);
    b.moveVx = (b.moveVx || 0) + (goalX - (b.moveVx || 0)) * k;
    b.moveVy = (b.moveVy || 0) + (goalY - (b.moveVy || 0)) * k;
    if (!b.evading && Math.hypot(b.moveVx, b.moveVy) < 0.2) b.moveVx = b.moveVy = 0;
    const oldX = b.x,
        oldY = b.y;
    b.x = clamp(b.x + b.moveVx * dt, MOBILITY.minX, MOBILITY.maxX);
    b.y = clamp(b.y + b.moveVy * dt, MOBILITY.minY, MOBILITY.maxY);
    if (b.x === oldX) b.moveVx = 0;
    if (b.y === oldY) b.moveVy = 0;
    const travelled = Math.hypot(b.x - oldX, b.y - oldY);
    b.moveDistance = (b.moveDistance || 0) + travelled;
    b.walkPhase = (b.walkPhase || 0) + travelled * 0.17;
    b.moving = travelled > dt * 1;
    b.homeX = b.x;
    b.homeY = b.y;
}
export function manualBounds(arena = ARENA) {
    return {
        minX: arena.left + 65,
        maxX: arena.right - 65,
        minY: arena.top + 75,
        maxY: arena.bottom - 75,
    };
}
export const MANUAL = {
    speed: 110,
    dashSpeed: 400,
    dashDuration: 0.18,
    burstSpeed: 540,
    burstDuration: 0.2,
    dashCooldown: 0,
    ...manualBounds(),
};
export function stepManual(g, dt) {
    const b = g.boss;
    b.dashCooldown = 0;
    if (b.aiming || b.delivery) {
        b.dashRemaining = 0;
        freezeMovement(b);
        return;
    }
    const remaining = b.dashRemaining || 0,
        dash = remaining > 0;
    const speed = dash
        ? g.dashOnly
            ? MANUAL.burstSpeed
            : MANUAL.dashSpeed
        : g.dashOnly
          ? 0
          : MANUAL.speed;
    const dx = dash ? b.dashX : g.moveInput.x,
        dy = dash ? b.dashY : g.moveInput.y,
        moveDt = dash && g.dashOnly ? Math.min(dt, remaining) : dt;
    b.dashRemaining = Math.max(0, remaining - dt);
    const x = b.x,
        y = b.y,
        w = g.duckBounds ?? MANUAL;
    b.x = clamp(x + dx * speed * moveDt, w.minX, w.maxX);
    b.y = clamp(y + dy * speed * moveDt, w.minY, w.maxY);
    b.moveVx = (b.x - x) / dt;
    b.moveVy = (b.y - y) / dt;
    const d = Math.hypot(b.x - x, b.y - y);
    b.moveDistance += d;
    b.walkPhase += d * 0.17;
    b.moving = d > 0;
    if (g.dashOnly && dash && d > 0 && b.dashTrail) {
        const p = b.dashTrail.at(-1);
        if (Math.hypot(b.x - p.x, b.y - p.y) > 9) {
            b.dashTrail.push({ x: b.x, y: b.y });
            if (b.dashTrail.length > 7) b.dashTrail.shift();
        }
    }
    b.homeX = b.x;
    b.homeY = b.y;
}
