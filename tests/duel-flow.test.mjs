import assert from 'node:assert/strict';
import test from 'node:test';
import { createDuelBot } from '../src/domain/duel-bot.mjs';
import { DuelGame, DUEL_SCORE_GOAL } from '../src/domain/duel.mjs';

const seed = 42;

test('a two-player match ends and replays identically from a mid-game checkpoint', () => {
    const matchSeed = 7;
    const game = new DuelGame(matchSeed);
    const drivers = [createDuelBot(), createDuelBot()];
    const act = () => drivers.map((driver, side) => driver(game, side));
    assert.equal(game.result, null);
    assert.deepEqual(
        game.players.map((player) => player.balls.length),
        [3, 3],
    );
    assert.equal(game.players[0].selectedType, game.players[1].selectedType);
    game.step(act());
    for (const side of [0, 1]) {
        const wave = game.pins.filter((pin) => pin.targetSide === side);
        assert.equal(wave.filter((pin) => pin.kind === 'grunt').length, 15);
        assert.equal(wave.filter((pin) => pin.kind !== 'grunt').length, 1);
    }
    while (game.tick < 4000 && game.result === null) game.step(act());
    const snapshot = game.exportState();
    assert.equal(snapshot.result, null);
    assert.ok(game.players[0].stats.shots > 0);
    assert.ok(game.pins.every((pin) => !Object.hasOwn(pin, 'side')));

    const replay = new DuelGame(matchSeed);
    const crossed = structuredClone(snapshot);
    crossed.players[0].boss.y = game.centerLane.y;
    assert.throws(() => replay.importState(crossed), /Invalid Duck Bowling duel snapshot/);
    replay.importState(snapshot);
    assert.deepEqual(replay.exportState(), snapshot);
    while (game.tick < 8000 && game.result === null) {
        const actions = act();
        game.step(actions);
        replay.step(actions);
        const { y, halfWidth } = game.centerLane;
        const [host, guest] = game.players.map((player) => player.boss);
        assert.ok(host.y - host.r >= y + halfWidth);
        assert.ok(guest.y + guest.r <= y - halfWidth);
    }
    assert.equal(game.result, 1);
    assert.ok(game.players[1].score >= DUEL_SCORE_GOAL);
    assert.ok(game.players[0].score > 0);
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

test('a neutral pin targeting the bowler can take another hit after separation', () => {
    const game = new DuelGame(seed);
    for (let tick = 0; tick < 121; tick++) game.step([{}, {}]);
    const host = game.players[0];
    const pin = game.pins.find((candidate) => candidate.targetSide === 0);
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
