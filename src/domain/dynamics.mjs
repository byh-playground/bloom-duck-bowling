import { PHYSICS_STEP_SECONDS } from './timing.mjs';
import { ARENA } from './arena.mjs';
// One collision-free integrator is shared by the live ball and preview.
export const BALL_TYPES = {
    basic: {
        name: '기본',
        mass: 16,
        speed: 1,
        drag: 0.29,
        bounce: 0.72,
        topBounce: 0.7,
        curve: 1.25,
    },
    heavy: {
        name: '중량',
        mass: 32,
        speed: 0.78,
        drag: 0.2,
        bounce: 0.48,
        topBounce: 0.48,
        curve: 0.6,
    },
    spinner: {
        name: '회전',
        mass: 13,
        speed: 0.92,
        drag: 0.29,
        bounce: 0.78,
        topBounce: 0.78,
        curve: 2.2,
    },
    rubber: {
        name: '탄성',
        mass: 9,
        speed: 1,
        drag: 0.18,
        bounce: 0.94,
        topBounce: 0.94,
        curve: 1.75,
    },
};
export const HOOK = { tau: 1.1, maxRate: 2.2 };
export function prepareRoll({ vx = 0, vy = 0, type = 'basic', spin = 0, mods = {}, ...rest }) {
    const key = Object.hasOwn(BALL_TYPES, type) ? type : 'basic',
        p = BALL_TYPES[key],
        speed = Math.hypot(vx, vy),
        scale = speed ? (Math.min(speed, 1080) / speed) * p.speed * (mods.speed ?? 1) : 0;
    const physical = {
        drag: p.drag * (mods.drag ?? 1),
        bounce: Math.min(0.99, p.bounce + (mods.bounce ?? 0)),
        topBounce: Math.min(0.99, p.topBounce + (mods.bounce ?? 0)),
        curve: p.curve * (mods.curve ?? 1),
        restitution: 0.48 + (mods.restitution ?? 0),
    };
    return {
        ...rest,
        hookTime: 0,
        hookTurn: 0,
        physical,
        r: Math.max(16, Math.min(32, 23 + (mods.radius ?? 0))),
        type: key,
        spin: Math.max(-1, Math.min(1, Number.isFinite(spin) ? spin : 0)),
        vx: vx * scale,
        vy: vy * scale,
        mass: p.mass * (mods.mass ?? 1),
    };
}
export const ROLL_BOUNDS = Object.freeze({
    left: ARENA.left,
    right: ARENA.right,
    top: ARENA.top,
    bottom: ARENA.bottom,
});
export function rollBounds(radius = 23, arena = ARENA) {
    const pad = radius + 1;
    return {
        left: arena.left + pad,
        right: arena.right - pad,
        top: arena.top + pad,
        bottom: arena.bottom - pad,
    };
}
export function clampRollPoint(point, radius = 23, arena = ARENA) {
    const w = rollBounds(radius, arena);
    return {
        ...point,
        x: Math.max(w.left, Math.min(w.right, point.x)),
        y: Math.max(w.top, Math.min(w.bottom, point.y)),
    };
}
export function stepRoll(b, dt, arena = b.arena) {
    if (!Number.isFinite(dt) || dt <= 0) return b;
    const p = b.physical || BALL_TYPES[b.type] || BALL_TYPES.basic,
        rate = Math.max(-HOOK.maxRate, Math.min(HOOK.maxRate, (b.spin || 0) * p.curve)),
        time = b.hookTime || 0,
        turn = rate * HOOK.tau * (Math.exp(-time / HOOK.tau) - Math.exp(-(time + dt) / HOOK.tau)),
        c = Math.cos(turn),
        s = Math.sin(turn),
        vx = b.vx * c - b.vy * s,
        vy = b.vx * s + b.vy * c;
    b.hookTime = time + dt;
    b.hookTurn = (b.hookTurn || 0) + turn;
    b.vx = vx;
    b.vy = vy;
    b.x += vx * dt;
    b.y += vy * dt;
    b.angle = (b.angle || 0) + (Math.hypot(vx, vy) * dt) / (b.r || 23);
    const drag = Math.exp(-p.drag * dt);
    b.vx *= drag;
    b.vy *= drag;
    b.wallHit = false;
    b.wallHitSides = [];
    const w = rollBounds(b.r || 23, arena);
    if (b.x < w.left) {
        b.x = w.left;
        if (b.vx < 0) {
            b.vx = -b.vx * p.bounce;
            b.wallHit = true;
            b.wallHitSides.push('left');
        }
    } else if (b.x > w.right) {
        b.x = w.right;
        if (b.vx > 0) {
            b.vx = -b.vx * p.bounce;
            b.wallHit = true;
            b.wallHitSides.push('right');
        }
    }
    if (b.y < w.top) {
        b.y = w.top;
        if (b.vy < 0) {
            b.vy = -b.vy * p.bounce;
            b.wallHit = true;
            b.wallHitSides.push('top');
        }
    } else if (b.y > w.bottom) {
        b.y = w.bottom;
        if (b.vy > 0) {
            b.vy = -b.vy * p.bounce;
            b.wallHit = true;
            b.wallHitSides.push('bottom');
        }
    }
    return b;
}
// Inputs are the unprofiled launch velocity, just like BowlingGame.launch.
export function predictRoll(input, duration = 1.1) {
    const b = prepareRoll({ ...input, r: 23 }),
        points = [{ x: b.x, y: b.y, vx: b.vx, vy: b.vy, time: 0 }];
    let t = 0;
    while (t < duration - 1e-9) {
        const dt = Math.min(PHYSICS_STEP_SECONDS, duration - t);
        stepRoll(b, dt);
        t += dt;
        points.push({ x: b.x, y: b.y, vx: b.vx, vy: b.vy, time: t });
        if (Math.hypot(b.vx, b.vy) < 85) break;
    }
    return points;
}
