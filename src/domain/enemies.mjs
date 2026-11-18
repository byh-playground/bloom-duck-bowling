import { enemyDrive } from './timing.mjs';
import { pinBlastDrive } from './pin-blast.mjs';
export const ENEMY_TYPES = {
    grunt: { r: 10, mass: 1, hp: 30, speed: 1 },
    shield: { r: 13, mass: 3, hp: 65, speed: 0.82 },
    bomb: { r: 12, mass: 1.2, hp: 25, speed: 0.9 },
    flag: { r: 12, mass: 1.3, hp: 45, speed: 0.85 },
    hopper: { r: 11, mass: 1, hp: 30, speed: 1, projectilePattern: 'hop' },
    shooter: { r: 11, mass: 1.15, hp: 30, speed: 0.92, projectilePattern: 'straight' },
    lobber: { r: 12, mass: 1.3, hp: 30, speed: 0.88, projectilePattern: 'lob' },
    giant: { r: 32, mass: 18, hp: 650, speed: 0.65, meleePattern: 'elite' },
};
export function configureEnemy(u, kind) {
    const p = ENEMY_TYPES[kind] || ENEMY_TYPES.grunt;
    Object.assign(u, {
        kind: ENEMY_TYPES[kind] ? kind : 'grunt',
        r: p.r,
        mass: p.mass,
        meleePattern: p.meleePattern ?? 'pin-blast',
        projectilePattern: p.projectilePattern,
        hp: p.hp,
        maxHp: p.hp,
        speed: u.speed * p.speed,
        facing: Math.PI / 2,
        fuse: null,
        aura: kind === 'flag' ? 115 : 0,
        giantClock: 2.4,
        giantStage: 'approach',
        giantIndex: 0,
    });
    Object.defineProperty(u, 'armored', {
        enumerable: true,
        get() {
            return (
                this.kind === 'giant' &&
                this.campaignBoss === 'final' &&
                this.giantStage === 'approach' &&
                this.stun <= 0 &&
                this.z < 8
            );
        },
    });
    return u;
}
export function shieldGuardUp(u) {
    return (
        (u.kind === 'shield' || u.armored) &&
        u.stun <= 0 &&
        u.z < 8 &&
        !(u.guardDropsOnRecovery && u.attackStage === 'pin-recover')
    );
}
export function shieldFront(u, ball) {
    return shieldGuardUp(u) && Math.cos(Math.atan2(ball.y - u.y, ball.x - u.x) - u.facing) > 0.5;
}
export function flagSupport(g, u) {
    return g.enemies.some(
        (f) =>
            f !== u &&
            f.kind === 'flag' &&
            f.hp > 0 &&
            f.z < 8 &&
            f.stun <= 0 &&
            Math.hypot(f.x - u.x, f.y - u.y) < 115,
    )
        ? 1.22
        : 1;
}
export function specialDrive(g, u, dt) {
    const b = g.boss;
    u.facing = Math.atan2(b.y - u.y, b.x - u.x);
    if (u.kind !== 'giant') {
        if (u.projectileWarning) return { vx: 0, vy: 0 };
        const blast = pinBlastDrive(u);
        if (blast) return blast;
        const d = enemyDrive(u, b, dt),
            support = flagSupport(g, u);
        u.supported = support > 1;
        const pin = u.pinSlot;
        if (pin?.rack.active) {
            // Use steering rather than teleporting: a scuffed pin still follows the normal contact solver.
            const { nx, ny, travel } = pin.rack,
                dx = pin.x + nx * travel - u.x,
                dy = pin.y + ny * travel - u.y;
            const forward = Math.max(
                0,
                Math.min(pin.speed * 1.45, pin.speed + (dx * nx + dy * ny) * 4),
            );
            const across = Math.max(-25, Math.min(25, (dx * ny - dy * nx) * 4));
            u.facing = Math.atan2(ny, nx);
            return {
                vx: nx * forward + ny * across,
                vy: ny * forward - nx * across,
                stage: d.stage,
            };
        }
        return { ...d, vx: d.vx * support, vy: d.vy * support };
    }
    u.giantClock -= dt;
    if (u.giantClock <= 0) {
        if (u.giantStage === 'approach') {
            u.giantStage = 'warn';
            u.giantClock = 0.9;
            u.giantAttack = u.giantIndex++ % 2 ? 'sweep' : 'charge';
            u.burstNx = Math.cos(u.facing);
            u.burstNy = Math.sin(u.facing);
        } else if (u.giantStage === 'warn') {
            u.giantStage = 'active';
            u.giantClock = 0.65;
            u.giantHit = false;
        } else {
            u.giantStage = 'approach';
            u.giantClock = 2.4;
        }
    }
    u.telegraph = u.giantStage === 'warn' ? 1 - u.giantClock / 0.9 : 0;
    if (u.giantStage === 'warn') return { vx: 0, vy: 0 };
    if (u.giantStage === 'active') {
        if (
            u.giantAttack === 'sweep' &&
            !u.giantHit &&
            Math.hypot(b.x - u.x, b.y - u.y) < u.r + b.r + 60
        ) {
            u.giantHit = true;
            g.damageBoss(g.threatMode ? 30 : 18, 'giant-sweep', { x: u.x, y: u.y, strength: 1.25 });
            g.fx('stomp', u.x, u.y, 0, 100, '#e9a06b');
        }
        return u.giantAttack === 'charge'
            ? { vx: u.burstNx * 145, vy: u.burstNy * 145 }
            : { vx: 0, vy: 0 };
    }
    return { vx: Math.cos(u.facing) * u.speed, vy: Math.sin(u.facing) * u.speed };
}
export function ignite(u) {
    if (u.kind === 'bomb' && u.fuse === null && !u.exploded) u.fuse = 0.65;
}
export function stepBombs(g, dt) {
    for (const u of g.enemies) {
        if (u.fuse === null || u.exploded) continue;
        u.fuse -= dt;
        if (u.fuse > 0) continue;
        u.exploded = true;
        u.fuse = 0;
        if (u.hp > 0) {
            u.hp = 0;
            g.stats.kills++;
            g.scoreDamage?.(u, u.scoreFuseSerial ?? null, { defeated: true });
        }
        g.fx('stomp', u.x, u.y, u.z, 110, '#ffae6f');
        for (const v of g.enemies) {
            if (v === u || v.hp <= 0 || Math.abs(v.z - u.z) > 45) continue;
            const dx = v.x - u.x,
                dy = v.y - u.y,
                d = Math.hypot(dx, dy);
            if (d > 105) continue;
            const nx = dx / (d || 1),
                ny = dy / (d || 1);
            v.vx += (nx * 220) / v.mass;
            v.vy += (ny * 220) / v.mass;
            g.hurt(
                v,
                22,
                nx,
                ny,
                220,
                u.sourceShot,
                Math.min(8, u.chainDepth + 1),
                u.scoreFuseSerial ?? null,
            );
        }
        if (u.z < 40 && Math.hypot(g.boss.x - u.x, g.boss.y - u.y) < 105 + g.boss.r) {
            g.damageBoss(g.threatMode ? 24 : 12, 'bomb', { x: u.x, y: u.y, strength: 1.25 });
        }
    }
}
