import { advanceCombatClock, combatClock } from './combat-clock.mjs';
import { BODY_GRAVITY } from './duck-recoil.mjs';
import { planDuelSpawn } from './duel-spawn.mjs';
import { ENEMY_TYPES, configureEnemy, flagSupport, ignite, specialDrive } from './enemies.mjs';
import { stepPinBlast } from './pin-blast.mjs';
import { stepEnemyProjectiles, stepPinProjectileThreat } from './pin-projectiles.mjs';
import { nextRandom } from './random.mjs';
import { resolveReflectors } from './terrain.mjs';

export const DUEL_WAVE_MS = 4000;
export const DUEL_SPECIAL_KILLS = 6;
const PIN_APPROACH_SPEED = 43;
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
        bonusRng: (seed ^ 0x63d83595) >>> 0,
        awarded: [0, 0],
        lastBonus: [null, null],
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

function makePin(game, court, kind, x, y, facing) {
    const u = configureEnemy(
        {
            id: game.pinState.nextPinId++,
            court,
            expiresAtMs: game.clock.nowMs + PIN_LIFETIME_MS,
            x,
            y,
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
    const baselineDraw = { rng: state.rng };
    const bonusDraw = { rng: state.bonusRng };
    const sharedSpecial = drawSpecial(baselineDraw);
    const specials = [[sharedSpecial], [sharedSpecial]];
    const earned = game.players.map(({ score }) => Math.floor(score / DUEL_SPECIAL_KILLS));
    for (const { side } of game.players) {
        for (let i = state.awarded[side]; i < earned[side]; i++) {
            specials[1 - side].push(drawSpecial(bonusDraw));
        }
    }
    const rosters = specials.map((kinds, side) => planDuelSpawn(game, side, kinds));
    if (rosters.some((roster) => !roster)) return;
    for (const [court, roster] of rosters.entries()) {
        const count = specials[court].length - 1;
        if (count > 0) state.lastBonus[court] = { tick: game.tick + 1, count };
        const bonusStart = roster.length - count;
        for (const [index, { kind, x, y, facing }] of roster.entries()) {
            makePin(game, court, kind, x, y, facing);
            if (index >= bonusStart)
                game.fxOnCourt(
                    court,
                    'special-drop',
                    x,
                    y,
                    0,
                    Math.max(24, ENEMY_TYPES[kind].r * 1.5),
                );
        }
    }
    state.rng = baselineDraw.rng;
    state.bonusRng = bonusDraw.rng;
    state.awarded = earned;
    state.waves++;
    state.nextWaveAtMs = game.clock.nowMs + DUEL_WAVE_MS;
}

export function hurtDuelPin(
    game,
    pin,
    { damage, vx = 0, vy = 0, vz = 0, stun = 0, playerIndex, depth },
) {
    if (pin.hp <= 0 || !Number.isFinite(damage) || damage <= 0) return false;
    if (playerIndex !== undefined && (playerIndex !== pin.court || !game.players[playerIndex]))
        return false;

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
    game.fxOnCourt(pin.court, 'hit', pin.x, pin.y, pin.z + 12, 16, '#ffe6a6');
    if (pin.hp === 0) {
        if (playerIndex !== undefined) game.players[playerIndex].score++;
        game.fxOnCourt(pin.court, 'ko', pin.x, pin.y, pin.z + 20, 16, '#f4ba77');
    }
    return true;
}

function movePin(pin, a, dt) {
    const x = pin.x + pin.vx * dt;
    const y = pin.y + pin.vy * dt;
    pin.x = clamp(x, a.left + pin.r, a.right - pin.r);
    pin.y = clamp(y, a.top + pin.r, a.bottom - pin.r);
    if (x !== pin.x) pin.vx *= -0.45;
    if (y !== pin.y) pin.vy *= -0.45;
    resolveReflectors(pin, a.reflectors, pin.z);
}

function airborne(pin, world, dt) {
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
        world.fx('land', pin.x, pin.y, 0, 15, '#c6d6a1');
    }
}

function stepPin(pin, world, dt) {
    pin.flash = Math.max(0, pin.flash - dt);
    pin.stun = Math.max(0, pin.stun - dt);
    if (pin.hp <= 0) pin.deadAge += dt;
    if (pin.z > 0 || pin.vz > 0) {
        airborne(pin, world, dt);
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
    movePin(pin, world.arena, dt);
}

function explodeBomb(pin, game, world, dt) {
    if (pin.fuse === null || pin.exploded) return;
    pin.fuse -= dt;
    if (pin.fuse > 0) return;
    pin.exploded = true;
    pin.fuse = 0;
    pin.hp = 0;
    world.fx('stomp', pin.x, pin.y, pin.z, BOMB_RADIUS, '#ffae6f');
    for (const enemy of world.enemies) {
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
    const duck = world.boss;
    if (pin.z < 40 && Math.hypot(duck.x - pin.x, duck.y - pin.y) < BOMB_RADIUS + duck.r) {
        game.pushDuck(pin.court, { x: pin.x, y: pin.y, strength: 1.25 });
    }
}

// Each court supplies its duck, hazards and attack warning limits to the campaign behavior.
function targetWorld(game, side, pins) {
    const state = game.pinState.targets[side];
    return {
        boss: game.players[side].boss,
        enemies: pins,
        arena: game.courts[side],
        threatMode: true,
        combatClock: state.clock,
        pinBlastStats: state.blastStats,
        enemyProjectileStats: state.projectileStats,
        enemyProjectiles: game.projectiles.filter((p) => p.court === side),
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
        fx: (...args) => game.fxOnCourt(side, ...args),
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
        groups[pin.court].push(pin);
    }
    const worlds = groups.map((pins, side) => targetWorld(game, side, pins));
    const duckPoints = ducks.map((duck) => ({
        x: duck.x,
        y: duck.y,
        z: duck.recoil?.z ?? 0,
    }));
    for (const [side, world] of worlds.entries()) {
        for (const pin of world.enemies) stepPin(pin, world, dt);
        for (const projectile of world.enemyProjectiles) projectile.court = side;
        stepEnemyProjectiles(world, dt, state.previousDucks?.[side] ?? duckPoints[side]);
    }
    state.previousDucks = duckPoints;
    game.projectiles = worlds.flatMap((world) => world.enemyProjectiles);
    for (const world of worlds) for (const pin of world.enemies) explodeBomb(pin, game, world, dt);
    const liveGroups = groups.map((pins) =>
        pins.filter((pin) => pin.deadAge < 1.3 || (pin.fuse !== null && !pin.exploded)),
    );
    game.pins = liveGroups.flat();
    return liveGroups;
}
