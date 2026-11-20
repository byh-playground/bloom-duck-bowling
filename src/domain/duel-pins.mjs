import { advanceCombatClock, COMBAT_BEAT_MS, combatClock } from './combat-clock.mjs';
import { BODY_GRAVITY } from './duck-recoil.mjs';
import { ENEMY_TYPES, configureEnemy, flagSupport, ignite, specialDrive } from './enemies.mjs';
import { stepPinBlast } from './pin-blast.mjs';
import { LARGE_PIN_FORMATION, PIN_DEPTH, PIN_GAP, pinSlots } from './pin-formation.mjs';
import { stepEnemyProjectiles, stepPinProjectileThreat } from './pin-projectiles.mjs';
import { nextRandom } from './random.mjs';
import { resolveReflectors } from './terrain.mjs';

export const DUEL_WAVE_MS = 4000;
export const DUEL_SPECIAL_KILLS = 6;
const PIN_APPROACH_SPEED = 43;
const SPAWN_INSET = 250;
const FIGHT_REACH = 10;
const MELEE_GAP_MS = COMBAT_BEAT_MS;
const ORDINARY_HITS_TO_DEFEAT = 3;
const PIN_DAMAGE = ENEMY_TYPES.grunt.hp / ORDINARY_HITS_TO_DEFEAT;
const BODY_DRAG = 3;
const BOMB_RADIUS = 105;
const BOMB_IMPULSE = 220;
const BOMB_PIN_DAMAGE = 22;
const BOMB_DUCK_DAMAGE = 24;
const SPECIALS = Object.keys(ENEMY_TYPES).filter((kind) => kind !== 'grunt');
const SPECIAL_DRAW_WEIGHT = SPECIALS.reduce((total, kind) => total + (kind === 'giant' ? 1 : 2), 0);
const clamp = (value, low, high) => Math.min(high, Math.max(low, value));

function createSide(seed) {
    return {
        rng: seed >>> 0,
        awarded: 0,
        pending: [],
        clock: combatClock(),
        projectileWarningAtMs: 0,
        blastStats: { total: 0, hit: 0, whiff: 0, blocked: 0 },
        projectileStats: {
            straight: { fired: 0, hit: 0, whiff: 0, blocked: 0, shattered: 0 },
            lob: { fired: 0, hit: 0, whiff: 0, blocked: 0 },
        },
    };
}

export function createDuelPinState(seed) {
    return {
        sides: [createSide(seed ^ 0x517cc1b7), createSide(seed ^ 0x6d2b79f5)],
        nextWaveAtMs: 0,
        waves: 0,
        nextPinId: 1,
        projectileSerial: 0,
        previousDucks: null,
    };
}

function drawSpecial(sideState) {
    const draw = nextRandom(sideState.rng);
    sideState.rng = draw.seed;
    let target = Math.floor(draw.value * SPECIAL_DRAW_WEIGHT);
    for (const kind of SPECIALS) {
        target -= kind === 'giant' ? 1 : 2;
        if (target < 0) return kind;
    }
    throw new Error('Invalid duel special pin draw');
}

function awardSpecials(game) {
    for (let side = 0; side < game.players.length; side++) {
        const sideState = game.pinState.sides[side];
        const earned = Math.floor(game.players[side].kills / DUEL_SPECIAL_KILLS);
        while (sideState.awarded < earned) {
            sideState.pending.push(drawSpecial(sideState));
            sideState.awarded++;
        }
    }
}

function makePin(game, side, kind, x, y, facing) {
    const r = ENEMY_TYPES[kind].r;
    const a = game.arena;
    const u = configureEnemy(
        {
            id: game.pinState.nextPinId++,
            side,
            x: clamp(x, a.left + r, a.right - r),
            y: clamp(y, a.top + r, a.bottom - r),
            z: 0,
            vx: 0,
            vy: 0,
            vz: 0,
            speed: PIN_APPROACH_SPEED,
            angle: 0,
            spin: 0,
            flash: 0,
            stun: 0,
            deadAge: 0,
            sourceShot: null,
            scoreCause: null,
            chainDepth: 0,
            attackStage: 'idle',
            attackTelegraph: 0,
            meleeReadyAtMs: 0,
        },
        kind,
    );
    u.facing = facing;
    u.guardDropsOnRecovery = kind === 'shield';
    game.pins.push(u);
}

function spawnWave(game) {
    const a = game.arena;
    const x = a.centerX ?? (a.left + a.right) / 2;
    for (let side = 0; side < game.players.length; side++) {
        const sign = side === 0 ? -1 : 1;
        const y = side === 0 ? a.bottom - SPAWN_INSET : a.top + SPAWN_INSET;
        const facing = (sign * Math.PI) / 2;
        for (const slot of pinSlots(LARGE_PIN_FORMATION, { x, y, nx: 0, ny: sign })) {
            makePin(game, side, 'grunt', slot.x, slot.y, facing);
        }
        const sideState = game.pinState.sides[side];
        const specials = [drawSpecial(sideState), ...sideState.pending];
        const specialSpacing = ENEMY_TYPES.giant.r * 2 + FIGHT_REACH;
        for (let i = 0; i < specials.length; i++) {
            const flank = i % 2 ? 1 : -1;
            const lane = Math.floor(i / 2) % 2;
            const rank = Math.floor(i / 4);
            const offset = PIN_GAP + specialSpacing * (1 + lane);
            makePin(
                game,
                side,
                specials[i],
                x + flank * offset,
                y - sign * PIN_DEPTH + sign * rank * specialSpacing,
                facing,
            );
        }
        sideState.pending.length = 0;
    }
    game.pinState.waves++;
    game.pinState.nextWaveAtMs += DUEL_WAVE_MS;
}

export function hurtDuelPin(game, pin, { damage, vx = 0, vy = 0, vz = 0, stun = 0, side, depth }) {
    if (pin.hp <= 0 || pin.side === side || !Number.isFinite(damage) || damage <= 0) return false;

    pin.hp = Math.max(0, pin.hp - damage);
    pin.vx += vx;
    pin.vy += vy;
    pin.vz = Math.max(pin.vz, vz);
    pin.stun = Math.max(pin.stun, stun);
    pin.flash = 0.18;
    if (vz > 0) {
        pin.z = Math.max(1, pin.z);
        pin.projectileHop = false;
        pin.spin = (pin.id % 2 ? 1 : -1) * 9;
    }
    if (stun > 0 || vz > 0 || pin.hp === 0) {
        pin.pinBlast = null;
        pin.projectileWarning = null;
        pin.attackStage = 'idle';
        pin.attackTelegraph = 0;
    }
    if (depth !== undefined) {
        pin.sourceShot = side;
        pin.scoreCause = side;
        pin.chainDepth = depth;
    }
    ignite(pin);
    game.fx('hit', pin.x, pin.y, pin.z + 12, 16, '#ffe6a6');
    if (pin.hp === 0) {
        if (side === 0 || side === 1) game.players[side].kills++;
        game.fx('ko', pin.x, pin.y, pin.z + 20, 16, '#f4ba77');
    }
    return true;
}

function nearestPin(pin, opponents) {
    let nearest = null;
    let best = 0;
    for (const candidate of opponents) {
        if (candidate.hp <= 0 || candidate.z > 8) continue;
        const dx = candidate.x - pin.x;
        const dy = candidate.y - pin.y;
        const d = dx * dx + dy * dy;
        const reach = pin.r + candidate.r + FIGHT_REACH;
        if (d > reach * reach || (nearest && d >= best)) continue;
        nearest = candidate;
        best = d;
    }
    return nearest;
}

function movePin(pin, game, dt) {
    const a = game.arena;
    const x = pin.x + pin.vx * dt;
    const y = pin.y + pin.vy * dt;
    pin.x = clamp(x, a.left + pin.r, a.right - pin.r);
    pin.y = clamp(y, a.top + pin.r, a.bottom - pin.r);
    if (x !== pin.x) pin.vx *= -0.45;
    if (y !== pin.y) pin.vy *= -0.45;
    resolveReflectors(pin, a.reflectors, pin.z);
}

function airborne(pin, game, dt) {
    pin.vz -= BODY_GRAVITY * dt;
    pin.z += pin.vz * dt;
    pin.angle += pin.spin * dt;
    if (!pin.projectileHop) {
        const scale = Math.exp(-0.75 * dt);
        pin.vx *= scale;
        pin.vy *= scale;
    }
    if (pin.z <= 0) {
        pin.z = 0;
        pin.vz = 0;
        pin.projectileHop = false;
        pin.stun = Math.max(pin.stun, 0.18);
        pin.spin *= 0.3;
        game.fx('land', pin.x, pin.y, 0, 15, '#c6d6a1');
    }
}

function stepPin(pin, game, world, opponents, strikes, dt) {
    pin.flash = Math.max(0, pin.flash - dt);
    pin.stun = Math.max(0, pin.stun - dt);
    if (pin.hp <= 0) pin.deadAge += dt;
    if (pin.z > 0 || pin.vz > 0) {
        airborne(pin, game, dt);
    } else if (pin.hp <= 0 || pin.stun > 0) {
        const scale = Math.exp(-BODY_DRAG * dt);
        pin.vx *= scale;
        pin.vy *= scale;
    } else {
        pin.sourceShot = null;
        pin.scoreCause = null;
        const inAttack = pin.pinBlast || pin.projectileWarning || pin.attackStage === 'pin-recover';
        const opponent = inAttack ? null : nearestPin(pin, opponents);
        if (opponent) {
            pin.facing = Math.atan2(opponent.y - pin.y, opponent.x - pin.x);
            pin.vx = pin.vy = 0;
            if (world.combatClock.nowMs >= pin.meleeReadyAtMs) {
                pin.meleeReadyAtMs = world.combatClock.nowMs + MELEE_GAP_MS;
                ignite(pin);
                strikes.push({ opponent, side: pin.side });
            }
        } else {
            const dx = world.boss.x - pin.x;
            const dy = world.boss.y - pin.y;
            const distance = Math.hypot(dx, dy);
            pin.facing = Math.atan2(dy, dx);
            if (distance <= pin.r + world.boss.r + FIGHT_REACH) ignite(pin);

            if (!stepPinProjectileThreat(world, pin)) {
                if (pin.meleePattern === 'elite') {
                    const drive = specialDrive(world, pin, dt);
                    pin.vx = drive.vx;
                    pin.vy = drive.vy;
                    if (
                        pin.giantStage === 'active' &&
                        pin.giantAttack === 'charge' &&
                        !pin.giantHit &&
                        distance <= pin.r + world.boss.r
                    ) {
                        pin.giantHit = true;
                        world.damageBoss(30, 'giant-charge', {
                            x: pin.x,
                            y: pin.y,
                            strength: 1.25,
                        });
                    }
                } else {
                    stepPinBlast(world, pin);
                    if (!pin.pinBlast && pin.attackStage !== 'pin-recover') {
                        const support = flagSupport(world, pin);
                        const speed = pin.speed * support;
                        pin.supported = support > 1;
                        pin.vx = (dx / (distance || 1)) * speed;
                        pin.vy = (dy / (distance || 1)) * speed;
                    }
                }
            }
        }
        pin.angle *= Math.exp(-9 * dt);
    }
    movePin(pin, game, dt);
}

function explodeBomb(pin, game, dt) {
    if (pin.fuse === null || pin.exploded) return;
    pin.fuse -= dt;
    if (pin.fuse > 0) return;
    pin.exploded = true;
    pin.fuse = 0;
    pin.hp = 0;
    game.fx('stomp', pin.x, pin.y, pin.z, BOMB_RADIUS, '#ffae6f');
    for (const enemy of game.pins) {
        if (enemy.side === pin.side || enemy.hp <= 0 || Math.abs(enemy.z - pin.z) > 45) continue;
        const dx = enemy.x - pin.x;
        const dy = enemy.y - pin.y;
        const distance = Math.hypot(dx, dy);
        if (distance > BOMB_RADIUS) continue;
        const impulse = BOMB_IMPULSE / (enemy.mass * (distance || 1));
        hurtDuelPin(game, enemy, {
            damage: BOMB_PIN_DAMAGE,
            side: pin.side,
            vx: dx * impulse,
            vy: dy * impulse,
            vz: PIN_DAMAGE * 8,
            stun: 0.28,
        });
    }
    const opponent = 1 - pin.side;
    const duck = game.players[opponent].boss;
    if (pin.z < 40 && Math.hypot(duck.x - pin.x, duck.y - pin.y) < BOMB_RADIUS + duck.r) {
        game.hurtDuck(opponent, BOMB_DUCK_DAMAGE, { x: pin.x, y: pin.y, strength: 1.25 });
    }
}

// A side views the opponent as the campaign helpers' target. Only its own pins
// and shots are visible to those helpers, so support and attack limits stay local.
function teamWorld(game, side, pins) {
    const state = game.pinState.sides[side];
    return {
        boss: game.players[1 - side].boss,
        enemies: pins,
        arena: game.arena,
        threatMode: true,
        combatClock: state.clock,
        pinBlastStats: state.blastStats,
        enemyProjectileStats: state.projectileStats,
        enemyProjectiles: game.projectiles.filter((p) => p.side === side),
        get nextProjectileWarningAtMs() {
            return state.projectileWarningAtMs;
        },
        set nextProjectileWarningAtMs(value) {
            state.projectileWarningAtMs = value;
        },
        get enemyProjectileSerial() {
            return game.pinState.projectileSerial;
        },
        set enemyProjectileSerial(value) {
            game.pinState.projectileSerial = value;
        },
        damageBoss: (amount, _source, impact) => game.hurtDuck(1 - side, amount, impact),
        fx: (...args) => game.fx(...args),
    };
}

export function stepDuelPins(game, dt) {
    const state = game.pinState;
    awardSpecials(game);
    if (state.sides[0].clock.nowMs >= state.nextWaveAtMs) spawnWave(game);
    for (const side of state.sides) advanceCombatClock(side.clock, dt, 1);
    const pins = [[], []];
    for (const pin of game.pins) pins[pin.side].push(pin);
    const worlds = pins.map((teamPins, side) => teamWorld(game, side, teamPins));
    const duckPoints = game.players.map(({ boss }) => ({
        x: boss.x,
        y: boss.y,
        z: boss.recoil?.z ?? 0,
    }));
    const strikes = [];
    for (let side = 0; side < pins.length; side++) {
        const world = worlds[side];
        for (const pin of pins[side]) stepPin(pin, game, world, pins[1 - side], strikes, dt);
        for (const projectile of world.enemyProjectiles) projectile.side = side;
        stepEnemyProjectiles(world, dt, state.previousDucks?.[1 - side] ?? duckPoints[1 - side]);
    }
    // A pin struck lethally in the same tick still lands its already-committed melee hit.
    for (const { opponent, side } of strikes)
        hurtDuelPin(game, opponent, { damage: PIN_DAMAGE, side });
    state.previousDucks = duckPoints;
    game.projectiles = worlds.flatMap((world) => world.enemyProjectiles);
    for (const pin of game.pins) explodeBomb(pin, game, dt);
    game.pins = game.pins.filter(
        (pin) => pin.deadAge < 1.3 || (pin.fuse !== null && !pin.exploded),
    );
}
