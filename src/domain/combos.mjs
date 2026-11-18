import { armExtraAugments } from './extra-augments.mjs';
import { armSecondRoll } from './ball-vault.mjs';
import { stepRoll } from './dynamics.mjs';
import { MANUAL } from './locomotion.mjs';

export const AUGMENTS = Object.freeze(
    [
        {
            id: 'dash-double',
            name: '대시 더블샷',
            description: '대시 다음엔 같은 방향과 훅으로 공이 두 번 굴러가요. 공은 1개 써요.',
        },
        { id: 'dash-shove', name: '돌파 대시', description: '대시로 스친 핀을 앞으로 튕겨내요.' },
        {
            id: 'catch-charge',
            name: '회수로 재충전',
            description: '공을 직접 회수하면 대시가 1회 충전돼요.',
        },
        {
            id: 'catch-pulse',
            name: '회수 충격파',
            description: '공을 회수한 자리에서 충격파가 퍼져 주변 핀을 밀어요.',
        },
        {
            id: 'bank-fork',
            name: '벽 튕김 분기',
            description: '공이 옆 벽에 처음 튕길 때 두 갈래로 퍼져요.',
        },
        {
            id: 'dash-recall',
            name: '대시로 공 끌어오기',
            description: '공이 없을 때 대시하면 가까운 공 하나가 도착점으로 돌아와요.',
        },
        {
            id: 'ball-vault',
            name: '점프볼',
            description: '핀을 날리지 못한 공은 한 번 뛰어올라 뒤쪽에 떨어져요.',
        },
        {
            id: 'second-roll',
            name: '두 번째 굴림',
            description: '핀에 맞췄던 공이 멈춰갈 때 한 번 더 톡 튀어 가던 방향으로 굴러요.',
        },
        {
            id: 'ball-collision',
            name: '공끼리 부딪히기',
            description: '던진 공이 바닥에 멈춘 공을 맞히면, 두 공이 부딪힌 방향대로 굴러요.',
        },
        {
            id: 'pin-magnet',
            name: '자석 핀',
            description: '한 투구에서 처음 맞힌 핀이 잠깐 주변 핀을 끌어당겨요.',
        },
        {
            id: 'break-bullet',
            name: '탄환 부수기',
            description: '굴러가는 공이 적의 직선탄에 닿으면 탄환을 깨뜨려요.',
        },
        {
            id: 'air-catch',
            name: '공중 캐치',
            description: '떨어지는 핀을 공으로 맞히면 공이 굴러가던 방향으로 다시 튕겨요.',
        },
        {
            id: 'hook-kick',
            name: '휘감아 넘기기',
            description: '훅에 처음 맞은 핀이 공의 회전 방향으로 튕겨요.',
        },
    ].map(Object.freeze),
);
const clamp = (n, a, b) => Math.max(a, Math.min(b, n));
const rotate = (x, y, a) => ({
    vx: x * Math.cos(a) - y * Math.sin(a),
    vy: x * Math.sin(a) + y * Math.cos(a),
});
const roll = (b, { x = b.x, y = b.y, vx = b.vx, vy = b.vy, spin = b.spin } = {}) => ({
    id: b.id,
    arena: b.arena,
    scoreSerial: b.scoreSerial,
    type: b.type,
    r: b.r,
    mass: b.mass,
    physical: { ...b.physical },
    x,
    y,
    vx,
    vy,
    spin,
    z: 0,
    angle: 0,
    hookTime: 0,
    hookTurn: 0,
    life: 1.05,
    trail: [],
    hitIds: new Set(),
    chain: 0,
    echo: true,
});
export function onDash(g) {
    g.dashHitIds.clear();
    if (g.augments.includes('dash-double')) g.doubleArmed = true;
    if (!g.augments.includes('dash-recall') || g.balls.some((b) => b.ready)) return;
    const { boss } = g,
        w = g.duckBounds ?? MANUAL,
        x = clamp(boss.x + boss.dashX * MANUAL.burstSpeed * MANUAL.burstDuration, w.minX, w.maxX),
        y = clamp(boss.y + boss.dashY * MANUAL.burstSpeed * MANUAL.burstDuration, w.minY, w.maxY);
    const candidates = g.balls
        .filter((b) => b.inWorld && b.pickupArmed && !b.recalled && !b.vault)
        .map((b) => ({ b, d: Math.hypot(b.x - x, b.y - y) }))
        .filter(({ d }) => d > 1 && d <= 260)
        .sort((a, b) => a.d - b.d || a.b.id - b.b.id);
    if (!candidates.length) return;
    const { b, d } = candidates[0];
    Object.assign(b, {
        recalled: true,
        recalling: true,
        vx: ((x - b.x) / d) * 400,
        vy: ((y - b.y) / d) * 400,
        spin: 0,
        life: 1.25,
        cooldown: 0,
    });
    g.fx('pickup', b.x, b.y, 0, 23, '#9ce4d0', '공 끌어오기');
}
export function onRelease(g, b) {
    armExtraAugments(g, b);
    b.vault = null;
    b.vaultArmed = g.augments.includes('ball-vault');
    const speed = Math.hypot(b.vx, b.vy) || 1;
    b.secondRoll = g.augments.includes('second-roll')
        ? { lastHit: null, nx: b.vx / speed, ny: b.vy / speed }
        : null;
    b.forked = false;
    b.hookKicked = false;
    b.recalled = false;
    b.recalling = false;
    if (!g.doubleArmed) return;
    g.doubleArmed = false;
    g.pendingEchoes.push({ at: g.time + 0.18, ball: roll(b) });
}
export function onGroundPickup(g, b) {
    b.recalling = false;
    if (g.augments.includes('catch-charge') && g.dashCharges < g.dashCapacity) {
        g.dashCharges++;
        if (g.dashCharges === g.dashCapacity) g.dashRechargeRemaining = 0;
        g.fx('pickup', g.lastPickup.x, g.lastPickup.y, 0, 28, '#fff0b1', '대시 +1');
    }
    if (g.augments.includes('catch-pulse')) {
        const { x, y } = g.lastPickup;
        g.fx('stomp', x, y, 0, 87, '#9ce4d0');
        for (const u of g.enemies) {
            const dx = u.x - x,
                dy = u.y - y,
                d = Math.hypot(dx, dy);
            if (u.hp <= 0 || u.z > 20 || d >= 87) continue;
            const nx = d > 1e-5 ? dx / d : 0,
                ny = d > 1e-5 ? dy / d : -1;
            u.vx += (nx * 145) / u.mass;
            u.vy += (ny * 145) / u.mass;
            g.hurt(u, 6, nx, ny, 145);
        }
    }
}
export function onDirectHit(g, b, u) {
    armSecondRoll(g, b);
    if (
        !g.augments.includes('hook-kick') ||
        b.echo ||
        b.held ||
        b.hookKicked ||
        Math.abs(b.spin) < 0.22
    )
        return;
    b.hookKicked = true;
    Object.assign(u, rotate(u.vx, u.vy, Math.sign(b.spin) * 0.58));
    g.fx('hit', u.x, u.y, 12, 32, '#dac2eb');
}
export function afterBattleStep(g, dt, dashSegment) {
    if (dashSegment && g.augments.includes('dash-shove')) {
        const { boss } = g,
            dx = boss.x - dashSegment.x,
            dy = boss.y - dashSegment.y,
            sq = dx * dx + dy * dy;
        if (sq > 1e-8)
            for (const u of g.enemies) {
                if (u.hp <= 0 || u.z > 20 || g.dashHitIds.has(u.id)) continue;
                const t = clamp(
                    ((u.x - dashSegment.x) * dx + (u.y - dashSegment.y) * dy) / sq,
                    0,
                    1,
                );
                if (
                    Math.hypot(u.x - dashSegment.x - t * dx, u.y - dashSegment.y - t * dy) >
                    boss.r + u.r + 4
                )
                    continue;
                g.dashHitIds.add(u.id);
                u.vx += (boss.dashX * 155) / u.mass;
                u.vy += (boss.dashY * 155) / u.mass;
                g.hurt(u, 9, boss.dashX, boss.dashY, 155);
            }
    }
    if (g.augments.includes('bank-fork'))
        for (const b of g.balls) {
            if (
                b.ready ||
                b.recalling ||
                b.vault ||
                b.life <= 0 ||
                b.forked ||
                !b.wallHit ||
                !b.wallHitSides?.some((side) => side === 'left' || side === 'right')
            )
                continue;
            b.forked = true;
            for (const sign of [-1, 1])
                g.echoes.push(roll(b, { ...rotate(b.vx, b.vy, sign * 0.36), spin: 0 }));
            g.echoRolls += 2;
            g.fx('hit', b.x, b.y, 0, 30, '#ffdea0');
        }
    for (const entry of g.pendingEchoes.filter((e) => g.time + 1e-8 >= e.at)) {
        g.echoes.push(entry.ball);
        g.echoRolls++;
        g.fx('shot', entry.ball.x, entry.ball.y, 0, 21, '#ffe4a0');
    }
    g.pendingEchoes = g.pendingEchoes.filter((e) => e.at > g.time + 1e-8);
    for (const b of g.echoes) {
        b.life -= dt;
        if (b.life <= 0) continue;
        stepRoll(b, dt, b.arena ?? g.arena);
        b.trail.push({ x: b.x, y: b.y });
        if (b.trail.length > 7) b.trail.shift();
        for (const u of g.enemies) g.ballContact(b, u);
    }
    g.echoes = g.echoes.filter((b) => b.life > 0).slice(-8);
}
