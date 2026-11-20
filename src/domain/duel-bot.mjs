import { SWING_TIME } from './bowler.mjs';
import { duckAimOpen, duckDashOpen } from './duck-recoil.mjs';
import { BALL_TYPES } from './dynamics.mjs';
import { MANUAL } from './locomotion.mjs';
import { nextRandom } from './random.mjs';
import { reflectorIsActive, reflectorOverlaps } from './terrain.mjs';

const PRACTICE = Object.freeze({
    reactionMs: 250,
    firstShotMs: 1250,
    shotIntervalMs: 2000,
    repositionMs: 1750,
    dodgeIntervalMs: 2000,
    shotSpeed: 850,
    aimError: 40,
    defendDistance: 200,
    dodgeLookaheadMs: 250,
});

const IDLE = Object.freeze({ moveX: 0, moveY: 0 });
const DASH_REACH = MANUAL.burstSpeed * MANUAL.burstDuration;
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const distanceTo = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

function nearestEnemyPin(pins, side, duck) {
    let nearest = null;
    let distance = Infinity;
    for (const pin of pins) {
        if (pin.side === side || pin.hp <= 0 || pin.z > 60) continue;
        const candidateDistance = distanceTo(duck, pin);
        if (candidateDistance >= distance) continue;
        nearest = pin;
        distance = candidateDistance;
    }
    return nearest;
}

function incomingPosition(duck, balls) {
    let nearest = null;
    let soonest = PRACTICE.dodgeLookaheadMs / 1000;
    for (const ball of balls) {
        const speedSquared = ball.vx ** 2 + ball.vy ** 2;
        if (!ball.inWorld || ball.life <= 0 || speedSquared === 0) continue;
        const time = ((duck.x - ball.x) * ball.vx + (duck.y - ball.y) * ball.vy) / speedSquared;
        if (time <= 0 || time >= soonest) continue;
        const x = ball.x + ball.vx * time;
        const y = ball.y + ball.vy * time;
        if (Math.hypot(x - duck.x, y - duck.y) > ball.r + duck.r) continue;
        nearest = { x, y };
        soonest = time;
    }
    return nearest;
}

function safeDash(player, targetX, targetY, danger) {
    const duck = player.boss;
    const bounds = player.duckBounds;
    let best = null;
    let bestScore = -Infinity;
    for (const offset of [0, -Math.PI / 4, Math.PI / 4, -Math.PI / 2, Math.PI / 2]) {
        const angle = Math.atan2(targetY - duck.y, targetX - duck.x) + offset;
        const moveX = Math.cos(angle);
        const moveY = Math.sin(angle);
        const end = {
            x: clamp(duck.x + moveX * DASH_REACH, bounds.minX, bounds.maxX),
            y: clamp(duck.y + moveY * DASH_REACH, bounds.minY, bounds.maxY),
            r: duck.r,
        };
        if (distanceTo(duck, end) < duck.r) continue;
        const middle = { x: (end.x + duck.x) / 2, y: (end.y + duck.y) / 2, r: duck.r };
        if (
            player.arena.reflectors.some(
                (rock) =>
                    reflectorIsActive(rock) &&
                    (reflectorOverlaps(end, rock) || reflectorOverlaps(middle, rock)),
            )
        )
            continue;
        const score =
            (danger ? distanceTo(end, danger) : 0) - distanceTo(end, { x: targetX, y: targetY });
        if (score > bestScore) {
            best = { moveX, moveY };
            bestScore = score;
        }
    }
    return best;
}

function aimedShot(player, target, aimError) {
    const duck = player.boss;
    const speed = PRACTICE.shotSpeed * BALL_TYPES[player.selectedType].speed;
    const lead = SWING_TIME + distanceTo(duck, target) / speed;
    const x = target.x + (target.moveVx ?? target.vx ?? 0) * lead * 0.5 + aimError;
    const y = target.y + (target.moveVy ?? target.vy ?? 0) * lead * 0.5;
    const angle = Math.atan2(y - duck.y, x - duck.x);
    return {
        ...IDLE,
        shot: {
            vx: Math.cos(angle) * PRACTICE.shotSpeed,
            vy: Math.sin(angle) * PRACTICE.shotSpeed,
            spin: 0,
        },
    };
}

// Practice shares the player's action interface. Decision timers and shot error stay in the input
// producer, so neither the arena rules nor the online game's rollback snapshots need a bot state.
export function createDuelBot() {
    let nextDecisionMs = 0;
    let nextShotMs = PRACTICE.firstShotMs;
    let nextRepositionMs = 0;
    let nextDodgeMs = 0;
    let randomSeed;

    return (game, side) => {
        const player = game.players[side];
        const opponent = game.players[1 - side];
        const duck = player.boss;
        const nowMs = game.clock.nowMs;
        if (nowMs < nextDecisionMs || duck.hp <= 0 || duck.delivery || duck.dashRemaining > 0)
            return IDLE;
        nextDecisionMs = nowMs + PRACTICE.reactionMs;

        const targetPin = nearestEnemyPin(game.pins, side, duck);
        const canDash = player.dashCharges > 0 && duckDashOpen(duck);
        const canShoot = duckAimOpen(duck) && player.balls.some((ball) => ball.ready && ball.held);
        const incoming = canDash && nowMs >= nextDodgeMs && incomingPosition(duck, opponent.balls);
        if (incoming) {
            const direction = Math.sign(duck.x - incoming.x) || 1;
            const dodge = safeDash(player, duck.x + direction * DASH_REACH, duck.y, incoming);
            if (dodge) {
                nextDodgeMs = nowMs + PRACTICE.dodgeIntervalMs;
                return dodge;
            }
        }

        if (canShoot && nowMs >= nextShotMs) {
            const draw = nextRandom(randomSeed ?? game.seed ^ side);
            randomSeed = draw.seed;
            nextShotMs = nowMs + PRACTICE.shotIntervalMs;
            return aimedShot(
                player,
                targetPin ?? opponent.boss,
                (draw.value - 0.5) * PRACTICE.aimError,
            );
        }

        if (canDash && nowMs >= nextRepositionMs) {
            nextRepositionMs = nowMs + PRACTICE.repositionMs;
            if (targetPin && !canShoot && distanceTo(duck, targetPin) < PRACTICE.defendDistance) {
                const escape = safeDash(
                    player,
                    duck.x + (duck.x - targetPin.x),
                    duck.y + (duck.y - targetPin.y),
                    targetPin,
                );
                if (escape) return escape;
            }
            const bounds = player.duckBounds;
            const targetY = (bounds.minY + bounds.maxY) / 2;
            const targetX = clamp(opponent.boss.x, bounds.minX, bounds.maxX);
            if (distanceTo(duck, { x: targetX, y: targetY }) > DASH_REACH * 0.75)
                return safeDash(player, targetX, targetY) ?? IDLE;
        }

        return IDLE;
    };
}
