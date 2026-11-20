import { advanceCombatClock, combatClock } from './combat-clock.mjs';
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
const SPAWN_INSET = 325;
const PIN_LIFETIME_MS = DUEL_WAVE_MS * 6;
const FIGHT_REACH = 10;
const BODY_DRAG = 3;
const BOMB_RADIUS = 105;
const BOMB_IMPULSE = 220;
const BOMB_PIN_DAMAGE = 22;
const BOMB_PIN_LAUNCH = 80;
const SPECIALS = Object.keys(ENEMY_TYPES).filter((kind) => kind !== 'grunt');
const SPECIAL_DRAW_WEIGHT = SPECIALS.reduce((total, kind) => total + (kind === 'giant' ? 1 : 2), 0);
const clamp = (value, low, high) => Math.min(high, Math.max(low, value));

function createTarget() {
    return {
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
        targets: [createTarget(), createTarget()],
        rng: (seed ^ 0x517cc1b7) >>> 0,
        awarded: 0,
        nextWaveAtMs: 0,
        waves: 0,
        nextPinId: 1,
        projectileSerial: 0,
        previousDucks: null,
    };
}

function drawSpecial(state) {
    const draw = nextRandom(state.rng);
    state.rng = draw.seed;
    let target = Math.floor(draw.value * SPECIAL_DRAW_WEIGHT);
    for (const kind of SPECIALS) {
        target -= kind === 'giant' ? 1 : 2;
        if (target < 0) return kind;
    }
    throw new Error('Invalid duel special pin draw');
}

function makePin(game, kind, x, y, facing) {
    const r = ENEMY_TYPES[kind].r;
    const a = game.arena;
    const u = configureEnemy(
        {
            id: game.pinState.nextPinId++,
            targetSide: null,
            expiresAtMs: game.pinState.nextWaveAtMs + PIN_LIFETIME_MS,
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
        },
        kind,
    );
    u.facing = facing;
    u.guardDropsOnRecovery = kind === 'shield';
    game.pins.push(u);
}

function spawnWave(game) {
    const state = game.pinState;
    const specials = [[drawSpecial(state)], [drawSpecial(state)]];
    const totalScore = game.players[0].score + game.players[1].score;
    const earned = Math.floor(totalScore / DUEL_SPECIAL_KILLS);
    while (state.awarded < earned) {
        specials[state.awarded % 2].push(drawSpecial(state));
        state.awarded++;
    }
    const a = game.arena;
    const x = a.centerX ?? (a.left + a.right) / 2;
    for (let side = 0; side < game.players.length; side++) {
        const sign = side === 0 ? -1 : 1;
        const y = side === 0 ? a.bottom - SPAWN_INSET : a.top + SPAWN_INSET;
        const facing = (sign * Math.PI) / 2;
        for (const slot of pinSlots(LARGE_PIN_FORMATION, { x, y, nx: 0, ny: sign })) {
            makePin(game, 'grunt', slot.x, slot.y, facing);
        }
        const flankPins = specials[side];
        const specialSpacing = ENEMY_TYPES.giant.r * 2 + FIGHT_REACH;
        for (let i = 0; i < flankPins.length; i++) {
            const flank = i % 2 ? 1 : -1;
            const lane = Math.floor(i / 2) % 2;
            const rank = Math.floor(i / 4);
            const offset = PIN_GAP + specialSpacing * (1 + lane);
            makePin(
                game,
                flankPins[i],
                x + flank * offset,
                y - sign * PIN_DEPTH + sign * rank * specialSpacing,
                facing,
            );
        }
    }
    game.pinState.waves++;
    game.pinState.nextWaveAtMs += DUEL_WAVE_MS;
}

export function hurtDuelPin(
    game,
    pin,
    { damage, vx = 0, vy = 0, vz = 0, stun = 0, playerIndex, depth },
) {
    if (pin.hp <= 0 || !Number.isFinite(damage) || damage <= 0) return false;

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
    pin.sourceShot = playerIndex ?? null;
    pin.scoreCause = playerIndex ?? null;
    pin.chainDepth = depth ?? 0;
    ignite(pin);
    game.fx('hit', pin.x, pin.y, pin.z + 12, 16, '#ffe6a6');
    if (pin.hp === 0) {
        if (playerIndex !== undefined) game.players[playerIndex].score++;
        game.fx('ko', pin.x, pin.y, pin.z + 20, 16, '#f4ba77');
    }
    return true;
}

function targetFor(pin, ducks) {
    const committed =
        pin.pinBlast || pin.projectileWarning || (pin.giantStage && pin.giantStage !== 'approach');
    if (committed && pin.targetSide !== null) return pin.targetSide;
    const [host, guest] = ducks;
    const hostDistance = (host.x - pin.x) ** 2 + (host.y - pin.y) ** 2;
    const guestDistance = (guest.x - pin.x) ** 2 + (guest.y - pin.y) ** 2;
    if (hostDistance === guestDistance) return pin.targetSide ?? pin.id % 2;
    return hostDistance < guestDistance ? 0 : 1;
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

function stepPin(pin, game, world, dt) {
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
                    world.damageBoss(30, 'giant-charge', { x: pin.x, y: pin.y, strength: 1.25 });
                }
            } else {
                stepPinBlast(world, pin);
                if (!pin.pinBlast && pin.attackStage !== 'pin-recover') {
                    const support = flagSupport(world, pin);
                    pin.supported = support > 1;
                    const speed = pin.speed * support;
                    pin.vx = (dx / (distance || 1)) * speed;
                    pin.vy = (dy / (distance || 1)) * speed;
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
        if (enemy.hp <= 0 || Math.abs(enemy.z - pin.z) > 45) continue;
        const dx = enemy.x - pin.x;
        const dy = enemy.y - pin.y;
        const distance = Math.hypot(dx, dy);
        if (distance > BOMB_RADIUS) continue;
        const impulse = BOMB_IMPULSE / (enemy.mass * (distance || 1));
        hurtDuelPin(game, enemy, {
            damage: BOMB_PIN_DAMAGE,
            vx: dx * impulse,
            vy: dy * impulse,
            vz: BOMB_PIN_LAUNCH,
            stun: 0.28,
        });
    }
    if (pin.z >= 40) return;
    for (const { boss: duck, side } of game.players) {
        if (Math.hypot(duck.x - pin.x, duck.y - pin.y) < BOMB_RADIUS + duck.r) {
            game.pushDuck(side, { x: pin.x, y: pin.y, strength: 1.25 });
        }
    }
}

// Each duck has independent attack warning limits. Pins can retarget between attacks.
function targetWorld(game, side, pins) {
    const state = game.pinState.targets[side];
    return {
        boss: game.players[side].boss,
        enemies: pins,
        arena: game.arena,
        threatMode: true,
        combatClock: state.clock,
        pinBlastStats: state.blastStats,
        enemyProjectileStats: state.projectileStats,
        enemyProjectiles: game.projectiles.filter((p) => p.targetSide === side),
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
        damageBoss: (_amount, _source, impact) => game.pushDuck(side, impact),
        fx: (...args) => game.fx(...args),
    };
}

export function stepDuelPins(game, dt) {
    const state = game.pinState;
    if (game.clock.nowMs >= state.nextWaveAtMs) spawnWave(game);
    for (const target of state.targets) advanceCombatClock(target.clock, dt, 1);
    const ducks = game.players.map(({ boss }) => boss);
    const groups = [[], []];
    for (const pin of game.pins) {
        if (game.clock.nowMs >= pin.expiresAtMs) continue;
        pin.targetSide = targetFor(pin, ducks);
        groups[pin.targetSide].push(pin);
    }
    const worlds = groups.map((pins, side) => targetWorld(game, side, pins));
    const duckPoints = ducks.map((duck) => ({
        x: duck.x,
        y: duck.y,
        z: duck.recoil?.z ?? 0,
    }));
    for (const [side, world] of worlds.entries()) {
        for (const pin of world.enemies) stepPin(pin, game, world, dt);
        for (const projectile of world.enemyProjectiles) projectile.targetSide = side;
        stepEnemyProjectiles(world, dt, state.previousDucks?.[side] ?? duckPoints[side]);
    }
    state.previousDucks = duckPoints;
    game.projectiles = worlds.flatMap((world) => world.enemyProjectiles);
    game.pins = game.pins.filter((pin) => game.clock.nowMs < pin.expiresAtMs);
    for (const pin of game.pins) explodeBomb(pin, game, dt);
    game.pins = game.pins.filter(
        (pin) => pin.deadAge < 1.3 || (pin.fuse !== null && !pin.exploded),
    );
}
