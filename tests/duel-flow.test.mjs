import assert from 'node:assert/strict';
import test from 'node:test';
import { createDuelBot } from '../src/domain/duel-bot.mjs';
import { DuelGame, DUEL_SCORE_GOAL } from '../src/domain/duel.mjs';
import { DUEL_SPECIAL_KILLS, DUEL_WAVE_MS } from '../src/domain/duel-pins.mjs';

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
        const wave = game.pins.filter((pin) => pin.court === side);
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
    crossed.players[0].boss.y = game.courts[0].top - 1;
    assert.throws(() => replay.importState(crossed), /Invalid Duck Bowling duel snapshot/);
    replay.importState(snapshot);
    assert.deepEqual(replay.exportState(), snapshot);
    while (game.tick < 8000 && game.result === null) {
        const actions = act();
        game.step(actions);
        replay.step(actions);
        for (const { boss, duckBounds } of game.players) {
            assert.ok(boss.y >= duckBounds.minY && boss.y <= duckBounds.maxY);
        }
    }
    assert.equal(game.result, 1);
    assert.ok(game.players[1].score >= DUEL_SCORE_GOAL);
    assert.ok(game.players[0].score > 0);
    assert.deepEqual(replay.exportState(), game.exportState());
});

test('independent courts exchange bonus pins after scored hits', () => {
    const game = new DuelGame(seed);
    const [host, guest] = game.players;
    assert.equal(host.boss.y, guest.boss.y);
    assert.equal(host.duckBounds.minY, guest.duckBounds.minY);
    assert.ok(host.duckBounds.minY < host.arena.centerY);

    game.step([{}, {}]);
    const openingPins = game.pins.filter((pin) => pin.court === host.side);
    const awayPin = game.pins.find((pin) => pin.court === guest.side);
    const ball = host.balls[0];
    const hit = (pin) => {
        Object.assign(ball, {
            x: pin.x,
            y: pin.y + pin.r + ball.r - 2,
            z: 0,
            vx: 0,
            vy: -1080,
            held: false,
        });
        host.ballContact(ball, pin);
    };
    const awayHp = awayPin.hp;
    hit(awayPin);
    assert.equal(awayPin.hp, awayHp);
    assert.equal(host.score, 0);

    for (const pin of openingPins
        .filter(({ kind }) => kind === 'grunt')
        .slice(0, DUEL_SPECIAL_KILLS))
        hit(pin);
    assert.equal(host.score, DUEL_SPECIAL_KILLS);
    assert.equal(guest.score, 0);
    assert.deepEqual(game.pinState.lastBonus, [null, null]);

    const firstBonusWavePin = game.pinState.nextPinId;
    while (game.clock.nowMs < DUEL_WAVE_MS) game.step([{}, {}]);
    const bonusCount = Math.floor(host.score / DUEL_SPECIAL_KILLS);
    assert.deepEqual(game.pinState.awarded, [0, 0]);
    game.step([{}, {}]);
    assert.deepEqual(game.pinState.awarded, [bonusCount, 0]);
    assert.deepEqual(game.pinState.lastBonus, [null, { tick: game.tick, count: bonusCount }]);
    assert.equal(
        game.pins.filter((pin) => pin.id >= firstBonusWavePin && pin.court === host.side).length,
        16,
    );
    assert.equal(
        game.pins.filter((pin) => pin.id >= firstBonusWavePin && pin.court === guest.side).length,
        16 + bonusCount,
    );
    assert.deepEqual(
        game.effects
            .filter((effect) => effect.kind === 'special-drop')
            .map((effect) => effect.court),
        Array(bonusCount).fill(guest.side),
    );

    const homeRock = game.courts[0].reflectors[0];
    const guestRock = game.courts[1].reflectors[0];
    assert.notEqual(homeRock.lifecycle, guestRock.lifecycle);
    homeRock.lifecycle.returnAtMs = game.clock.nowMs + 1000;
    assert.equal(guestRock.lifecycle.returnAtMs, null);
    const replay = new DuelGame(seed);
    replay.importState(game.exportState());
    assert.deepEqual(
        replay.courts.map(({ reflectors }) => reflectors[0].lifecycle),
        game.courts.map(({ reflectors }) => reflectors[0].lifecycle),
    );
});

test('a neutral pin targeting the bowler can take another hit after separation', () => {
    const game = new DuelGame(seed);
    for (let tick = 0; tick < 121; tick++) game.step([{}, {}]);
    const host = game.players[0];
    const pin = game.pins.find((candidate) => candidate.court === 0);
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
