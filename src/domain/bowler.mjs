import { clampRollPoint } from './dynamics.mjs';
// Shared world-space skeleton: the visible hand and physical ball use the same pose.
export const SWING_TIME = 0.22,
    FOLLOW_TIME = 0.28;
export const DASH_POSE_SECONDS = 330 / 1000;

export function advanceDashPose(bowler, dt) {
    if (Number.isFinite(bowler.dashPose))
        bowler.dashPose = Math.min(DASH_POSE_SECONDS, bowler.dashPose + dt);
}

const clamp = (v, a, b) => Math.max(a, Math.min(b, v)),
    mix = (a, b, t) => a + (b - a) * t;
// Recoil is supplied by the collision simulation; every limb and the ball share one roll basis.
export function bowlerRecoilPoint(b, p) {
    const recoil = b.recoil;
    if (!recoil || b.aiming || b.delivery) return p;
    const angle = recoil.roll || 0,
        axis = recoil.fromAngle || 0,
        nx = Math.cos(axis),
        ny = Math.sin(axis),
        cos = Math.cos(angle),
        sin = Math.sin(angle);
    const pivot = 57,
        tuck = 1 - 0.25 * Math.abs(Math.sin(angle / 2));
    const dx = p.x - b.x,
        dy = p.y - b.y,
        along = (dx * nx + dy * ny) * tuck,
        across = (-dx * ny + dy * nx) * tuck,
        up = (p.z - pivot) * tuck;
    const rolled = along * cos + up * sin;
    return {
        x: b.x + rolled * nx - across * ny,
        y: b.y + rolled * ny + across * nx,
        z: pivot + (recoil.z || 0) + up * cos - along * sin,
    };
}
export function bowlerPose(b) {
    const power = b.delivery?.power ?? b.aimPower ?? 0,
        d = b.delivery,
        phase = d?.phase || (b.aiming ? 'aim' : 'idle');
    const progress = d
        ? clamp(d.elapsed / (phase === 'swing' ? SWING_TIME : FOLLOW_TIME), 0, 1)
        : 0;
    const dashAge = b.dashPose ?? Infinity;
    const recoil = phase === 'idle' && b.recoil;
    const dash =
        !recoil &&
        phase === 'idle' &&
        dashAge >= 0 &&
        dashAge < DASH_POSE_SECONDS &&
        Math.hypot(b.dashX || 0, b.dashY || 0) > 0;
    const drive = dash
        ? dashAge < 0.045
            ? mix(0.58, 1, dashAge / 0.045)
            : dashAge < 0.15
              ? 1
              : ((DASH_POSE_SECONDS - dashAge) / 0.18) ** 2
        : 0;
    const face = dash ? Math.atan2(b.dashY, b.dashX) : (b.facing ?? -Math.PI / 2),
        dx = Math.cos(face),
        dy = Math.sin(face);
    let f = 12 - 100 * power,
        z = 68 + 30 * power,
        side = 48,
        lean = -power * 0.12;
    if (phase === 'swing') {
        const t = progress * progress * (3 - 2 * progress);
        f = mix(12 - 100 * power, 82, t);
        z = mix(68 + 30 * power, b.ballRadius || 23, t);
        side = mix(48, 40, t);
        lean = mix(-power * 0.12, 0.28, t);
    } else if (phase === 'follow') {
        f = mix(82, 50, progress);
        z = mix(b.ballRadius || 23, 100, Math.sin((progress * Math.PI) / 2));
        side = 40;
        lean = 0.28 * (1 - progress);
    }
    if (dash) {
        f = mix(f, 3, drive);
        z = mix(z, 54, drive);
        side = mix(side, 37, drive);
        lean = 0.8 * drive;
    }
    const p = (right, forward, height) =>
        bowlerRecoilPoint(b, {
            x: b.x + dx * forward - dy * right,
            y: b.y + dy * forward + dx * right,
            z: height,
        });
    const stride = b.moving && !dash && !recoil ? Math.sin(b.walkPhase || 0) * 11 : 0;
    const ballRadius = b.ballRadius || 23,
        h = p(side, f, z),
        hand = clampRollPoint(
            recoil ? { ...h, z: Math.max(ballRadius, h.z) } : h,
            ballRadius,
            b.arena,
        );
    return {
        face,
        power,
        lean,
        phase: recoil ? 'recoil' : dash ? 'dash' : phase,
        progress,
        drive,
        body: p(0, lean * 32, 52 - 19 * drive),
        shoulder: p(38 - 12 * drive, 19 * drive, 75 - 25 * drive),
        elbow: p(
            side + 12 - 8 * drive,
            f * 0.48 + 7 * drive,
            Math.max(36, (75 + z) * 0.5 - 18 * drive),
        ),
        hand,
        leadFoot: p(
            -24 + 7 * drive,
            12 +
                stride -
                19 * drive +
                (phase === 'swing' ? progress * 22 : phase === 'follow' ? 22 * (1 - progress) : 0),
            4 + 10 * drive,
        ),
        backFoot: p(24 - 6 * drive, -22 - stride - 15 * drive, 4 + 15 * drive),
    };
}
export function releasePoint(b) {
    const face = b.facing ?? -Math.PI / 2,
        dx = Math.cos(face),
        dy = Math.sin(face),
        x = b.homeX ?? b.x,
        y = b.homeY ?? b.y;
    return clampRollPoint(
        {
            x: x + dx * 82 - dy * 40,
            y: y + dy * 82 + dx * 40,
            z: b.ballRadius || 23,
            radius: b.ballRadius || 23,
        },
        b.ballRadius || 23,
        b.arena,
    );
}
