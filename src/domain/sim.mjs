import { STEP_SECONDS, PHYSICS_STEP_SECONDS, MAX_FRAME_SECONDS } from './timing.mjs';
import { ARENA } from './arena.mjs';
import { configureEnemy, shieldFront, specialDrive, ignite, stepBombs } from './enemies.mjs';
import { BALL_TYPES, prepareRoll, stepRoll } from './dynamics.mjs';
import {
    breakReflector,
    reflectorIsActive,
    reflectorOverlaps,
    resolveReflectors,
    restoreReflector,
} from './terrain.mjs';
import { startPinMagnet, stepBallCaroms, stepPinMagnets } from './extra-augments.mjs';
import {
    MEANINGFUL_BALL_IMPACT,
    PIN_LAUNCH_KICK,
    ROLL_SETTLE_SPEED,
    observeBallImpact,
    stepBallVault,
    trySecondRoll,
} from './ball-vault.mjs';
import { stepPinProjectileThreat, stepEnemyProjectiles } from './pin-projectiles.mjs';
import { PIN_BLAST, isRegularPinBlast, stepPinBlast } from './pin-blast.mjs';
import { DUCK_COMBAT, advanceCombatClock, deadlineMs, remainingMs } from './combat-clock.mjs';
import {
    BODY_GRAVITY,
    duckDashOpen,
    duckAimOpen,
    startDuckRecoil,
    controlDuckRecoil,
    stepDuckRecoil,
} from './duck-recoil.mjs';
import { stepMobility, freezeMovement, stepManual, MANUAL } from './locomotion.mjs';
import { bowlerPose, SWING_TIME, FOLLOW_TIME } from './bowler.mjs';
import { bowlerDefinition } from './bowlers.mjs';
// Independent arcade circle physics. No assets/state from the earlier modes are changed.
export const WORLD = { width: ARENA.width, height: ARENA.height, duration: 60 };
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
export class BowlingGame {
    constructor(
        seed = 42,
        {
            autoWaves = true,
            duration = 60,
            arena = ARENA,
            onEvent,
            bowler,
            home = { x: 300, y: 630, ballY: 790 },
        } = {},
    ) {
        this.arena = arena;
        this.onEvent = onEvent;
        this.dashCapacity = 2;
        this.dashCharges = this.dashCapacity;
        this.dashOnly = false;
        this.dashRechargeRemaining = 0;
        this.controlMode = 'auto';
        this.threatMode = false;
        this.moveInput = { x: 0, y: 0 };
        this.lastMove = { x: 0, y: -1 };
        this.autoWaves = autoWaves;
        this.duration = duration;
        this.mods = { mass: 1, radius: 0, speed: 1, drag: 1, bounce: 0, curve: 1, restitution: 0 };
        this.seed = seed;
        this.rng = seed;
        this.selectedType = 'basic';
        this.selectedSpin = 0;
        this.time = 0;
        this.phase = 'playing';
        this.serial = 0;
        this.enemies = [];
        this.effects = [];
        this.wave = 0;
        this.nextWave = 0;
        this.shake = 0;
        const character = bowlerDefinition(bowler);
        this.boss = {
            arena,
            bowlerId: character.id,
            x: home.x,
            y: home.y,
            homeX: home.x,
            homeY: home.y,
            r: character.radius,
            facing: -Math.PI / 2,
            aimPower: 0,
            aiming: false,
            delivery: null,
            heldBallId: 0,
            moveVx: 0,
            moveVy: 0,
            moving: false,
            moveDistance: 0,
            walkPhase: 0,
            hp: 720,
            maxHp: 720,
            wind: 0,
            pulse: 0,
            flash: 0,
            clock: 2.4,
            pulseAge: 0,
            stompId: 0,
        };
        this.balls = [140, 300, 460].map((x, id) => ({
            id,
            homeX: x,
            homeY: home.ballY,
            x,
            y: home.ballY,
            z: 0,
            vx: 0,
            vy: 0,
            r: 23,
            mass: 16,
            angle: 0,
            ready: true,
            inWorld: false,
            pickupArmed: false,
            cooldown: 0,
            life: 0,
            age: 0,
            trail: [],
            hitIds: new Set(),
            chain: 0,
        }));
        this.stats = {
            pickups: 0,
            wallBounces: 0,
            rockBounces: 0,
            shots: 0,
            hits: 0,
            chainHits: 0,
            kills: 0,
            bestChain: 0,
            bossDamage: 0,
            autoHits: 0,
            landings: 0,
        };
        this.lastShotHits = 0;
        this.impactPairs = new Map();
        this.remaining = duration;
        if (autoWaves) this.spawnWave();
        this.syncHand();
    }
    setMove(x, y) {
        const d = Math.hypot(x, y);
        if (!Number.isFinite(d)) {
            x = y = 0;
        } else if (d > 1) {
            x /= d;
            y /= d;
        }
        this.moveInput = { x, y };
        if (Math.hypot(x, y) > 0.01) {
            const n = Math.hypot(x, y);
            this.lastMove = { x: x / n, y: y / n };
        }
        return this.moveInput;
    }
    dash() {
        const b = this.boss,
            v = this.moveInput,
            n = Math.hypot(v.x, v.y);
        if (
            this.controlMode !== 'manual' ||
            this.phase !== 'playing' ||
            !Number.isFinite(n) ||
            n <= 0.001
        )
            return false;
        if (!duckDashOpen(b) || (this.dashOnly && this.dashCharges <= 0)) return false;
        controlDuckRecoil(b);
        b.delivery = null;
        this.setAim(null);
        b.dashCooldown = 0;
        if (this.dashCharges <= 0) {
            b.dashRemaining = 0;
            b.moveVx = v.x * MANUAL.speed;
            b.moveVy = v.y * MANUAL.speed;
            b.moving = true;
            return false;
        }
        this.dashCharges--;
        if (this.dashRechargeRemaining <= 0) this.dashRechargeRemaining = 0.5;
        b.dashX = v.x / n;
        b.dashY = v.y / n;
        b.dashRemaining = this.dashOnly ? MANUAL.burstDuration : MANUAL.dashDuration;
        b.dashCooldown = 0;
        const speed = this.dashOnly ? MANUAL.burstSpeed : MANUAL.dashSpeed;
        b.moveVx = b.dashX * speed;
        b.moveVy = b.dashY * speed;
        if (this.dashOnly) {
            b.dashPose = 0;
            b.dashTrail = [{ x: b.x, y: b.y }];
            b.facing = Math.atan2(b.dashY, b.dashX);
        }
        b.moving = true;
        this.dashStarts = (this.dashStarts || 0) + 1;
        this.lastDash = { time: this.time, x: b.x, y: b.y, dx: b.dashX, dy: b.dashY };
        this.onEvent?.('dash');
        return true;
    }

    damageBoss(amount, source = 'contact', impact) {
        const b = this.boss,
            clock = this.combatClock,
            locked = clock
                ? remainingMs(clock, clock.damageReadyAtMs) > 0
                : this.threatMode && (b.damageGap || 0) > 0;
        if (this.phase !== 'playing' || amount <= 0 || !Number.isFinite(amount) || locked)
            return false;
        const attack = clock
                ? impact?.damageClass === 'projectile'
                    ? DUCK_COMBAT.projectileDamage
                    : DUCK_COMBAT.damagePerHit
                : amount,
            taken = Math.min(b.hp, attack);
        b.hp = Math.max(0, b.hp - attack);
        b.flash = 0.18;
        b.hurtAge = 0;
        b.lastDamage = { amount: taken, source, time: this.time };
        if (clock) {
            clock.damageReadyAtMs = deadlineMs(clock, PIN_BLAST.hitGapMs);
            startDuckRecoil(this, impact);
        } else b.damageGap = this.threatMode ? 0.22 : 0;
        this.stats.bossDamage += taken;
        this.onEvent?.('duckHit');
        return true;
    }
    random() {
        this.rng = (Math.imul(this.rng, 1664525) + 1013904223) >>> 0;
        return this.rng / 4294967296;
    }
    spawn(x, y, kind = 'grunt') {
        const u = {
            id: ++this.serial,
            x,
            y,
            z: 0,
            vx: 0,
            vy: 0,
            vz: 0,
            r: 10,
            mass: 1,
            hp: 30,
            maxHp: 30,
            angle: 0,
            spin: 0,
            stun: 0,
            attached: false,
            flash: 0,
            deadAge: 0,
            attackClock: 0.2 + this.random() * 0.5,
            speed: 37 + this.random() * 13,
            lastStomp: -1,
            sourceShot: null,
            chainDepth: 0,
        };
        configureEnemy(u, kind);
        this.enemies.push(u);
        return u;
    }
    spawnWave() {
        this.wave++;
        const count = 14 + Math.min(10, this.wave);
        for (let i = 0; i < count; i++) {
            const side = this.wave % 3;
            if (side === 0)
                this.spawn(i % 2 ? ARENA.left + 38 : ARENA.right - 38, 95 + Math.floor(i / 2) * 29);
            else this.spawn(75 + (i % 10) * 49, 25 - Math.floor(i / 10) * 28);
        }
        this.nextWave = this.time + 3.5;
    }
    fx(kind, x, y, z = 0, size = 20, color = '#ffe7a7', text) {
        this.effects.push({
            kind,
            x,
            y,
            z,
            size,
            color,
            text,
            age: 0,
            life: kind === 'pickup' ? 0.8 : kind === 'ko' ? 0.8 : kind === 'stomp' ? 0.55 : 0.45,
        });
    }
    setShotOptions({ type = this.selectedType, spin = this.selectedSpin } = {}) {
        if (
            !duckAimOpen(this.boss) ||
            this.boss.delivery ||
            this.boss.aiming ||
            this.phase !== 'playing' ||
            !Object.hasOwn(BALL_TYPES, type) ||
            !Number.isFinite(spin) ||
            Math.abs(spin) > 1
        )
            return false;
        this.selectedType = type;
        this.selectedSpin = spin;
        this.syncHand();
        return true;
    }
    setAim(aim) {
        const b = this.boss;
        if (!aim) {
            b.aiming = false;
            b.aimPower = 0;
            if (!b.delivery) {
                this.selectedSpin = 0;
                this.syncHand();
            }
            return;
        }
        if (b.delivery || this.phase !== 'playing' || !duckAimOpen(b)) return;
        const ball = this.balls.find((v) => v.id === aim.ballId && v.ready);
        if (!ball) return;
        b.dashRemaining = 0;
        b.heldBallId = ball.id;
        this.selectedSpin = clamp(Number.isFinite(aim.spin) ? aim.spin : 0, -1, 1);
        freezeMovement(b);
        b.aiming = true;
        b.aimPower = aim.power || 0;
        if (Math.hypot(aim.vx, aim.vy) > 1) b.facing = Math.atan2(aim.vy, aim.vx);
        this.syncHand();
    }
    syncHand() {
        const b = this.boss;
        if (!b.delivery) {
            let held = this.balls.find((v) => v.id === b.heldBallId && v.ready);
            if (!held) held = this.balls.find((v) => v.ready);
            b.heldBallId = held?.id ?? null;
        }
        for (const ball of this.balls) ball.held = ball.id === b.heldBallId && ball.ready;
        if (b.heldBallId !== null) {
            const ball = this.balls[b.heldBallId];
            if (ball?.held) {
                if (!b.delivery) {
                    ball.type = this.selectedType;
                    ball.spin = this.selectedSpin;
                    ball.mass = BALL_TYPES[this.selectedType].mass;
                }
                if (!b.delivery) {
                    const p = prepareRoll({ type: this.selectedType, mods: this.mods });
                    ball.r = p.r;
                    ball.mass = p.mass;
                    ball.type = p.type;
                    ball.physical = { ...p.physical };
                    b.ballRadius = p.r;
                }
                const h = bowlerPose(b).hand;
                ball.x = h.x;
                ball.y = h.y;
                ball.z = h.z - ball.r;
            }
        }
    }
    launch(id, vx, vy, spin = this.selectedSpin) {
        const b = this.balls.find((v) => v.id === id),
            speed = Math.hypot(vx, vy);
        if (
            this.phase !== 'playing' ||
            this.boss.delivery ||
            !duckAimOpen(this.boss) ||
            !b?.ready ||
            !Number.isFinite(speed) ||
            speed < 100
        )
            return false;
        const s = clamp(speed, 100, 1080) / speed,
            profile = prepareRoll({
                vx: vx * s,
                vy: vy * s,
                type: this.selectedType,
                spin,
                mods: this.mods,
            });
        this.selectedSpin = profile.spin;
        Object.assign(b, {
            type: profile.type,
            spin: profile.spin,
            mass: profile.mass,
            r: profile.r,
            physical: { ...profile.physical },
        });
        this.boss.ballRadius = b.r;
        b.hitIds.clear();
        b.chain = 0;
        this.boss.dashRemaining = 0;
        freezeMovement(this.boss);
        this.boss.heldBallId = id;
        this.boss.facing = Math.atan2(vy, vx);
        this.boss.delivery = {
            phase: 'swing',
            elapsed: 0,
            power: clamp((speed - 250) / 830, 0, 1),
            vx: profile.vx,
            vy: profile.vy,
            type: profile.type,
            spin: profile.spin,
            ballId: id,
        };
        this.boss.aiming = false;
        this.syncHand();
        return true;
    }
    updateBowler(dt) {
        const b = this.boss,
            d = b.delivery;
        if (d) {
            const previous = bowlerPose(b).hand;
            d.elapsed += dt;
            if (d.phase === 'swing') {
                this.syncHand();
                const held = this.balls[d.ballId],
                    current = bowlerPose(b).hand;
                const vx = (current.x - previous.x) / dt,
                    vy = (current.y - previous.y) / dt,
                    speed = Math.hypot(vx, vy),
                    scale = Math.min(1, 1080 / (speed || 1)),
                    proxy = {
                        ...held,
                        vx: vx * scale,
                        vy: vy * scale,
                        mass: held.mass * 2,
                        held: true,
                    };
                for (const u of this.enemies) this.ballContact(proxy, u);
                held.chain = proxy.chain;
                if (d.elapsed >= SWING_TIME) {
                    const ball = this.balls[d.ballId],
                        h = bowlerPose(b).hand;
                    ball.x = h.x;
                    ball.y = h.y;
                    ball.z = 0;
                    ball.hookTime = 0;
                    ball.hookTurn = 0;
                    ball.ready = false;
                    ball.inWorld = true;
                    ball.pickupArmed = false;
                    ball.held = false;
                    ball.vx = d.vx;
                    ball.vy = d.vy;
                    ball.life = 4.8;
                    ball.age = 0;
                    ball.lastTrail = -1;
                    ball.trail = [];
                    this.stats.shots++;
                    this.lastRelease = {
                        x: h.x,
                        y: h.y,
                        z: h.z,
                        vx: d.vx,
                        vy: d.vy,
                        type: d.type,
                        spin: d.spin,
                        time: this.time,
                    };
                    this.fx('shot', h.x, h.y, 0, 24);
                    this.onEvent?.('release');
                    b.heldBallId = null;
                    d.phase = 'follow';
                    d.elapsed = 0;
                }
            } else {
                if (d.elapsed >= FOLLOW_TIME) {
                    b.delivery = null;
                    b.aimPower = 0;
                }
            }
        }
        this.syncHand();
    }
    retire(b) {
        b.secondRoll = null;
        b.life = 0;
        b.cooldown = 1.5;
        b.vx = b.vy = 0;
        b.trail = [];
    }
    pickup(b) {
        if (b.ready || !b.inWorld || b.vault) return false;
        const event = {
            ballId: b.id,
            x: b.x,
            y: b.y,
            time: this.time,
            type: b.type,
            wasRolling: b.life > 0,
        };
        Object.assign(b, {
            ready: true,
            inWorld: false,
            pickupArmed: false,
            life: 0,
            cooldown: 0,
            vx: 0,
            vy: 0,
            z: 0,
            trail: [],
            held: false,
            vaultArmed: false,
            secondRoll: null,
        });
        this.stats.pickups++;
        this.lastPickup = event;
        this.onEvent?.('pickup');
        this.fx('pickup', event.x, event.y, 12, 28, '#9ce4d0', '+1 회수');
        this.syncHand();
        return true;
    }
    checkPickup(b, previous, bossPrevious) {
        if (b.ready || !b.inWorld || b.vault) return false;
        const boss = this.boss,
            r = boss.r + b.r;
        const ax = previous.x - bossPrevious.x,
            ay = previous.y - bossPrevious.y,
            az = (previous.z ?? 0) - (bossPrevious.z ?? 0);
        const bx = b.x - boss.x,
            by = b.y - boss.y,
            bz = (b.z ?? 0) - (boss.recoil?.z ?? 0);
        if (!b.pickupArmed) {
            if (Math.hypot(ax, ay, az) > r + 1e-6) b.pickupArmed = true;
            else {
                if (Math.hypot(bx, by, bz) > r + 1e-6) b.pickupArmed = true;
                return false;
            }
        }
        const dx = bx - ax,
            dy = by - ay,
            dz = bz - az,
            t = clamp(-(ax * dx + ay * dy + az * dz) / (dx * dx + dy * dy + dz * dz || 1), 0, 1);
        return Math.hypot(ax + t * dx, ay + t * dy, az + t * dz) <= r ? this.pickup(b) : false;
    }
    boundEnemy(u) {
        const arena = u.arena ?? this.arena;
        if (arena.reflectors) resolveReflectors(u, arena.reflectors, u.z, 0);
        const left = arena.left + u.r,
            right = arena.right - u.r,
            bottom = arena.bottom - u.r;
        if (u.x < left) {
            u.x = left;
            if (u.vx < 0) u.vx *= -0.45;
        } else if (u.x > right) {
            u.x = right;
            if (u.vx > 0) u.vx *= -0.45;
        }
        if (u.y > bottom) {
            u.y = bottom;
            if (u.vy > 0) u.vy *= -0.45;
        } else if (arena.enclosedPins && u.y < arena.top + u.r) {
            u.y = arena.top + u.r;
            if (u.vy < 0) u.vy *= -0.45;
        }
    }
    hurt(u, damage, nx, ny, impulse, shot = null, depth = 0, scoreSerial = null) {
        if (u.hp <= 0) return;
        if (u.pinSlot) u.pinSlot.rack.active = false;
        if (u.kind === 'bomb' && u.fuse === null) u.scoreFuseSerial = scoreSerial;
        if (!this.pinBlastMode || shot != null) ignite(u);
        u.hp = Math.max(0, u.hp - damage);
        u.flash = 0.18;
        u.attached = false;
        u.projectileHop = false;
        u.projectileWarning = null;
        u.stun = Math.max(u.stun, 0.28);
        const kick = impulse / Math.max(1, u.mass);
        if (kick > PIN_LAUNCH_KICK) {
            u.vz = Math.max(u.vz, Math.min(250, 90 + kick * 0.24));
            u.z = Math.max(1, u.z);
            u.spin = (u.id % 2 ? 1 : -1) * (6 + kick * 0.012);
        }
        u.sourceShot = shot;
        u.chainDepth = depth;
        u.scoreCause = scoreSerial;
        this.scoreDamage?.(u, scoreSerial, {
            defeated: u.hp <= 0,
            direct: depth === 0 && scoreSerial !== null,
        });
        this.fx(
            'hit',
            u.x,
            u.y,
            u.z + 12,
            Math.min(38, 12 + impulse * 0.025),
            depth ? '#9ce4d0' : '#ffe6a6',
        );
        if (u.hp <= 0) {
            this.stats.kills++;
            this.fx('ko', u.x, u.y, u.z + 20, 16, '#f4ba77');
        }
        this.shake = Math.max(this.shake, Math.min(5, impulse * 0.006));
        if (shot != null) this.onEvent?.(depth ? 'pinChain' : 'pinHit', impulse);
    }
    ballContact(b, u) {
        if (u.hp <= 0 || (!b.vault && u.z > 60) || b.vault?.pinId === u.id) return;
        const dz = (b.z || 0) + b.r - (u.z + u.r);
        const checkHeight = b.held || u.projectileHop || b.vault;
        if (checkHeight && Math.abs(dz) >= b.r + u.r) return;
        const dx = u.x - b.x,
            dy = u.y - b.y,
            d = Math.hypot(dx, dy),
            r = checkHeight ? Math.sqrt((b.r + u.r) ** 2 - dz * dz) : b.r + u.r;
        if (d >= r || d < 1e-7) return;
        const nx = dx / d,
            ny = dy / d,
            closing = (b.vx - u.vx) * nx + (b.vy - u.vy) * ny;
        const overlap = r - d;
        u.x += nx * overlap * 0.94;
        u.y += ny * overlap * 0.94;
        b.x -= nx * overlap * 0.06;
        b.y -= ny * overlap * 0.06;
        if (closing <= 0) return;
        const impact = observeBallImpact(b, u, nx, ny, closing);
        const flight = this.onDescendingPinCatch
            ? {
                  vx: b.vx,
                  vy: b.vy,
                  pinVz: u.vz,
                  pinZ: u.z,
                  airContact: d * d + dz * dz < (b.r + u.r) ** 2,
              }
            : null;
        if (shieldFront(u, b)) {
            if (closing > MEANINGFUL_BALL_IMPACT && u.pinSlot) u.pinSlot.rack.active = false;
            const bounce = 1.4 * closing;
            b.vx -= nx * bounce;
            b.vy -= ny * bounce;
            u.vx += nx * closing * 0.12;
            u.vy += ny * closing * 0.12;
            this.fx('hit', u.x, u.y, 15, 20, '#b5cfdf');
            if (closing > MEANINGFUL_BALL_IMPACT) {
                this.onEvent?.('pinBlock');
                startPinMagnet(this, b, u);
            }
            return impact;
        }
        const impulse =
            ((1 + (b.physical?.restitution ?? 0.48)) * closing) / (1 / b.mass + 1 / u.mass);
        u.vx += (nx * impulse) / u.mass;
        u.vy += (ny * impulse) / u.mass;
        b.vx -= (nx * impulse) / b.mass;
        b.vy -= (ny * impulse) / b.mass;
        if (closing > MEANINGFUL_BALL_IMPACT && !b.hitIds.has(u.id)) {
            b.hitIds.add(u.id);
            b.chain++;
            this.stats.hits++;
            this.stats.bestChain = Math.max(this.stats.bestChain, b.chain);
            this.lastShotHits = b.chain;
            this.hurt(
                u,
                Math.min(50, impulse * 0.105),
                nx,
                ny,
                impulse,
                b.id,
                0,
                b.scoreSerial ?? null,
            );
        }
        if (closing > MEANINGFUL_BALL_IMPACT) {
            startPinMagnet(this, b, u);
            this.onDescendingPinCatch?.(b, u, flight);
        }
        return impact;
    }
    enemyContact(a, b) {
        if (a.z > 45 || b.z > 45 || Math.abs(a.z - b.z) > 30) return;
        const dx = b.x - a.x,
            dy = b.y - a.y,
            d = Math.hypot(dx, dy),
            r = a.r + b.r;
        if (d >= r || d < 1e-7) return;
        const nx = dx / d,
            ny = dy / d,
            overlap = (r - d) * 1.02,
            ia = 1 / a.mass,
            ib = 1 / b.mass,
            total = ia + ib;
        a.x -= (nx * overlap * ia) / total;
        a.y -= (ny * overlap * ia) / total;
        b.x += (nx * overlap * ib) / total;
        b.y += (ny * overlap * ib) / total;
        const closing = (a.vx - b.vx) * nx + (a.vy - b.vy) * ny;
        if (closing <= 0) return;
        const ca = a.vx * nx + a.vy * ny > 0 ? a.scoreCause : null,
            cb = b.vx * nx + b.vy * ny < 0 ? b.scoreCause : null;
        const scoreSerial = ca != null && cb != null && ca !== cb ? null : (ca ?? cb ?? null);
        const impulse = (1.36 * closing) / total;
        a.vx -= nx * impulse * ia;
        a.vy -= ny * impulse * ia;
        b.vx += nx * impulse * ib;
        b.vy += ny * impulse * ib;
        const key = `${a.id}:${b.id}`,
            recoilOnly =
                this.pinBlastMode &&
                scoreSerial == null &&
                (a.attackStage === 'pin-recover' || b.attackStage === 'pin-recover');
        if (
            closing > 125 &&
            !recoilOnly &&
            (this.impactPairs.get(key) || -100) < this.time - 0.28
        ) {
            this.impactPairs.set(key, this.time);
            const source = a.sourceShot != null ? a : b,
                shot = source.sourceShot,
                depth = source.chainDepth + 1;
            for (const u of [a, b]) {
                if (u.hp > 0) {
                    this.hurt(
                        u,
                        Math.min(35, impulse * 0.11),
                        nx,
                        ny,
                        impulse,
                        shot,
                        depth,
                        scoreSerial,
                    );
                    if (shot != null) this.stats.chainHits++;
                }
            }
            if (shot != null) {
                const ball = this.balls[shot];
                ball.chain++;
                this.stats.bestChain = Math.max(this.stats.bestChain, ball.chain);
                this.lastShotHits = ball.chain;
            }
        }
    }
    stepThreat(u, dt) {
        if (isRegularPinBlast(this, u)) {
            if (!stepPinProjectileThreat(this, u)) stepPinBlast(this, u);
            return;
        }
        if (u.hp <= 0 || u.z > 8 || u.stun > 0) {
            u.attackStage = 'idle';
            u.attackTimer = 0.7;
            return;
        }
        const b = this.boss,
            dx = b.x - u.x,
            dy = b.y - u.y,
            d = Math.hypot(dx, dy),
            reach = b.r + u.r + 26;
        if (u.attackStage === 'warn') {
            u.attackTimer -= dt;
            if (u.attackTimer <= 0) {
                const dot = (dx * u.attackNx + dy * u.attackNy) / (d || 1);
                if (d < reach && dot > 0.55)
                    this.damageBoss(u.kind === 'giant' ? 30 : 12, u.kind, { x: u.x, y: u.y });
                u.attackStage = 'recover';
                u.attackTimer = 0.85;
            }
        } else if (u.attackStage === 'recover') {
            u.attackTimer -= dt;
            if (u.attackTimer <= 0) u.attackStage = 'idle';
        } else if (d < reach + 8) {
            u.attackStage = 'warn';
            u.attackTimer = 0.45;
            u.attackNx = dx / (d || 1);
            u.attackNy = dy / (d || 1);
        }
        u.attackTelegraph = u.attackStage === 'warn' ? 1 - u.attackTimer / 0.45 : 0;
    }
    get terrainTimeMs() {
        return this.combatClock?.nowMs ?? Math.floor(this.time * 1000);
    }
    handleReflectorHit(ball) {
        const rock = ball.rockHit;
        if (!rock) return;
        breakReflector(rock, this.terrainTimeMs);
        this.stats.rockBounces++;
        this.lastRockBounce = {
            x: ball.x,
            y: ball.y,
            vx: ball.vx,
            vy: ball.vy,
            ballId: ball.id,
            time: this.time,
        };
        this.fx('rock-break', rock.x, rock.y, rock.height * 0.4, rock.width * 0.6);
        this.onEvent?.('rockHit', (Math.hypot(ball.vx, ball.vy) * ball.mass) / 20);
    }
    restoreArenaReflectors() {
        for (const rock of this.arena.reflectors ?? []) {
            const restored = restoreReflector(
                rock,
                this.terrainTimeMs,
                () =>
                    reflectorOverlaps(this.boss, rock, this.boss.recoil?.z ?? 0) ||
                    this.enemies.some((pin) => reflectorOverlaps(pin, rock, pin.z)) ||
                    this.balls.some(
                        (ball) =>
                            (ball.inWorld || ball.held) && reflectorOverlaps(ball, rock, ball.z),
                    ) ||
                    (this.echoes ?? []).some((ball) => reflectorOverlaps(ball, rock, ball.z)),
            );
            if (restored) this.fx('rock-return', rock.x, rock.y, 0, rock.width);
        }
    }
    tick(dt) {
        if (this.phase !== 'playing') return;
        if (this.combatClock) advanceCombatClock(this.combatClock, dt, this.realTimeScale ?? 1);
        if (this.arena.reflectors) this.restoreArenaReflectors();
        const bossPrevious = { x: this.boss.x, y: this.boss.y, z: this.boss.recoil?.z ?? 0 },
            ballPrevious = this.balls.map((b) => ({
                x: b.x,
                y: b.y,
                z: b.z,
                inWorld: b.inWorld,
                ready: b.ready,
                held: b.held,
                life: b.life,
                vault: b.vault,
                radius: b.r,
                recalling: b.recalling,
            }));
        const deferProjectiles = this.augments?.includes('break-bullet');
        if (this.dashCharges < this.dashCapacity) {
            this.dashRechargeRemaining -= dt * (this.realTimeScale ?? 1);
            while (this.dashRechargeRemaining <= 1e-10 && this.dashCharges < this.dashCapacity) {
                this.dashCharges++;
                this.dashRechargeRemaining =
                    this.dashCharges === this.dashCapacity ? 0 : this.dashRechargeRemaining + 0.5;
            }
        }
        this.time += dt;
        this.remaining = Math.max(0, this.duration - this.time);
        this.shake = Math.max(0, this.shake - dt * 12);
        if (this.autoWaves && this.time >= this.nextWave && this.time < this.duration - 5)
            this.spawnWave();
        this.boss.damageGap = Math.max(0, (this.boss.damageGap || 0) - dt);
        this.boss.hurtAge = (this.boss.hurtAge ?? 99) + dt;
        if (this.controlMode === 'manual') stepManual(this, dt);
        else stepMobility(this, dt);
        if (this.boss.recoil) stepDuckRecoil(this, dt);
        if (!deferProjectiles) stepEnemyProjectiles(this, dt, bossPrevious);
        this.updateBowler(dt);
        const boss = this.boss;
        boss.flash = Math.max(0, boss.flash - dt);
        boss.clock -= dt;
        boss.wind = 0;
        boss.pulse = Math.max(0, boss.pulse - dt * 5);
        if (boss.clock <= 0 && !boss.aiming && !boss.delivery) {
            boss.clock = 1.4;
            const near = this.enemies
                .filter(
                    (u) =>
                        u.hp > 0 &&
                        u.z < 15 &&
                        Math.hypot(u.x - boss.x, u.y - boss.y) < boss.r + 35,
                )
                .sort(
                    (a, b) =>
                        Math.hypot(a.x - boss.x, a.y - boss.y) -
                        Math.hypot(b.x - boss.x, b.y - boss.y),
                )
                .slice(0, 2);
            for (const u of near) {
                const dx = u.x - boss.x,
                    dy = u.y - boss.y,
                    d = Math.hypot(dx, dy) || 1;
                u.vx += (dx / d) * 100;
                u.vy += (dy / d) * 100;
                this.hurt(u, 5, dx / d, dy / d, 70);
                this.stats.autoHits++;
            }
            if (near.length) {
                boss.pulse = 0.2;
                this.fx('land', boss.x, boss.y, 0, 70, '#beca9a');
            }
        }
        for (const b of this.balls) {
            if (b.ready) continue;
            const previous = ballPrevious[b.id].inWorld
                ? ballPrevious[b.id]
                : { x: b.x, y: b.y, z: b.z };
            if (b.life <= 0) {
                if (this.checkPickup(b, previous, bossPrevious)) continue;
                b.cooldown -= dt;
                if (b.cooldown <= 0) {
                    b.ready = true;
                    b.inWorld = false;
                    b.pickupArmed = false;
                    b.z = 0;
                    b.x = b.homeX;
                    b.y = b.homeY;
                    b.angle = 0;
                    b.cooldown = 0;
                }
                continue;
            }
            b.life -= dt;
            b.age += dt;
            stepRoll(b, dt, b.arena ?? this.arena);
            if (b.rockHit) this.handleReflectorHit(b);
            stepBallVault(this, b, dt);
            if (deferProjectiles)
                ballPrevious[b.id].end = { x: b.x, y: b.y, z: b.z, vault: !!b.vault };
            if (b.wallHit) {
                this.stats.wallBounces++;
                this.lastWallBounce = {
                    x: b.x,
                    y: b.y,
                    vx: b.vx,
                    vy: b.vy,
                    time: this.time,
                    sides: [...b.wallHitSides],
                    ballId: b.id,
                };
                this.fx('hit', b.x, b.y, 0, 12);
            }
            if (this.checkPickup(b, previous, bossPrevious)) continue;
            if (
                !b.vault &&
                (b.life <= 0 ||
                    (Math.hypot(b.vx, b.vy) < ROLL_SETTLE_SPEED && !trySecondRoll(this, b)))
            ) {
                this.retire(b);
                continue;
            }
            if (b.age - (b.lastTrail || -1) > 0.035) {
                b.trail.push(b.vault ? { x: b.x, y: b.y, z: b.z } : { x: b.x, y: b.y });
                b.lastTrail = b.age;
                if (b.trail.length > 9) b.trail.shift();
            }
        }
        stepBallCaroms(this, ballPrevious);
        if (deferProjectiles) stepEnemyProjectiles(this, dt, bossPrevious, ballPrevious);
        stepPinMagnets(this, dt);
        for (const u of this.enemies) {
            u.flash = Math.max(0, u.flash - dt);
            u.stun = Math.max(0, u.stun - dt);
            u.attackClock -= dt;
            if (u.hp <= 0) u.deadAge += dt;
            if (u.z > 0 || u.vz > 0) {
                u.vz -= BODY_GRAVITY * dt;
                u.z += u.vz * dt;
                u.angle += u.spin * dt;
                if (u.z <= 0) {
                    u.z = 0;
                    u.vz = 0;
                    u.projectileHop = false;
                    u.stun = Math.max(u.stun, 0.18);
                    u.spin *= 0.3;
                    this.stats.landings++;
                    this.fx('land', u.x, u.y, 0, 15, '#c6d6a1');
                }
                if (!u.projectileHop) {
                    u.vx *= Math.exp(-0.75 * dt);
                    u.vy *= Math.exp(-0.75 * dt);
                }
            } else if (u.hp > 0 && u.stun <= 0) {
                u.scoreCause = null;
                const dx = boss.x - u.x,
                    dy = boss.y - u.y,
                    d = Math.hypot(dx, dy) || 1,
                    drive = specialDrive(this, u, dt),
                    k = 1 - Math.exp(-5 * dt),
                    contact = d <= boss.r + u.r + 1;
                u.vx += ((contact ? 0 : drive.vx) - u.vx) * k;
                u.vy += ((contact ? 0 : drive.vy) - u.vy) * k;
                if (u.kind === 'giant' && u.giantStage === 'warn') u.vx = u.vy = 0;
                u.angle *= Math.exp(-9 * dt);
            } else {
                u.vx *= Math.exp(-3 * dt);
                u.vy *= Math.exp(-3 * dt);
            }
            u.x += u.vx * dt;
            u.y += u.vy * dt;
            this.boundEnemy(u);
            const dx = u.x - boss.x,
                dy = u.y - boss.y,
                d = Math.hypot(dx, dy) || 1;
            u.attached = false;
            if (u.hp > 0 && u.z < 8 && u.stun <= 0 && d < boss.r + u.r + 3) {
                const blastPin = isRegularPinBlast(this, u);
                u.attached = !blastPin;
                if (
                    this.combatClock &&
                    u.meleePattern === 'elite' &&
                    u.giantStage === 'active' &&
                    u.giantAttack === 'charge' &&
                    !u.giantHit &&
                    d <= boss.r + u.r
                ) {
                    u.giantHit = true;
                    this.damageBoss(30, 'giant-charge', {
                        x: u.x,
                        y: u.y,
                        direction: Math.atan2(u.burstNy, u.burstNx),
                        strength: 1.25,
                    });
                }
                if (d < boss.r + u.r) {
                    u.x = boss.x + (dx / d) * (boss.r + u.r);
                    u.y = boss.y + (dy / d) * (boss.r + u.r);
                }
                if (u.kind === 'bomb' && !blastPin) ignite(u);
                if (!blastPin && u.attackClock <= 0) {
                    u.attackClock = 0.82;
                    const contactDamage =
                        u.kind === 'giant' ? (u.giantStage === 'active' ? 18 : 6) : 3;
                    if (!this.threatMode) this.damageBoss(contactDamage, 'contact');
                    this.fx('hit', u.x, u.y, 20, 9, '#ee987b');
                }
            }
        }
        if (this.threatMode) for (const u of this.enemies) this.stepThreat(u, dt);
        for (const b of this.balls)
            if (!b.ready && b.life > 0) for (const u of this.enemies) this.ballContact(b, u);
        for (let i = 0; i < this.enemies.length; i++)
            for (let j = i + 1; j < this.enemies.length; j++) {
                const a = this.enemies[i],
                    b = this.enemies[j];
                if (a.deadAge > 1 || b.deadAge > 1) continue;
                this.enemyContact(a, b);
            }
        for (const u of this.enemies) this.boundEnemy(u); // Contacts may separate a body into the rail; project again after all contacts.
        stepBombs(this, dt);
        this.enemies = this.enemies.filter(
            (u) => u.deadAge < 1.3 || (u.fuse !== null && !u.exploded),
        );
        for (const e of this.effects) e.age += dt;
        this.effects = this.effects.filter((e) => e.age < e.life).slice(-120);
        if (this.impactPairs.size > 800) this.impactPairs.clear();
        if (boss.hp <= 0) this.phase = 'lost';
        else if (this.time >= this.duration) this.phase = 'won';
    }
    step(dt = STEP_SECONDS) {
        if (!Number.isFinite(dt) || dt <= 0) return;
        let rest = Math.min(MAX_FRAME_SECONDS, dt);
        while (rest > 1e-8) {
            const h = Math.min(PHYSICS_STEP_SECONDS, rest);
            this.tick(h);
            rest -= h;
        }
    }
    snapshot() {
        return {
            floorBalls: this.balls
                .filter((b) => b.inWorld && !b.ready)
                .map((b) => ({
                    id: b.id,
                    x: b.x,
                    y: b.y,
                    life: b.life,
                    cooldown: b.cooldown,
                    armed: b.pickupArmed,
                })),
            lastPickup: this.lastPickup ? { ...this.lastPickup } : null,
            inWorld: this.balls.filter((b) => b.inWorld).length,
            dashCharges: this.dashCharges,
            dashCapacity: this.dashCapacity,
            dashRechargeRemaining: this.dashRechargeRemaining,
            dashRechargeProgress:
                this.dashCharges === this.dashCapacity
                    ? 0
                    : Math.max(0, Math.min(1, 1 - this.dashRechargeRemaining / 0.5)),
            reflectors: (this.arena.reflectors ?? []).map((rock) => ({
                x: rock.x,
                y: rock.y,
                active: reflectorIsActive(rock),
                returnAtMs: rock.lifecycle.returnAtMs,
            })),
            lastRockBounce: this.lastRockBounce ? { ...this.lastRockBounce } : null,
            lastWallBounce: this.lastWallBounce
                ? { ...this.lastWallBounce, sides: [...this.lastWallBounce.sides] }
                : null,
            dashStarts: this.dashStarts || 0,
            lastDash: this.lastDash ? { ...this.lastDash } : null,
            controlMode: this.controlMode,
            moveInput: { ...this.moveInput },
            dashRemaining: this.boss.dashRemaining || 0,
            dashCooldown: this.boss.dashCooldown || 0,
            hurtAge: this.boss.hurtAge ?? 99,
            lastDamage: this.boss.lastDamage || null,
            phase: this.phase,
            time: +this.time.toFixed(2),
            hp: this.boss.hp,
            alive: this.enemies.filter((u) => u.hp > 0).length,
            airborne: this.enemies.filter((u) => u.z > 0).length,
            attached: this.enemies.filter((u) => u.attached).length,
            ready: this.balls.filter((b) => b.ready).length,
            selectedType: this.selectedType,
            selectedSpin: this.selectedSpin,
            bracing: this.enemies.filter((u) => u.tactic === 'brace' && u.hp > 0).length,
            bowlerPhase: this.boss.delivery?.phase || (this.boss.aiming ? 'aim' : 'idle'),
            facing: +this.boss.facing.toFixed(3),
            bossX: this.boss.x,
            bossY: this.boss.y,
            moving: this.boss.moving,
            moveDistance: this.boss.moveDistance,
            hand: bowlerPose(this.boss).hand,
            release: this.lastRelease || null,
            duckRecoil: this.boss.recoil ? { ...this.boss.recoil } : null,
            lastBodyImpact: this.lastBodyImpact ? { ...this.lastBodyImpact } : null,
            lastBodyWall: this.lastBodyWall
                ? { ...this.lastBodyWall, sides: [...this.lastBodyWall.sides] }
                : null,
            ...this.stats,
        };
    }
}
