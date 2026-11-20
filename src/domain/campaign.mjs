import { STEP_SECONDS, PHYSICS_STEP_SECONDS, MAX_FRAME_SECONDS } from './timing.mjs';
import {
    DEFAULT_ROUTE,
    arenaForRoute,
    rackEntrance,
    routeDefinition,
    unlockedRoute,
} from './arena.mjs';
import { BowlingGame } from './sim.mjs';
import { advanceDashPose, DASH_POSE_SECONDS } from './bowler.mjs';
import { manualBounds } from './locomotion.mjs';
import { LARGE_PIN_FORMATION, pinSlots } from './pin-formation.mjs';
import {
    createExpedition,
    enterExpeditionRoom,
    openExpeditionGates,
    expeditionDuckBounds,
    crossedExpeditionGate,
    advanceExpeditionCamera,
    expeditionSnapshot,
} from './expedition.mjs';
import { BallBag } from './ball-bag.mjs';
import { startBallVault } from './ball-vault.mjs';
import {
    AUGMENTS,
    onDash,
    onRelease,
    onGroundPickup,
    onDirectHit,
    afterBattleStep,
} from './combos.mjs';
import { BowlingScore } from './scoring.mjs';
import { PIN_BLAST } from './pin-blast.mjs';
import { DUCK_COMBAT, combatClock, advanceCombatClock } from './combat-clock.mjs';
import { stepDuckRecoil } from './duck-recoil.mjs';
export { AUGMENTS };

export const STAGE_MIN_SECONDS = 38;
export const STAGE_MIN_KILLS = 10;
export const BATTLE_PACE = 1.3;
export const PRESSURE = Object.freeze({
    cap: 40,
    flankDelay: 1.5,
    restartDelay: 3.2,
    retry: 0.16,
    gapRadius: 185,
});
const PIN_APPROACH_SPEED = 43,
    PIN_APPROACH_SECONDS = 3.0;
export const STAGES = Object.freeze(
    [
        { title: '숲 입구', count: 7, kinds: ['grunt', 'grunt', 'grunt', 'bomb'] },
        { title: '방패 행렬', count: 8, kinds: ['grunt', 'shield', 'grunt', 'bomb'] },
        { title: '깃발 언덕', count: 9, kinds: ['grunt', 'flag', 'grunt', 'bomb'] },
        { title: '중간 보스 · 문지기', count: 7, kinds: ['grunt', 'bomb', 'shield'], boss: 'mid' },
        { title: '폭탄 회랑', count: 10, kinds: ['bomb', 'grunt', 'shield', 'grunt'] },
        { title: '지원 부대', count: 11, kinds: ['flag', 'grunt', 'shield', 'bomb', 'grunt'] },
        { title: '마지막 방어선', count: 12, kinds: ['shield', 'bomb', 'grunt', 'flag', 'grunt'] },
        {
            title: '최종 보스 · 거인',
            count: 10,
            kinds: ['grunt', 'shield', 'bomb', 'flag'],
            boss: 'final',
        },
    ].map((s) => Object.freeze({ ...s, kinds: Object.freeze(s.kinds) })),
);
const PIN_COUNT = 10;
const SPECIAL_SLOTS = Object.freeze({ hopper: 0, shooter: -2, lobber: -1 });
const AVAILABLE_SPECIALS = Object.freeze([
    [],
    ['hopper'],
    ['shooter', 'hopper'],
    ['hopper', 'shooter'],
    ['lobber', 'shooter', 'hopper'],
]);
function packetRoster(stage, packet, stageIndex) {
    const count = packet % 3 === 0 ? LARGE_PIN_FORMATION : PIN_COUNT;
    if (stage === STAGES[0] && packet === 0) return Array(count).fill('grunt');
    const roster = Array.from(
        { length: count },
        (_, i) => stage.kinds[(i + packet) % stage.kinds.length],
    );
    const specials = AVAILABLE_SPECIALS[Math.min(stageIndex, AVAILABLE_SPECIALS.length - 1)];
    if (specials.length) {
        const role = specials[packet % specials.length],
            slot = SPECIAL_SLOTS[role];
        roster[slot < 0 ? count + slot : slot] = role;
    }
    return roster;
}
export class CampaignGame extends BowlingGame {
    #ballBag;
    #airCatchByBall = new WeakMap();
    #needsBallType = true;
    constructor(
        seed = 42,
        {
            route = DEFAULT_ROUTE,
            unlocks = [],
            pace = BATTLE_PACE,
            shotSeed = seed,
            expedition = false,
            onEvent,
            bowler,
        } = {},
    ) {
        const ACTIVE_ROUTE = unlockedRoute(route, unlocks);
        super(seed, {
            autoWaves: false,
            duration: Infinity,
            arena: ACTIVE_ROUTE.arena,
            home: ACTIVE_ROUTE.home,
            onEvent,
            bowler,
        });
        this.duckBounds = manualBounds(this.arena);
        this.controlMode = 'manual';
        this.dashOnly = true;
        this.dashCapacity = this.dashCharges = 3;
        this.boss.dashOnly = true;
        this.threatMode = true;
        this.pinBlastMode = true;
        this.combatClock = combatClock();
        this.pinBlastStats = { total: 0, hit: 0, whiff: 0, blocked: 0 };
        this.enemyProjectiles = [];
        this.nextProjectileWarningAtMs = 0;
        this.enemyProjectileSerial = 0;
        this.enemyProjectileStats = {
            straight: { fired: 0, hit: 0, whiff: 0, blocked: 0, shattered: 0 },
            lob: { fired: 0, hit: 0, whiff: 0, blocked: 0 },
        };
        this.boss.hp = this.boss.maxHp = DUCK_COMBAT.maxHp;
        this.realTimeScale =
            1 / (Number.isFinite(pace) && pace >= 1 && pace <= 2 ? pace : BATTLE_PACE);
        this.elapsed = 0;
        this.endless = false;
        this.airCatches = 0;
        this.route = ACTIVE_ROUTE.id;
        this.expedition = expedition ? createExpedition(this.route, shotSeed) : null;
        if (this.expedition) this.arena = this.boss.arena = this.expedition.room.arena;
        this.stageIndex = 0;
        this.stageMin = STAGE_MIN_SECONDS;
        this.stageTime = 0;
        this.augments = [];
        this.choices = [];
        this.stageClears = 0;
        this.scoreFeedback = [];
        this.scoring = new BowlingScore(this.scoreFeedback);
        this.doubleArmed = false;
        this.vaultStarts = 0;
        this.secondRollStarts = 0;
        this.echoes = [];
        this.pendingEchoes = [];
        this.echoRolls = 0;
        this.dashHitIds = new Set();
        this.pinRacks = [];
        this.rackSerial = 0;
        this.#ballBag = new BallBag(
            shotSeed,
            Array.isArray(unlocks) && unlocks.includes('spinner'),
        );
        this.syncHand();
        this.startStage();
    }
    startStage() {
        for (const rack of this.pinRacks) rack.active = false;
        this.pinRacks.length = 0;
        this.stageTime = 0;
        this.phase = 'playing';
        this.choices = [];
        this.wave = 0;
        this.nextPacket = 0;
        this.stageTitle = this.expedition?.room.title ?? STAGES[this.stageIndex].title;
        this.stageSpawned = 0;
        this.stageBossId = null;
        this.stageBossDefeated = false;
        this.pinRack = null;
        this.stageStartKills = this.stats.kills;
        this.lastPacketElapsed = -Infinity;
        this.nextSpawnTry = 0;
        this.stageBossPending = STAGES[this.expedition?.room.stage ?? this.stageIndex].boss || null;
        // Surviving enemies and balls cross the intermission naturally; a full field cannot gain another rack.
        this.spawnStageBoss();
        this.spawnPacket();
    }
    step(dt = STEP_SECONDS) {
        if (!Number.isFinite(dt) || dt <= 0) return;
        // Keep the original collision substep; integrate more of them per active real second.
        let sim = Math.min(MAX_FRAME_SECONDS, dt) / this.realTimeScale;
        while (sim > 1e-8 && this.phase === 'playing') {
            const h = Math.min(PHYSICS_STEP_SECONDS, sim);
            this.tick(h);
            sim -= h;
        }
    }
    get defeatAnimating() {
        return this.phase === 'lost' && !!this.boss.recoil && !this.boss.recoil.landed;
    }
    stepDefeat(realDt) {
        if (!this.defeatAnimating || !Number.isFinite(realDt) || realDt <= 0) return;
        let sim = Math.min(MAX_FRAME_SECONDS, realDt) / this.realTimeScale;
        while (sim > 1e-8 && this.defeatAnimating) {
            const h = Math.min(PHYSICS_STEP_SECONDS, sim);
            advanceCombatClock(this.combatClock, h, this.realTimeScale);
            stepDuckRecoil(this, h);
            this.syncHand();
            sim -= h;
        }
    }
    canEnter(x, y, r = 13) {
        const a = this.arena;
        if (x - r < a.left || x + r > a.right || y - r < a.top || y + r > a.bottom) return false;
        if (
            Math.hypot(x - this.boss.x, y - this.boss.y) <
            Math.max(PRESSURE.gapRadius, this.boss.r + r + 22)
        )
            return false;
        return !this.enemies.some(
            (u) =>
                (u.hp > 0 || (u.kind === 'bomb' && u.fuse !== null && !u.exploded)) &&
                Math.hypot(x - u.x, y - u.y) < r + u.r + 6,
        );
    }
    spawn(x, y, kind) {
        const u = super.spawn(x, y, kind);
        if (this.expedition) {
            u.arena = this.arena;
            if (u.kind === 'shield') u.guardDropsOnRecovery = true;
        }
        return u;
    }
    spawnStageBoss() {
        const kind = this.stageBossPending;
        if (!kind || this.enemies.filter((u) => u.hp > 0).length >= PRESSURE.cap) return false;
        const r = kind === 'mid' ? 27 : 32;
        const { originX = 0, originY = 0 } = this.expedition?.room ?? {};
        for (const offset of [300, 205, 395, 105, 495]) {
            const x = offset + originX,
                y = 214 + originY;
            if (!this.canEnter(x, y, r)) continue;
            const giant = this.spawn(x, y, 'giant');
            if (kind === 'mid') {
                giant.hp = giant.maxHp = 280;
                giant.r = 27;
                giant.mass = 12;
            }
            giant.campaignBoss = kind;
            this.stageBossId = giant.id;
            this.stageSpawned++;
            this.stageBossPending = null;
            return true;
        }
        return false;
    }
    spawnPacket() {
        if (this.expedition && this.nextPacket >= this.expedition.packetTarget) return false;
        const stageIndex = this.expedition?.room.stage ?? this.stageIndex;
        const stage = STAGES[stageIndex],
            packet = this.nextPacket,
            kinds = packetRoster(stage, packet, stageIndex);
        const alive = this.enemies.reduce((n, u) => n + Number(u.hp > 0), 0);
        if (alive + kinds.length + Number(!!this.stageBossPending) > PRESSURE.cap) return false;
        const preferred = { ...rackEntrance(packet, this.route), travel: 0, age: 0, active: true };
        const variants = [preferred];
        if (preferred.lane === 'middle') {
            for (const [x, y] of [
                [200, 395],
                [400, 395],
                [300, 515],
                [160, 500],
                [440, 500],
                [300, 330],
                [60, 425],
                [540, 425],
            ])
                variants.push({ ...preferred, x, y });
        } else {
            const sign = Math.sign(preferred.nx);
            for (const [x, y] of [
                [preferred.x, preferred.y + 92],
                [preferred.x + sign * 99, preferred.y - 20],
                [preferred.x + sign * 100, preferred.y + 105],
                [preferred.x, preferred.y + 173],
                [preferred.x + sign * 153, preferred.y + 85],
            ])
                variants.push({ ...preferred, x, y });
            const mirror = {
                ...preferred,
                x: 2 * arenaForRoute(this.route).centerX - preferred.x,
                nx: -preferred.nx,
                lane: sign > 0 ? 'right' : 'left',
            };
            for (const y of [mirror.y, mirror.y + 105]) variants.push({ ...mirror, y });
            variants.push({ ...preferred, ...rackEntrance(0, this.route) });
        }
        const room = this.expedition?.room;
        if (room)
            for (const entry of variants) {
                entry.x += room.originX;
                entry.y += room.originY;
            }
        const rack = variants.find((candidate) =>
            pinSlots(kinds.length, candidate).every(({ x, y }) => this.canEnter(x, y)),
        );
        if (!rack) return false;
        const pins = pinSlots(kinds.length, rack);
        rack.id = ++this.rackSerial;
        rack.score = {
            size: kinds.length,
            serial: null,
            direct: false,
            tainted: false,
            down: 0,
            awarded: false,
        };
        this.pinRacks.push(rack);
        this.pinRack = rack;
        this.wave = ++this.nextPacket;
        this.lastPacketElapsed = this.elapsed;
        if (this.expedition) this.expedition.packetsSent = this.nextPacket;
        const { pinKinds: PIN_KINDS } = routeDefinition(this.route);
        for (let i = 0; i < kinds.length; i++) {
            const KIND = PIN_KINDS[kinds[i]] ?? kinds[i];
            const { x, y } = pins[i],
                unit = this.spawn(x, y, KIND);
            unit.pinSlot = { rack, x, y, speed: PIN_APPROACH_SPEED };
            unit.campaignStage = this.stageIndex + 1;
            this.stageSpawned++;
        }
        return true;
    }
    continueEndless() {
        if (this.phase !== 'won' || this.expedition) return false;
        this.endless = true;
        this.phase = 'playing';
        this.stageTime = 0;
        this.nextSpawnTry = 0;
        this.lastPacketElapsed = -Infinity;
        this.spawnPacket();
        return true;
    }
    syncHand() {
        if (
            #ballBag in this &&
            this.#needsBallType &&
            !this.boss.delivery &&
            this.balls.some((ball) => ball.ready)
        ) {
            this.selectedType = this.#ballBag.draw();
            this.selectedSpin = 0;
            this.#needsBallType = false;
        }
        super.syncHand();
    }
    setShotOptions({ type = this.selectedType, spin = this.selectedSpin } = {}) {
        return type === this.selectedType && super.setShotOptions({ spin });
    }
    get nextBallType() {
        return this.#needsBallType ||
            this.boss.delivery?.phase === 'follow' ||
            !this.balls.some((ball) => ball.ready)
            ? null
            : this.selectedType;
    }
    launch(id, vx, vy, spin) {
        const released = super.launch(id, vx, vy, spin);
        if (released) this.balls[id].scoreSerial = this.scoring.begin(this.time);
        return released;
    }
    scoreDamage(u, serial, flags) {
        this.scoring.damage(u, serial, flags);
    }
    dash() {
        const fired = super.dash();
        if (fired) onDash(this);
        return fired;
    }
    updateBowler(dt) {
        const shots = this.stats.shots,
            id = this.boss.delivery?.ballId;
        super.updateBowler(dt);
        if (this.stats.shots > shots) {
            this.#needsBallType = true;
            const ball = this.balls[id];
            if (this.expedition) ball.arena = this.arena;
            this.scoring.release(ball.scoreSerial);
            onRelease(this, ball);
        }
    }
    pickup(b) {
        const recovered = super.pickup(b);
        if (recovered) onGroundPickup(this, b);
        return recovered;
    }
    ballContact(b, u) {
        if (b.recalling) return;
        const unhit = !b.hitIds.has(u.id);
        const impact = super.ballContact(b, u);
        if (unhit && b.hitIds.has(u.id)) onDirectHit(this, b, u);
        startBallVault(this, b, u, impact);
    }
    onDescendingPinCatch(b, u, flight) {
        if (
            !this.augments.includes('air-catch') ||
            !b.inWorld ||
            b.ready ||
            b.held ||
            b.echo ||
            b.recalling ||
            b.vault ||
            (b.z ?? 0) > 1e-6 ||
            this.balls[b.id] !== b ||
            b.life <= 0 ||
            b.scoreSerial == null
        )
            return;
        if (!flight.airContact || flight.pinZ <= 0 || flight.pinVz >= 0) return;
        const speed = Math.hypot(flight.vx, flight.vy);
        if (speed < 85) return;
        let shot = this.#airCatchByBall.get(b);
        if (shot?.serial !== b.scoreSerial) {
            shot = { serial: b.scoreSerial, pins: new Set() };
            this.#airCatchByBall.set(b, shot);
        }
        if (shot.pins.has(u.id)) return;
        shot.pins.add(u.id);
        // Keep existing vertical contact/landing and scoring; only redirect the pin's horizontal momentum.
        const carry = Math.min(560, Math.max(240, speed * 0.72));
        u.vx = (flight.vx / speed) * carry;
        u.vy = (flight.vy / speed) * carry;
        this.airCatches++;
        this.fx('air-catch', u.x, u.y, flight.pinZ + u.r, u.r * 1.15, '#ffd9a3');
    }
    offerAugments() {
        const remaining = AUGMENTS.filter((a) => !this.augments.includes(a.id));
        for (let i = remaining.length - 1; i > 0; i--) {
            const j = Math.floor(this.random() * (i + 1));
            [remaining[i], remaining[j]] = [remaining[j], remaining[i]];
        }
        const featured =
            this.stageIndex === 0 ? remaining.findIndex((a) => a.id === 'dash-double') : -1;
        if (featured > 0) [remaining[0], remaining[featured]] = [remaining[featured], remaining[0]];
        this.choices = remaining.slice(0, 3);
        this.phase = 'choice';
        this.boss.aiming = false;
        this.boss.aimPower = 0;
    }
    chooseAugment(id) {
        if (
            this.phase !== 'choice' ||
            !this.choices.some((a) => a.id === id) ||
            this.augments.includes(id)
        )
            return false;
        this.augments.push(id);
        // Visible intermission recovery remains separate from all combo effects.
        this.lastRecovery = Math.min(
            this.boss.maxHp - this.boss.hp,
            this.boss.maxHp * DUCK_COMBAT.roomHealFraction,
        );
        this.boss.hp += this.lastRecovery;
        if (this.expedition) {
            this.phase = 'playing';
            this.choices = [];
            openExpeditionGates(this.expedition);
            return true;
        }
        this.stageIndex++;
        this.startStage();
        this.syncHand();
        return true;
    }
    tick(dt) {
        if (this.phase !== 'playing' || !Number.isFinite(dt) || dt <= 0) return;
        this.scoring.advance(dt, this.time);
        const realDt = dt * this.realTimeScale;
        this.stageTime += realDt;
        this.elapsed += realDt;
        if (this.expedition) this.duckBounds = expeditionDuckBounds(this.expedition, this.boss);
        for (const rack of this.pinRacks) {
            if (!rack.active) continue;
            rack.age += dt;
            if (
                rack.age >= PIN_APPROACH_SECONDS ||
                this.enemies.some(
                    (u) =>
                        u.pinSlot?.rack === rack &&
                        u.hp > 0 &&
                        Math.hypot(u.x - this.boss.x, u.y - this.boss.y) < 150,
                )
            )
                rack.active = false;
            else rack.travel += PIN_APPROACH_SPEED * dt;
        }
        this.pinRacks = this.pinRacks.filter((rack) => rack.active);
        const dashSegment = this.boss.dashRemaining > 0 ? { x: this.boss.x, y: this.boss.y } : null;
        advanceDashPose(this.boss, dt);
        super.tick(dt);
        if (this.phase === 'lost') return;
        afterBattleStep(this, dt, dashSegment);
        if (this.stageBossId && !this.enemies.some((e) => e.id === this.stageBossId && e.hp > 0))
            this.stageBossDefeated = true;
        if (this.expedition) {
            this.tickExpedition();
            advanceExpeditionCamera(this.expedition, this.boss, dt);
            return;
        }
        const bossRequired = Boolean(STAGES[this.stageIndex].boss);
        const bombResolving = this.enemies.some(
            (e) => e.kind === 'bomb' && Number.isFinite(e.fuse) && !e.exploded,
        );
        if (
            !this.endless &&
            this.stageTime + 1e-8 >= this.stageMin &&
            this.stats.kills - this.stageStartKills >= STAGE_MIN_KILLS &&
            (!bossRequired || this.stageBossDefeated) &&
            !this.boss.delivery &&
            !bombResolving
        ) {
            this.stageClears = this.stageIndex + 1;
            this.onEvent?.('clear');
            if (this.stageIndex === STAGES.length - 1) {
                this.phase = 'won';
                this.choices = [];
            } else this.offerAugments();
            return;
        }
        const alive = this.enemies.filter((u) => u.hp > 0).length;
        if (this.time + 1e-8 >= this.nextSpawnTry || alive === 0) {
            const since = this.elapsed - this.lastPacketElapsed,
                spacing = this.nextPacket % 3 === 0 ? PRESSURE.restartDelay : PRESSURE.flankDelay;
            if (this.stageBossPending) this.spawnStageBoss();
            if (alive === 0 || since + 1e-8 >= spacing) {
                if (!this.spawnPacket()) this.nextSpawnTry = this.time + PRESSURE.retry;
            }
        }
    }
    tickExpedition() {
        const e = this.expedition;
        if (e.phase === 'gates') {
            const gate = crossedExpeditionGate(e, this.boss);
            if (gate) {
                enterExpeditionRoom(e, gate);
                this.stageIndex = e.room.index;
                this.arena = this.boss.arena = e.room.arena;
                this.duckBounds = expeditionDuckBounds(e, this.boss);
                this.startStage();
            }
            return;
        }
        const alive = this.enemies.filter((u) => u.hp > 0).length;
        if (this.stageBossPending) this.spawnStageBoss();
        if (
            this.nextPacket < e.packetTarget &&
            (this.time + 1e-8 >= this.nextSpawnTry || alive === 0) &&
            (alive === 0 || this.elapsed - this.lastPacketElapsed + 1e-8 >= PRESSURE.flankDelay)
        ) {
            if (!this.spawnPacket()) this.nextSpawnTry = this.time + PRESSURE.retry;
        }
        if (
            this.nextPacket < e.packetTarget ||
            this.stageBossPending ||
            this.enemies.some(
                (u) => u.hp > 0 || (u.kind === 'bomb' && Number.isFinite(u.fuse) && !u.exploded),
            ) ||
            this.enemyProjectiles.length ||
            this.boss.delivery
        )
            return;
        this.stageClears = this.stageIndex + 1;
        this.onEvent?.('clear');
        if (this.stageClears === e.roomCount) {
            e.phase = 'won';
            this.phase = 'won';
        } else {
            e.phase = 'choice';
            this.offerAugments();
        }
    }
    snapshot() {
        return {
            ...super.snapshot(),
            mode: 'campaign',
            expedition: expeditionSnapshot(this.expedition),
            airCatches: this.airCatches,
            enemyProjectiles: this.enemyProjectiles.map(
                ({ id, kind, x, y, z, radius, targetX, targetY, blastRadius }) => ({
                    id,
                    kind,
                    x,
                    y,
                    z,
                    radius,
                    targetX,
                    targetY,
                    blastRadius,
                }),
            ),
            projectileWarnings: this.enemies.flatMap((u) =>
                u.projectileWarning ? [{ id: u.id, ...u.projectileWarning }] : [],
            ),
            projectileStats: {
                straight: { ...this.enemyProjectileStats.straight },
                lob: { ...this.enemyProjectileStats.lob },
            },
            arena: this.arena,
            nextBallType: this.nextBallType,
            route: this.route,
            stageIndex: this.stageIndex,
            stage: this.stageIndex + 1,
            stageTitle: this.stageTitle,
            stageTime: +this.stageTime.toFixed(2),
            stageMin: this.expedition ? 0 : this.stageMin,
            stageClears: this.stageClears,
            choices: this.choices.map((a) => ({ ...a })),
            augments: [...this.augments],
            stacks: Object.fromEntries(
                AUGMENTS.map((a) => [a.id, this.augments.filter((id) => id === a.id).length]),
            ),
            mods: { ...this.mods },
            stageBossId: this.stageBossId,
            stageBossDefeated: this.stageBossDefeated,
            stageBossPending: !!this.stageBossPending,
            endless: this.endless,
            elapsed: this.elapsed,
            comboBest: this.scoring.best,
            strikes: this.scoring.strikes,
            lastStrike: this.scoring.lastStrike,
            scoreFeedback: this.scoreFeedback.map((e) => ({ ...e })),
            pinBlasts: {
                ...this.pinBlastStats,
                warning: this.enemies.filter((u) => u.hp > 0 && u.pinBlast).length,
                recoiling: this.enemies.filter((u) => u.hp > 0 && u.attackStage === 'pin-recover')
                    .length,
            },
            pinWarnings: this.enemies
                .filter((u) => u.hp > 0 && u.pinBlast)
                .slice(0, PIN_BLAST.maxWarn)
                .map((u) => ({
                    id: u.id,
                    x: u.pinBlast.x,
                    y: u.pinBlast.y,
                    radius: u.pinBlast.radius,
                    timeMs: u.pinBlast.timeMs,
                })),
            dashOnly: this.dashOnly,
            dashPose: this.boss.dashPose ?? DASH_POSE_SECONDS,
            vaultStarts: this.vaultStarts,
            secondRollStarts: this.secondRollStarts,
            activeVaults: this.balls.flatMap((b) =>
                b.vault
                    ? [
                          {
                              ballId: b.id,
                              x: b.x,
                              y: b.y,
                              z: b.z,
                              pinId: b.vault.pinId,
                              kind: b.vault.kind,
                          },
                      ]
                    : [],
            ),
            echoRolls: this.echoRolls,
            doubleArmed: this.doubleArmed,
            augmentationStatus: this.doubleArmed
                ? '더블샷 준비 · 다음 투구'
                : this.augments.includes('dash-double')
                  ? '대시하면 더블샷 준비'
                  : '',
            stageKills: this.stats.kills - this.stageStartKills,
            stageKillTarget: this.expedition ? 0 : STAGE_MIN_KILLS,
            wavesSent: this.nextPacket,
            rackLanes: [
                ...new Map(
                    this.enemies
                        .filter((u) => u.hp > 0 && u.pinSlot)
                        .map((u) => {
                            const r = u.pinSlot.rack;
                            return [
                                r.id,
                                { id: r.id, lane: r.lane, size: r.score.size, down: r.score.down },
                            ];
                        }),
                ).values(),
            ],
            unitCap: PRESSURE.cap,
            lastRecovery: this.lastRecovery || 0,
        };
    }
}
