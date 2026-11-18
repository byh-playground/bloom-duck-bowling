// Physical vault uses the same horizontal hook, drag and rails as normal rolling.
const MIN_TRANSFER = 0.25;
export const PIN_LAUNCH_KICK = 75;
export const MEANINGFUL_BALL_IMPACT = 70; // Also determines normal impact damage/scoring.
export const ROLL_SETTLE_SPEED = 85;
const VAULT = { flightMs: 480, apex: 52, travel: 125 };
const SECOND = { flightMs: 240, apex: 13, travel: 50, quietMs: 230, resumeMs: 1000 };

function beginArc(g, b, { kind, pinId = null, vx, vy, flightMs, apex }) {
    const flight = flightMs / 1000,
        gravity = (8 * apex) / (flight * flight);
    b.vx = vx;
    b.vy = vy;
    b.vault = {
        kind: kind === 'ball-second-roll' ? 'second-roll' : kind,
        fx: kind,
        pinId,
        vz: gravity * flight * 0.5,
        gravity,
    };
    b.life = Math.max(b.life, flight * 2);
    g.fx(kind, b.x, b.y, b.z, b.r, '#f9e79e');
}

export function observeBallImpact(b, u, nx, ny, closing) {
    if (
        !b.vaultArmed ||
        b.vault ||
        b.held ||
        b.echo ||
        b.recalling ||
        u.z > 8 ||
        closing <= MEANINGFUL_BALL_IMPACT
    )
        return null;
    return { nx, ny, closing, pinVx: u.vx, pinVy: u.vy };
}
export function startBallVault(g, b, u, impact) {
    if (
        !impact ||
        !b.vaultArmed ||
        !b.inWorld ||
        b.ready ||
        b.life <= 0 ||
        g.balls[b.id] !== b ||
        u.hp <= 0 ||
        u.z > 8 ||
        u.vz > 0
    )
        return false;
    const { nx, ny, closing, pinVx, pinVy } = impact;
    const response = (u.vx - pinVx) * nx + (u.vy - pinVy) * ny;
    const forward = u.vx * nx + u.vy * ny;
    if (response >= closing * MIN_TRANSFER && forward >= PIN_LAUNCH_KICK) return false;
    // Deflect the still-live ball past the obstacle rather than teleporting it to a target.
    const speed = VAULT.travel / (VAULT.flightMs / 1000);
    b.vaultArmed = false;
    beginArc(g, b, { kind: 'ball-vault', pinId: u.id, vx: nx * speed, vy: ny * speed, ...VAULT });
    g.vaultStarts++;
    return true;
}

function updateHeading(state, b) {
    const speed = Math.hypot(b.vx, b.vy);
    if (speed > 1e-6) {
        state.nx = b.vx / speed;
        state.ny = b.vy / speed;
    }
}
export function armSecondRoll(g, b) {
    const state = b.secondRoll;
    if (
        !state ||
        b.ready ||
        !b.inWorld ||
        b.held ||
        b.echo ||
        b.recalling ||
        g.balls[b.id] !== b ||
        b.life <= 0
    )
        return;
    updateHeading(state, b);
    state.lastHit = g.time;
}

// Returns true only if this real shot must not enter the normal near-stop cooldown yet.
export function trySecondRoll(g, b) {
    const state = b.secondRoll;
    if (!state || state.lastHit === null || b.vault || b.recalling || b.life <= 0) return false;
    updateHeading(state, b);
    if (Math.hypot(b.vx, b.vy) >= ROLL_SETTLE_SPEED) return false;
    const quietLeftMs = SECOND.quietMs - (g.time - state.lastHit) * 1000;
    if (quietLeftMs > 1e-6) {
        // Only a confirmed near-stop may keep the physical ball alive through the quiet window.
        b.life = Math.max(b.life, (quietLeftMs + 20) / 1000);
        return true;
    }
    const speed = SECOND.travel / (SECOND.flightMs / 1000);
    b.secondRoll = null; // Consume before starting or hitting anything else.
    beginArc(g, b, {
        kind: 'ball-second-roll',
        vx: state.nx * speed,
        vy: state.ny * speed,
        ...SECOND,
    });
    b.life = SECOND.resumeMs / 1000;
    g.secondRollStarts++;
    return true;
}
export function stepBallVault(g, b, dt) {
    const hop = b.vault;
    if (!hop) return;
    b.z += hop.vz * dt - hop.gravity * dt * dt * 0.5;
    hop.vz -= hop.gravity * dt;
    if (b.z > 1e-8) return;
    b.vault = null;
    b.z = 0;
    g.fx(hop.fx + '-land', b.x, b.y, 0, b.r, '#f9e79e');
}
