import test from 'node:test';
import assert from 'node:assert/strict';
import { CampaignGame } from '../src/domain/campaign.mjs';

// Real-input driver: read the displayed circles/telegraphs, dodge with fresh dash presses,
// and use ordinary release, bank, pickup and augmentation paths. No health or clock changes.
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
function play(
    seed = 42,
    shoot = true,
    options = {},
    shotFrames = 30,
    legacyCorridor = false,
    near = 150,
) {
    const game = new CampaignGame(seed, options),
        clears = [];
    let start = 0,
        lastDash = -100,
        lastShot = -100;
    for (let frame = 0; frame < 60 * 700 && !['won', 'lost'].includes(game.phase); frame++) {
        if (game.phase === 'choice') {
            clears.push({
                stage: game.stageIndex + 1,
                time: game.elapsed - start,
                alive: game.enemies.filter((e) => e.hp > 0).length,
                hp: game.boss.hp,
                gates: game.expedition?.gates.length,
            });
            start = game.elapsed;
            const id = [
                'dash-double',
                'ball-vault',
                'second-roll',
                'catch-charge',
                'dash-shove',
                'bank-fork',
                'catch-pulse',
                'dash-recall',
                'hook-kick',
                'ball-collision',
                'pin-magnet',
                'break-bullet',
                'air-catch',
            ].find((id) => game.choices.some((a) => a.id === id));
            assert.equal(game.chooseAugment(id), true);
        }
        const e = game.expedition,
            b = game.boss;
        if (e?.phase === 'gates' || e?.entryGate?.open) {
            const gate =
                e.phase === 'gates'
                    ? (e.gates.find(
                          (g) => g.direction === ['east', 'north', 'east', 'north'][e.room.index],
                      ) ?? e.gates[0])
                    : e.entryGate;
            if (!b.dashRemaining && game.dashCharges) {
                const axis = gate.direction === 'north' ? 'y' : 'x',
                    cross = axis === 'x' ? 'y' : 'x';
                const sign = gate.direction === 'east' ? 1 : -1,
                    dx =
                        e.phase === 'gates' && Math.abs(b[cross] - gate[cross]) > 45
                            ? gate[cross] - b[cross]
                            : 0;
                const across = clamp(dx / 108, -1, 1),
                    forward = sign * Math.sqrt(1 - across * across);
                game.setMove(axis === 'x' ? forward : across, axis === 'y' ? forward : across);
                game.dash();
                game.setMove(0, 0);
            }
            game.step(1 / 60);
            continue;
        }
        const bounds = game.duckBounds;
        if (shoot) {
            const b = game.boss,
                active = game.enemies.filter((e) => e.hp > 0 && e.z < 25),
                ready = game.balls.filter((b) => b.ready);
            const loose = game.balls.filter((b) => b.inWorld && b.pickupArmed && !b.ready);
            const warnings = active.filter((e) => e.pinBlast).map((e) => e.pinBlast);
            const ranged = [];
            for (const p of game.enemyProjectiles) {
                if (p.kind === 'lob') {
                    if (p.z < 65 && p.vz < 0)
                        ranged.push(
                            (x, y) => Math.hypot(x - p.targetX, y - p.targetY) - p.blastRadius - 7,
                        );
                } else if (Math.hypot(b.x - p.x, b.y - p.y) < 150) {
                    const speed = Math.hypot(p.vx, p.vy),
                        nx = p.vx / speed,
                        ny = p.vy / speed;
                    ranged.push((x, y) => {
                        const along = clamp((x - p.x) * nx + (y - p.y) * ny, 0, 175);
                        return Math.hypot(x - p.x - nx * along, y - p.y - ny * along) - 52;
                    });
                }
            }
            const solo = active.length === 1 && active[0].guardDropsOnRecovery ? active[0] : null;
            if (
                solo &&
                !solo.pinBlast &&
                solo.attackStage !== 'pin-recover' &&
                !b.delivery &&
                !b.dashRemaining &&
                game.dashCharges &&
                frame - lastDash > 15
            ) {
                const dx = solo.x - b.x,
                    dy = solo.y - b.y;
                if (Math.hypot(dx, dy) > (e && game.route === 'storm' ? 115 : 192)) {
                    game.setMove(dx, dy);
                    if (game.dash()) lastDash = frame;
                    game.setMove(0, 0);
                }
            }
            const urgent =
                ranged.some((distance) => distance(b.x, b.y) <= 0) ||
                warnings.some(
                    (w) => w.timeMs < 250 && Math.hypot(b.x - w.x, b.y - w.y) <= w.radius + 6,
                );
            const bomb = active.some(
                (e) => e.fuse !== null && e.fuse < 0.3 && Math.hypot(e.x - b.x, e.y - b.y) < 170,
            );
            const elite = active.some(
                (e) =>
                    e.kind === 'giant' &&
                    (e.giantStage === 'warn' || e.giantStage === 'active') &&
                    Math.hypot(e.x - b.x, e.y - b.y) < near,
            );
            const crowd = active.filter(
                (e) => e.attackStage !== 'pin-recover' && Math.hypot(e.x - b.x, e.y - b.y) < near,
            ).length;
            const retrieve =
                ready.length <= 1 && loose.some((a) => Math.hypot(a.x - b.x, a.y - b.y) < 250);
            if (
                game.dashCharges &&
                (!b.dashRemaining || urgent) &&
                frame - lastDash > 8 &&
                (urgent || bomb || elite || (!b.delivery && (crowd >= 3 || retrieve)))
            ) {
                let best = -Infinity,
                    move = null,
                    stay = -Infinity;
                for (let j = -1; j < 24; j++) {
                    const a = (j * Math.PI) / 12,
                        dx = j < 0 ? 0 : Math.cos(a),
                        dy = j < 0 ? 0 : Math.sin(a);
                    const x = clamp(
                            b.x + dx * 108,
                            legacyCorridor ? 90 : bounds.minX,
                            legacyCorridor ? 510 : bounds.maxX,
                        ),
                        y = clamp(b.y + dy * 108, bounds.minY, bounds.maxY);
                    let score = 0;
                    for (const e of active) {
                        if (e.attackStage !== 'pin-recover')
                            score -=
                                Math.max(
                                    0,
                                    near - Math.hypot(x - e.x - e.vx * 0.24, y - e.y - e.vy * 0.24),
                                ) ** 2;
                        if (e.fuse !== null && e.fuse < 0.6)
                            score -=
                                Math.max(
                                    0,
                                    180 - Math.hypot(x - e.x - e.vx * 0.12, y - e.y - e.vy * 0.12),
                                ) **
                                    2 *
                                9;
                        if (e.kind === 'giant' && e.giantStage !== 'approach')
                            score -= Math.max(0, 146 - Math.hypot(x - e.x, y - e.y)) ** 2 * 6;
                    }
                    for (const w of warnings) {
                        const p = clamp(w.timeMs / 155, 0, 1);
                        score -=
                            Math.max(
                                0,
                                w.radius +
                                    4 -
                                    Math.hypot(
                                        b.x + (x - b.x) * p - w.x,
                                        b.y + (y - b.y) * p - w.y,
                                    ),
                            ) **
                                2 *
                            30;
                    }
                    for (const distance of ranged) score -= Math.max(0, -distance(x, y)) ** 2 * 30;
                    for (const ball of loose) {
                        const nx = dx,
                            ny = dy,
                            t = Math.max(
                                0,
                                Math.min(
                                    108,
                                    (ball.x + ball.vx * 0.09 - b.x) * nx +
                                        (ball.y + ball.vy * 0.09 - b.y) * ny,
                                ),
                            );
                        score +=
                            Math.max(
                                0,
                                88 -
                                    Math.hypot(
                                        b.x + nx * t - ball.x - ball.vx * 0.09,
                                        b.y + ny * t - ball.y - ball.vy * 0.09,
                                    ),
                            ) * (ready.length === 0 ? 68 : ready.length === 1 ? 30 : 12);
                    }
                    score +=
                        Math.min(
                            125,
                            x - bounds.minX,
                            bounds.maxX - x,
                            y - bounds.minY,
                            bounds.maxY - y,
                        ) * 13;
                    if (j < 0) stay = score;
                    else if (score > best) {
                        best = score;
                        move = [dx, dy];
                    }
                }
                if (move && best > stay + (urgent || bomb || elite ? 1 : 220)) {
                    game.setMove(...move);
                    if (game.dash()) lastDash = frame;
                    game.setMove(0, 0);
                }
            }
            if (
                frame - lastShot >= shotFrames &&
                !b.delivery &&
                !b.aiming &&
                !b.dashRemaining &&
                ready.length &&
                !urgent
            ) {
                let best = -Infinity,
                    target = null;
                for (const e of active) {
                    const d = Math.hypot(e.x - b.x, e.y - b.y);
                    if (d < 55) continue;
                    let val = -d * 0.48;
                    for (const other of active)
                        if (other !== e) {
                            const near = Math.hypot(other.x - e.x, other.y - e.y);
                            val += Math.max(0, 105 - near) * 0.24;
                        }
                    if (e.kind === 'shield') val -= 115;
                    else if (e.kind === 'giant') val += !e.armored ? 250 : -80;
                    else if (e.kind === 'bomb') val += 36;
                    else if (e.projectileWarning) val += 55;
                    if (val > best) {
                        best = val;
                        target = e;
                    }
                }
                if (target) {
                    const d = Math.hypot(target.x - b.x, target.y - b.y),
                        lead = 0.21 + d / 1100,
                        x = target.x + target.vx * lead - b.x,
                        y = target.y + target.vy * lead - b.y,
                        angle =
                            Math.atan2(y, x) -
                            Math.asin(Math.min(0.75, 40 / (Math.hypot(x, y) || 1)));
                    if (game.launch(ready[0].id, Math.cos(angle) * 1080, Math.sin(angle) * 1080, 0))
                        lastShot = frame;
                }
            }
        }
        game.step(1 / 60);
    }
    return { game, clears };
}
test('Linked forest expedition wins five finite areas by real throws and crosses both vertical and horizontal gates', () => {
    const { game: g, clears } = play(42, true, { expedition: true }, 32);
    assert.equal(g.phase, 'won');
    assert.equal(g.expedition.phase, 'won');
    assert.equal(g.stageClears, 5);
    assert.equal(g.augments.length, 4);
    assert.ok(g.stageBossDefeated);
    assert.equal(g.stats.kills, 157);
    assert.deepEqual(
        clears.map((c) => c.gates),
        [3, 2, 2, 1],
    );
    assert.deepEqual(
        g.expedition.visited.map((r) => r.id),
        ['0,0', '1,0', '1,-1', '2,-1', '2,-2'],
    );
    assert.ok(g.elapsed > 15 && g.elapsed < 180);
    assert.ok(g.stats.shots > 25 && g.dashStarts > 10);
    assert.equal(g.balls.length, 3);
    assert.equal(g.continueEndless(), false);
    console.log(
        'LINKED FOREST REAL PHYSICS',
        JSON.stringify({
            elapsed: g.elapsed,
            hp: g.boss.hp,
            shots: g.stats.shots,
            kills: g.stats.kills,
        }),
    );
});

test('Connected Storm reaches the eye and wins via real throws, dashes and four committed entrances', () => {
    const { game, clears } = play(
        42,
        true,
        { route: 'storm', unlocks: ['storm'], expedition: true, shotSeed: 0 },
        34,
    );
    assert.equal(game.route, 'storm');
    assert.equal(
        game.phase,
        'won',
        JSON.stringify({
            stage: game.stageIndex,
            alive: game.snapshot().alive,
            hp: game.boss.hp,
            time: game.elapsed,
            packets: game.nextPacket,
            boss: [game.boss.x, game.boss.y],
            enemies: game.enemies
                .filter((e) => e.hp > 0)
                .map((e) => [e.kind, e.x, e.y, e.hp, e.attackStage]),
        }),
    );
    assert.equal(game.stageClears, 5);
    assert.equal(game.expedition.visited.length, 5);
    assert.equal(game.augments.length, 4);
    assert.ok(clears.every((c) => c.alive === 0 && c.gates >= 1 && c.gates <= 3));
    assert.ok(game.stageBossDefeated);
    assert.equal(game.continueEndless(), false);
    console.log(
        'STORM EXPEDITION REAL PHYSICS',
        JSON.stringify({
            time: game.elapsed,
            shots: game.stats.shots,
            kills: game.stats.kills,
            hp: game.boss.hp,
        }),
    );
});
