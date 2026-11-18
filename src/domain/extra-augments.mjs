import { MEANINGFUL_BALL_IMPACT } from './ball-vault.mjs';

const CAROM_SECONDS = 2;
const MAGNET = Object.freeze({ durationMs: 650, radius: 145, acceleration: 180, maxFields: 3 });

export function armExtraAugments(g, b) {
    b.caromArmed = g.augments.includes('ball-collision');
    b.magnetArmed = g.augments.includes('pin-magnet');
}

const groundBody = (b) =>
    b.inWorld && !b.ready && !b.held && !b.vault && !b.recalling && (b.z || 0) === 0;

function sweptContact(source, previous, target) {
    const r = source.r + target.r;
    const ax = previous.x - target.x,
        ay = previous.y - target.y,
        vx = source.x - previous.x,
        vy = source.y - previous.y;
    const vv = vx * vx + vy * vy,
        dot = ax * vx + ay * vy,
        sq = ax * ax + ay * ay - r * r;
    const determinant = dot * dot - vv * sq;
    if (determinant < 0 || vv < 1e-9) return null;
    const t = sq <= 0 ? 0 : (-dot - Math.sqrt(determinant)) / vv;
    if (t < 0 || t > 1) return null;
    const x = ax + vx * t,
        y = ay + vy * t,
        d = Math.hypot(x, y);
    if (d < 1e-6) return null;
    return {
        nx: -x / d,
        ny: -y / d,
        x: target.x + (x * target.r) / d,
        y: target.y + (y * target.r) / d,
    };
}

export function stepBallCaroms(g, previous) {
    if (!g.augments?.includes('ball-collision')) return;
    for (const source of g.balls) {
        const old = previous[source.id];
        if (
            !source.caromArmed ||
            !groundBody(source) ||
            source.life <= 0 ||
            !groundBody(old) ||
            old.life <= 0 ||
            source.wallHit
        )
            continue;
        for (const target of g.balls) {
            if (
                target === source ||
                !groundBody(target) ||
                !groundBody(previous[target.id]) ||
                previous[target.id].life > 0 ||
                target.life > 0 ||
                target.cooldown <= 0
            )
                continue;
            const contact = sweptContact(source, old, target);
            if (!contact) continue;
            const { nx, ny, x, y } = contact;
            const closing = (source.vx - target.vx) * nx + (source.vy - target.vy) * ny;
            if (closing <= MEANINGFUL_BALL_IMPACT) continue;
            const invA = 1 / source.mass,
                invB = 1 / target.mass;
            const restitution =
                ((source.physical?.restitution ?? 0.48) + (target.physical?.restitution ?? 0.48)) *
                0.5;
            const impulse = ((1 + restitution) * closing) / (invA + invB);
            source.vx -= nx * impulse * invA;
            source.vy -= ny * impulse * invA;
            target.vx += nx * impulse * invB;
            target.vy += ny * impulse * invB;
            // End the crossing at the hull if this substep advanced the incoming ball into it.
            if ((target.x - source.x) * nx + (target.y - source.y) * ny < source.r + target.r) {
                source.x = target.x - nx * (source.r + target.r);
                source.y = target.y - ny * (source.r + target.r);
            }
            source.caromArmed = false;
            Object.assign(target, {
                life: CAROM_SECONDS,
                cooldown: 0,
                age: 0,
                lastTrail: -1,
                hookTime: 0,
                hookTurn: 0,
                spin: 0,
                chain: 0,
                scoreSerial: source.scoreSerial,
                caromArmed: false,
                magnetArmed: false,
                secondRoll: null,
                vaultArmed: false,
            });
            target.hitIds.clear();
            g.ballCollisionCount = (g.ballCollisionCount ?? 0) + 1;
            g.lastBallCollision = {
                ballId: source.id,
                struckBallId: target.id,
                x,
                y,
                serial: source.scoreSerial,
            };
            g.fx('ball-carom', x, y, 0, source.r, '#ffe5ad');
            break;
        }
    }
}

export function startPinMagnet(g, b, u) {
    if (
        !b.magnetArmed ||
        b.held ||
        b.echo ||
        b.recalling ||
        !b.inWorld ||
        b.ready ||
        b.life <= 0 ||
        g.balls[b.id] !== b
    )
        return;
    b.magnetArmed = false;
    const fields = (g.pinMagnets ??= []);
    const same = fields.find((v) => v.pinId === u.id);
    const field = {
        pinId: u.id,
        x: u.x,
        y: u.y,
        radius: MAGNET.radius,
        durationMs: MAGNET.durationMs,
        remainingMs: MAGNET.durationMs,
    };
    if (same) Object.assign(same, field);
    else {
        if (fields.length >= MAGNET.maxFields) fields.shift();
        fields.push(field);
    }
    g.pinMagnetCount = (g.pinMagnetCount ?? 0) + 1;
    g.fx('pin-magnet-start', field.x, field.y, 0, field.radius, '#dcbaff');
}

export function stepPinMagnets(g, dt) {
    const fields = g.pinMagnets;
    if (!fields?.length) return;
    for (const field of fields) {
        const source = g.enemies.find((u) => u.id === field.pinId);
        if (source?.hp > 0) {
            field.x = source.x;
            field.y = source.y;
        }
        const aliveDt = Math.min(dt, field.remainingMs / 1000);
        for (const u of g.enemies) {
            if (u === source || u.hp <= 0 || u.z > 30 || u.pinBlast || u.projectileWarning)
                continue;
            const dx = field.x - u.x,
                dy = field.y - u.y,
                d = Math.hypot(dx, dy);
            if (d <= u.r || d >= field.radius) continue;
            // A gentle acceleration only; chain damage still requires a real collision.
            const delta =
                (MAGNET.acceleration * (1 - (d / field.radius) ** 2) * aliveDt) / Math.sqrt(u.mass);
            u.vx += (dx / d) * delta;
            u.vy += (dy / d) * delta;
            if (u.pinSlot) u.pinSlot.rack.active = false;
        }
        field.remainingMs -= aliveDt * 1000;
    }
    g.pinMagnets = fields.filter((f) => f.remainingMs > 1e-6);
}
