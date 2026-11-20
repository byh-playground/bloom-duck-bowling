import { BallBag } from './ball-bag.mjs';
import { PIN_LAUNCH_KICK } from './ball-vault.mjs';
import { advanceDashPose } from './bowler.mjs';
import { DUCK_COMBAT, combatClock } from './combat-clock.mjs';
import { createDuelPinState, hurtDuelPin, stepDuelPins } from './duel-pins.mjs';
import { duckDashOpen, startDuckRecoil, stepDuckRecoil } from './duck-recoil.mjs';
import { BALL_TYPES } from './dynamics.mjs';
import { ENEMY_TYPES } from './enemies.mjs';
import { createExpedition } from './expedition.mjs';
import { manualBounds, stepManual } from './locomotion.mjs';
import { BowlingGame } from './sim.mjs';
import { reflectorOverlaps, restoreReflector } from './terrain.mjs';
import { PHYSICS_STEP_SECONDS, STEP_SECONDS } from './timing.mjs';

const DUEL_ROUTE = 'storm';
export const DUEL_SCORE_GOAL = 300;
const START_INSET = 95;
const CENTER_LANE_HALF_WIDTH = 40;
const CONTACT_EPSILON = 1e-6;
const PIN_CONTACT_RELEASE_MARGIN = 0.5;
const DUCK_RESTITUTION = 0.48;
const pointOf = (body) => ({ x: body.x, y: body.y, z: body.recoil?.z ?? body.z ?? 0 });

class DuelPlayer extends BowlingGame {
    constructor(match, seed, side) {
        const { arena } = match;
        const south = side === 0;
        const y = south ? arena.bottom - START_INSET : arena.top + START_INSET;
        super(seed, {
            autoWaves: false,
            arena,
            home: { x: arena.centerX, y, ballY: y },
        });
        this.match = match;
        this.side = side;
        this.score = 0;
        this.bag = new BallBag(seed, true);
        this.selectedType = this.bag.draw();
        this.controlMode = 'manual';
        this.dashOnly = true;
        this.dashCapacity = 3;
        this.dashCharges = this.dashCapacity;
        this.duckBounds = manualBounds(arena);
        const margin = match.centerLane.halfWidth + this.boss.r;
        if (south) this.duckBounds.minY = match.centerLane.y + margin;
        else this.duckBounds.maxY = match.centerLane.y - margin;
        this.combatClock = match.clock;
        this.boss.dashOnly = true;
        this.boss.side = side;
        this.boss.facing = south ? -Math.PI / 2 : Math.PI / 2;
        this.boss.hp = DUCK_COMBAT.maxHp;
        this.boss.maxHp = DUCK_COMBAT.maxHp;
        this.lastMove = { x: 0, y: south ? -1 : 1 };
        for (const ball of this.balls) {
            ball.side = side;
            ball.homeX = arena.centerX;
            ball.x = ball.homeX;
            ball.duckContact = false;
        }
        this.syncHand();
    }
    fx(...args) {
        this.match.fx(...args);
    }
    ballContact(ball, pin) {
        if (ball.hitIds.has(pin.id)) {
            const dz =
                ball.held || pin.projectileHop || ball.vault
                    ? (ball.z || 0) + ball.r - (pin.z + pin.r)
                    : 0;
            const distance = Math.hypot(pin.x - ball.x, pin.y - ball.y, dz);
            if (pin.hp <= 0 || distance > ball.r + pin.r + PIN_CONTACT_RELEASE_MARGIN)
                ball.hitIds.delete(pin.id);
        }
        return super.ballContact(ball, pin);
    }
    hurt(pin, damage, nx, ny, impulse, shot, depth = 0) {
        const kick = impulse / Math.max(1, pin.mass);
        const vz =
            kick > PIN_LAUNCH_KICK
                ? Math.max(0, Math.min(250, 90 + kick * 0.24) - (pin.vz || 0))
                : 0;
        this.match.hurtPin(pin, damage, this.side, { vz, stun: 0.28, depth });
        this.fx('hit', pin.x, pin.y, pin.z + 12, Math.min(38, 12 + impulse * 0.025));
    }
    applyAction(action) {
        this.setMove(action?.moveX ?? 0, action?.moveY ?? 0);
        if (this.boss.hp <= 0) return;
        const ball = this.balls.find((candidate) => candidate.ready && candidate.held);
        const shot = action?.shot;
        if (shot && ball && this.launch(ball.id, shot.vx, shot.vy, shot.spin)) {
            ball.duckContact = false;
            return;
        }
        if (
            this.dashCharges > 0 &&
            (action?.dash || (!(this.boss.dashRemaining > 0) && !this.boss.delivery)) &&
            duckDashOpen(this.boss)
        )
            this.dash();
    }
    advanceDuck(dt) {
        this.advanceDashCharge(dt);
        advanceDashPose(this.boss, dt);
        this.time = this.match.time;
        this.boss.flash = Math.max(0, this.boss.flash - dt);
        this.boss.hurtAge = (this.boss.hurtAge ?? 99) + dt;
        stepManual(this, dt);
        if (this.boss.recoil) stepDuckRecoil(this, dt);
    }
    advanceDelivery(dt) {
        this.enemies = this.match.pins;
        const before = this.stats.shots;
        this.updateBowler(dt);
        if (this.stats.shots !== before) {
            this.selectedType = this.bag.draw();
            this.selectedSpin = 0;
            this.syncHand();
        }
    }
}

function packPlayer(player) {
    const boss = { ...player.boss };
    delete boss.arena;
    const balls = player.balls.map((ball) => {
        const packed = { ...ball, hitIds: [...ball.hitIds] };
        delete packed.arena;
        delete packed.rockHit;
        return packed;
    });
    return {
        boss,
        balls,
        bag: player.bag.snapshot(),
        score: player.score,
        dashCharges: player.dashCharges,
        dashRechargeRemaining: player.dashRechargeRemaining,
        selectedType: player.selectedType,
        selectedSpin: player.selectedSpin,
        moveInput: player.moveInput,
        lastMove: player.lastMove,
        stats: player.stats,
        dashStarts: player.dashStarts ?? 0,
        lastDash: player.lastDash ?? null,
        lastRelease: player.lastRelease ?? null,
        lastPickup: player.lastPickup ?? null,
    };
}

function applyPlayer(player, packed, field, time) {
    const { boss, balls, bag } = packed;
    Object.assign(player, {
        score: packed.score,
        dashCharges: packed.dashCharges,
        dashRechargeRemaining: packed.dashRechargeRemaining,
        selectedType: packed.selectedType,
        selectedSpin: packed.selectedSpin,
        moveInput: packed.moveInput,
        lastMove: packed.lastMove,
        stats: packed.stats,
        dashStarts: packed.dashStarts,
        lastDash: packed.lastDash,
        lastRelease: packed.lastRelease,
        lastPickup: packed.lastPickup,
        boss: { ...boss, arena: field },
        balls: balls.map(({ hitIds, ...ball }) => ({ ...ball, hitIds: new Set(hitIds) })),
        time,
    });
    player.bag.restore(bag);
}

const isPosition = (body) =>
    Number.isFinite(body?.x) && Number.isFinite(body?.y) && Number.isFinite(body?.r) && body.r > 0;

function duelResult(host, guest) {
    const hostReached = host.score >= DUEL_SCORE_GOAL;
    const guestReached = guest.score >= DUEL_SCORE_GOAL;
    if (hostReached && guestReached) return 'draw';
    if (hostReached) return 0;
    if (guestReached) return 1;
    return null;
}

function validPlayer(packed, side, player) {
    return (
        isPosition(packed?.boss) &&
        packed.boss.side === side &&
        packed.boss.r === player.boss.r &&
        packed.boss.y >= player.duckBounds.minY &&
        packed.boss.y <= player.duckBounds.maxY &&
        packed.boss.hp === DUCK_COMBAT.maxHp &&
        Number.isSafeInteger(packed.score) &&
        packed.score >= 0 &&
        Number.isInteger(packed.dashCharges) &&
        Number.isFinite(packed.dashRechargeRemaining) &&
        Object.hasOwn(BALL_TYPES, packed.selectedType) &&
        Number.isFinite(packed.selectedSpin) &&
        packed.selectedSpin >= -1 &&
        packed.selectedSpin <= 1 &&
        Number.isInteger(packed.bag?.seed) &&
        packed.bag.seed >= 0 &&
        packed.bag.seed <= 0xffffffff &&
        Object.hasOwn(BALL_TYPES, packed.bag.last) &&
        Array.isArray(packed.bag.remaining) &&
        packed.bag.remaining.length < Object.keys(BALL_TYPES).length &&
        packed.bag.remaining.every((kind) => Object.hasOwn(BALL_TYPES, kind)) &&
        [
            packed.stats?.shots,
            packed.stats?.hits,
            packed.stats?.bestChain,
            packed.stats?.pickups,
        ].every(Number.isFinite) &&
        [packed.moveInput?.x, packed.moveInput?.y, packed.lastMove?.x, packed.lastMove?.y].every(
            Number.isFinite,
        ) &&
        Array.isArray(packed.balls) &&
        packed.balls.length === 3 &&
        packed.balls.every(
            (ball, index) =>
                isPosition(ball) &&
                ball.id === index &&
                ball.side === side &&
                Array.isArray(ball.hitIds),
        )
    );
}

export class DuelGame {
    constructor(seed) {
        this.seed = seed >>> 0;
        this.route = DUEL_ROUTE;
        this.arena = createExpedition(DUEL_ROUTE, this.seed).room.arena;
        this.centerLane = Object.freeze({
            y: this.arena.centerY,
            halfWidth: CENTER_LANE_HALF_WIDTH,
        });
        this.clock = combatClock();
        this.tick = 0;
        this.result = null;
        this.pins = [];
        this.effects = [];
        this.projectiles = [];
        this.pinState = createDuelPinState(this.seed);
        this.impactPairs = new Map();
        this.players = [new DuelPlayer(this, this.seed, 0), new DuelPlayer(this, this.seed, 1)];
        this.pinContacts = {
            time: 0,
            impactPairs: this.impactPairs,
        };
        this.pinImpact = (a, b, impulse, side, depth) =>
            this.resolvePinImpact(a, b, impulse, side, depth);
    }
    resolvePinImpact(a, b, impulse, side, depth) {
        if (side !== 0 && side !== 1) return;
        for (const pin of [a, b]) {
            if (pin.hp <= 0) continue;
            const kick = impulse / Math.max(1, pin.mass);
            const vz =
                kick > PIN_LAUNCH_KICK
                    ? Math.max(0, Math.min(250, 90 + kick * 0.24) - (pin.vz || 0))
                    : 0;
            this.hurtPin(pin, Math.min(35, impulse * 0.11), side, { stun: 0.28, depth, vz });
            this.fx('hit', pin.x, pin.y, pin.z + 12, Math.min(38, 12 + impulse * 0.025));
        }
    }
    get time() {
        return this.clock.nowMs / 1000;
    }
    fx(...args) {
        BowlingGame.prototype.fx.call(this, ...args);
    }
    hurtPin(pin, amount, playerIndex, impact = {}) {
        return hurtDuelPin(this, pin, { damage: amount, playerIndex, ...impact });
    }
    pushDuck(side, impact) {
        const player = this.players[side];
        if (!player || !startDuckRecoil(player, impact)) return false;
        const duck = player.boss;
        this.fx('hit', duck.x, duck.y, 20, duck.r * 0.5, '#d3e7d8');
        return true;
    }
    restoreReflectors() {
        const overlaps = (slot) =>
            this.players.some(
                ({ boss, balls }) =>
                    reflectorOverlaps(boss, slot, boss.recoil?.z ?? 0) ||
                    balls.some(
                        (ball) =>
                            (ball.inWorld || ball.held) && reflectorOverlaps(ball, slot, ball.z),
                    ),
            ) || this.pins.some((pin) => reflectorOverlaps(pin, slot, pin.z));
        for (const rock of this.arena.reflectors) {
            if (restoreReflector(rock, this.clock.nowMs, overlaps)) {
                this.fx('rock-return', rock.x, rock.y, 0, rock.width);
            }
        }
    }
    contactDuck(ball, side, targetPrevious) {
        const player = this.players[side];
        const target = player.boss;
        const dx = target.x - ball.x,
            dy = target.y - ball.y;
        const dz = (target.recoil?.z ?? 0) - (ball.z ?? 0);
        const distance = Math.hypot(dx, dy, dz);
        const radius = target.r + ball.r;
        if (distance > radius + CONTACT_EPSILON) {
            ball.duckContact = false;
            return;
        }
        if (ball.duckContact) return;
        const planar = Math.hypot(dx, dy);
        const speed = Math.hypot(ball.vx, ball.vy);
        const nx = planar > CONTACT_EPSILON ? dx / planar : ball.vx / (speed || 1);
        const ny = planar > CONTACT_EPSILON ? dy / planar : ball.vy / (speed || 1);
        const targetVx = (target.x - targetPrevious.x) / PHYSICS_STEP_SECONDS;
        const targetVy = (target.y - targetPrevious.y) / PHYSICS_STEP_SECONDS;
        const closing = (ball.vx - targetVx) * nx + (ball.vy - targetVy) * ny;
        // A single overlap is consumed even if the bodies are already separating.
        ball.duckContact = true;
        if (
            closing <= 0 ||
            !this.pushDuck(side, {
                x: ball.x,
                y: ball.y,
                direction: Math.atan2(ny, nx),
            })
        )
            return;
        const impulse = closing * (1 + DUCK_RESTITUTION);
        ball.vx -= nx * impulse;
        ball.vy -= ny * impulse;
    }
    step(actions) {
        if (this.result !== null) return;
        for (const player of this.players) player.applyAction(actions[player.side]);
        this.restoreReflectors();
        for (let time = 0; time < STEP_SECONDS; time += PHYSICS_STEP_SECONDS) {
            const substep = PHYSICS_STEP_SECONDS;
            const previous = this.players.map(({ boss }) => pointOf(boss));
            const ballPositions = this.players.map(({ balls }) =>
                balls.map((ball) => ({ ...pointOf(ball), inWorld: ball.inWorld })),
            );
            for (const player of this.players) player.advanceDuck(substep);
            for (const player of this.players) player.advanceDelivery(substep);
            for (const player of this.players) {
                const side = player.side;
                const opponent = 1 - side;
                for (const ball of player.balls) {
                    player.advanceBall(
                        ball,
                        substep,
                        ballPositions[side][ball.id],
                        previous[side],
                        false,
                        (moving) => this.contactDuck(moving, opponent, previous[opponent]),
                    );
                    if (!ball.ready && ball.life > 0) {
                        for (const pin of this.pins) player.ballContact(ball, pin);
                    }
                }
            }
        }
        stepDuelPins(this, STEP_SECONDS);
        this.pinContacts.time = this.time;
        for (let i = 0; i < this.pins.length; i++) {
            const a = this.pins[i];
            if (a.deadAge > 1) continue;
            for (let j = i + 1; j < this.pins.length; j++) {
                const b = this.pins[j];
                if (b.deadAge <= 1)
                    BowlingGame.prototype.enemyContact.call(this.pinContacts, a, b, this.pinImpact);
            }
        }
        if (this.impactPairs.size > 128) {
            for (const [key, at] of this.impactPairs)
                if (this.time - at > 0.28) this.impactPairs.delete(key);
        }
        for (const effect of this.effects) effect.age += STEP_SECONDS;
        this.effects = this.effects.filter((effect) => effect.age < effect.life).slice(-120);

        this.tick++;
        this.clock.nowMs = Math.floor(this.tick * STEP_SECONDS * 1000 + 1e-9);
        this.result = duelResult(this.players[0], this.players[1]);
    }
    exportState() {
        return structuredClone({
            seed: this.seed,
            tick: this.tick,
            result: this.result,
            players: this.players.map(packPlayer),
            pins: this.pins,
            effects: this.effects,
            projectiles: this.projectiles,
            pinState: this.pinState,
            reflective: this.arena.reflectors.map((rock) => rock.lifecycle),
            impactPairs: [...this.impactPairs],
        });
    }
    validateState(state) {
        return Boolean(
            state?.seed === this.seed &&
            Number.isSafeInteger(state.tick) &&
            state.tick >= 0 &&
            [null, 'draw', 0, 1].includes(state.result) &&
            Array.isArray(state.players) &&
            state.players.length === 2 &&
            state.players.every((player, side) => validPlayer(player, side, this.players[side])) &&
            state.result === duelResult(state.players[0], state.players[1]) &&
            Array.isArray(state.pins) &&
            state.pins.every(
                (pin) =>
                    isPosition(pin) &&
                    Object.hasOwn(ENEMY_TYPES, pin.kind) &&
                    (pin.targetSide === 0 || pin.targetSide === 1) &&
                    Number.isSafeInteger(pin.expiresAtMs) &&
                    Number.isFinite(pin.hp),
            ) &&
            Array.isArray(state.projectiles) &&
            state.projectiles.every((shot) => shot?.targetSide === 0 || shot?.targetSide === 1) &&
            Array.isArray(state.effects) &&
            Array.isArray(state.pinState?.targets) &&
            state.pinState.targets.length === 2 &&
            state.pinState.targets.every((target) => Number.isFinite(target?.clock?.nowMs)) &&
            Number.isSafeInteger(state.pinState.awarded) &&
            state.pinState.awarded >= 0 &&
            Number.isSafeInteger(state.pinState.rng) &&
            Number.isSafeInteger(state.pinState.nextWaveAtMs) &&
            Array.isArray(state.impactPairs) &&
            state.impactPairs.every(
                (pair) =>
                    Array.isArray(pair) && typeof pair[0] === 'string' && Number.isFinite(pair[1]),
            ) &&
            Array.isArray(state.reflective) &&
            state.reflective.length === this.arena.reflectors.length &&
            state.reflective.every(
                (rock, i) =>
                    Number.isInteger(rock?.slotIndex) &&
                    rock.slotIndex >= 0 &&
                    rock.slotIndex < this.arena.reflectors[i].slots.length &&
                    Number.isInteger(rock.seed) &&
                    (rock.returnAtMs === null || Number.isFinite(rock.returnAtMs)),
            ),
        );
    }
    importState(state) {
        if (!this.validateState(state)) throw new TypeError('Invalid Duck Bowling duel snapshot');
        const copy = structuredClone(state);
        this.tick = copy.tick;
        this.clock.nowMs = Math.floor(this.tick * STEP_SECONDS * 1000 + 1e-9);
        this.result = copy.result;
        this.pins = copy.pins;
        this.effects = copy.effects;
        this.projectiles = copy.projectiles;
        this.pinState = copy.pinState;
        this.impactPairs = new Map(copy.impactPairs);
        this.pinContacts.impactPairs = this.impactPairs;
        for (const player of this.players)
            applyPlayer(player, copy.players[player.side], this.arena, this.time);
        for (let i = 0; i < copy.reflective.length; i++) {
            const { slotIndex, seed, returnAtMs } = copy.reflective[i];
            Object.assign(this.arena.reflectors[i].lifecycle, { slotIndex, seed, returnAtMs });
        }
    }
}
