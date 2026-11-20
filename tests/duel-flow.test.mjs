import assert from 'node:assert/strict';
import test from 'node:test';
import { DuelGame } from '../src/domain/duel.mjs';

const seed = 42;
const attack = (tick) => [
    {
        moveX: 0,
        moveY: -1,
        ...(tick % 48 === 15 && { shot: { vx: 0, vy: -950, spin: 0 } }),
    },
    { moveX: 0, moveY: 0 },
];

test('a two-player match ends and replays identically from a mid-game checkpoint', () => {
    const game = new DuelGame(seed);
    assert.equal(game.result, null);
    assert.deepEqual(
        game.players.map((player) => player.balls.length),
        [3, 3],
    );
    assert.equal(game.players[0].selectedType, game.players[1].selectedType);
    game.step(attack(0));
    for (const side of [0, 1]) {
        const wave = game.pins.filter((pin) => pin.side === side);
        assert.equal(wave.filter((pin) => pin.kind === 'grunt').length, 15);
        assert.equal(wave.filter((pin) => pin.kind !== 'grunt').length, 1);
    }
    for (let tick = 1; tick < 145; tick++) game.step(attack(tick));
    const snapshot = game.exportState();
    assert.ok(game.players[0].stats.shots > 0);
    assert.ok(game.pins.some((pin) => pin.side === 1));

    const replay = new DuelGame(seed);
    const crossed = structuredClone(snapshot);
    crossed.players[0].boss.y = game.centerLane.y;
    assert.throws(() => replay.importState(crossed), /Invalid Duck Bowling duel snapshot/);
    replay.importState(snapshot);
    assert.deepEqual(replay.exportState(), snapshot);
    for (let tick = snapshot.tick; tick < 1800 && game.result === null; tick++) {
        game.step(attack(tick));
        replay.step(attack(tick));
        const { y, halfWidth } = game.centerLane;
        const [host, guest] = game.players.map((player) => player.boss);
        assert.ok(host.y - host.r >= y + halfWidth);
        assert.ok(guest.y + guest.r <= y - halfWidth);
    }
    assert.notEqual(game.result, null);
    assert.deepEqual(replay.exportState(), game.exportState());
});

test('a ball crosses the center lane and knocks the duck back without dealing damage', () => {
    const game = new DuelGame(seed);
    const [host, guest] = game.players;
    const ball = host.balls[0];
    const target = guest.boss;
    Object.assign(ball, {
        x: target.x,
        y: game.centerLane.y + game.centerLane.halfWidth + ball.r + 4,
        z: 0,
        vx: 0,
        vy: -1080,
        phase: 'rolling',
        ready: false,
        held: false,
        inWorld: true,
        life: 2,
    });
    for (let tick = 0; tick < 40 && !target.recoil; tick++) game.step([{}, {}]);
    assert.ok(ball.y < game.centerLane.y - game.centerLane.halfWidth);
    assert.equal(target.hp, target.maxHp);
    assert.ok(target.recoil);

    // An overlapping ball cannot hit again until it has separated.
    const previous = { x: target.x, y: target.y };
    const contact = () => {
        ball.x = target.x;
        ball.y = target.y + target.r;
        ball.z = target.recoil?.z ?? 0;
        ball.vx = 0;
        ball.vy = -1080;
        game.contactDuck(ball, 1, previous);
    };
    const separate = () => {
        ball.y = target.y + target.r + ball.r + 10;
        game.contactDuck(ball, 1, previous);
    };
    separate();
    contact();
    const recoil = target.recoil;
    contact();
    assert.equal(target.recoil, recoil);
    separate();
    contact();
    assert.notEqual(target.recoil, recoil);
    assert.equal(target.hp, target.maxHp);
});

test('an opponent pin can take another hit from the same ball after separation', () => {
    const game = new DuelGame(seed);
    for (let tick = 0; tick < 121; tick++) game.step([{}, {}]);
    const host = game.players[0];
    const pin = game.pins.find((candidate) => candidate.side === 1);
    const ball = host.balls[0];
    ball.held = false;
    const placeBall = (distance) => {
        Object.assign(ball, { x: pin.x, y: pin.y + distance, z: 0, vx: 0, vy: -100 });
        Object.assign(pin, { z: 0, vx: 0, vy: 0 });
        host.ballContact(ball, pin);
    };
    const startHp = pin.hp;
    const contactDistance = ball.r + pin.r - 2;
    placeBall(contactDistance);
    const afterHit = pin.hp;
    assert.ok(afterHit > 0 && afterHit < startHp);
    placeBall(contactDistance);
    assert.equal(pin.hp, afterHit);
    placeBall(ball.r + pin.r + 10);
    placeBall(contactDistance);
    assert.ok(pin.hp < afterHit);
});
