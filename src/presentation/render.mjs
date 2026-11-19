import { arenaForRoute, rackEntrance, routeDefinition } from '../domain/arena.mjs';
import { BALL_TYPES, predictRoll, prepareRoll, rollBounds } from '../domain/dynamics.mjs';
import { drawReflector, drawReflectorBreak } from './reflector.mjs';
import { reflectorIsActive } from '../domain/terrain.mjs';
import { shieldGuardUp } from '../domain/enemies.mjs';
import { bowlerPose, bowlerRecoilPoint, FOLLOW_TIME, releasePoint } from '../domain/bowler.mjs';
import { bowlerDefinition } from '../domain/bowlers.mjs';
// Original read-only 2.5D canvas renderer. No random draws or simulation mutation.
import { CAMERA, CAMERA_VIEW, project, cameraDepth, worldVectorToScreen } from './camera.mjs';
import {
    specialPinMark,
    pinThreatGround,
    enemyShotGround,
    enemyShot,
    lobImpact,
} from './pin-threat-render.mjs';
import { drawExpeditionLandscape, FOREST_SHADE, STORM_SHADE } from './expedition-landscape.mjs';
import { stormLandscape, stormFrontRail } from './storm-landscape.mjs';
export { project, unproject } from './camera.mjs';
const TAU = Math.PI * 2,
    clamp = (n, a, b) => Math.max(a, Math.min(b, n));
function ellipse(c, x, y, rx, ry, fill, stroke = null, width = 2) {
    c.beginPath();
    c.ellipse(x, y, rx, ry, 0, 0, TAU);
    c.fillStyle = fill;
    c.fill();
    if (stroke) {
        c.strokeStyle = stroke;
        c.lineWidth = width;
        c.stroke();
    }
}
function line(c, points, color, width = 2, dash = []) {
    c.beginPath();
    points.forEach((p, i) => (i ? c.lineTo(p.x, p.y) : c.moveTo(p.x, p.y)));
    c.strokeStyle = color;
    c.lineWidth = width;
    c.lineCap = 'round';
    c.lineJoin = 'round';
    c.setLineDash(dash);
    c.stroke();
    c.setLineDash([]);
}
const threatInk = { line, ellipse };
function label(c, text, x, y, size = 14, color = '#fff5cf') {
    c.font = '800 ' + size + 'px system-ui';
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    c.fillStyle = color;
    c.fillText(text, x, y);
}
function shadow(c, o, r) {
    const p = project(o.x, o.y);
    c.save();
    c.globalAlpha = 0.2 / (1 + (o.recoil?.z ?? o.z ?? 0) * 0.006);
    ellipse(c, p.x, p.y, r * CAMERA.scale, r * CAMERA.scale * Math.sin(CAMERA.pitch), '#284931');
    c.restore();
}
// Warning is drawn on the floor at the same radius the simulation checks.
function blastWarning(c, p, r, charge) {
    const rx = r * CAMERA.scale,
        ry = rx * Math.sin(CAMERA.pitch),
        t = clamp(charge || 0, 0, 1);
    c.save();
    c.globalAlpha = 0.07 + 0.11 * t;
    ellipse(c, p.x, p.y, rx, ry, '#edb476');
    c.globalAlpha = 0.62;
    c.beginPath();
    c.ellipse(p.x, p.y, rx, ry, 0, 0, TAU);
    c.strokeStyle = '#956747';
    c.lineWidth = 2;
    c.stroke();
    if (t > 0) {
        c.globalAlpha = 0.9;
        c.beginPath();
        c.ellipse(p.x, p.y, rx, ry, 0, -Math.PI / 2, -Math.PI / 2 + t * TAU);
        c.strokeStyle = '#ffe4a2';
        c.lineWidth = 3;
        c.stroke();
    }
    c.restore();
}
function blastPuff(c, e) {
    const t = clamp(e.age / e.life, 0, 1);
    if (t >= 1) return;
    const reach = e.size * (0.28 + 0.72 * Math.min(1, t * 2.35)),
        p = project(e.x, e.y, e.z || 0),
        rx = reach * CAMERA.scale,
        ry = rx * Math.sin(CAMERA.pitch);
    c.save();
    c.globalAlpha = (1 - t) * 0.84;
    c.beginPath();
    c.ellipse(p.x, p.y, rx, ry, 0, 0, TAU);
    c.strokeStyle = '#fff0bf';
    c.lineWidth = 3.5 - 2 * t;
    c.stroke();
    for (let i = 0; i < 5; i++) {
        const angle = (i * TAU) / 5 + 0.28,
            pos = project(
                e.x + Math.cos(angle) * reach * 0.81,
                e.y + Math.sin(angle) * reach * 0.81,
                (e.z || 0) + 5 + t * 16,
            ),
            r = 3.3 + 4 * t;
        c.globalAlpha = (1 - t) ** 2 * 0.76;
        ellipse(c, pos.x, pos.y, r, r * 0.67, i % 2 ? '#f9ddb0' : '#fff1d1', '#9d7a51', 1);
    }
    c.restore();
}
function enemyGround(c, e, boss) {
    const p = project(e.x, e.y),
        grounded = (e.z || 0) < 8;
    if (e.hp > 0) pinThreatGround(c, e.projectileWarning, threatInk);
    const blast = e.pinBlast;
    if (
        e.kind !== 'giant' &&
        e.hp > 0 &&
        grounded &&
        !(e.stun > 0) &&
        e.attackStage === 'pin-warn' &&
        Number.isFinite(blast?.radius) &&
        blast.radius > 0
    ) {
        blastWarning(
            c,
            project(blast.x, blast.y),
            blast.radius,
            1 - blast.timeMs / blast.durationMs,
        );
    }
    if (e.hp > 0 && grounded && !(e.stun > 0) && ['warn', 'recover'].includes(e.attackStage)) {
        const angle = Math.atan2(e.attackNy || 0, e.attackNx || 0),
            half = Math.acos(0.55),
            reach = (boss?.r || 56) + e.r + 26,
            points = [p];
        for (let i = 0; i <= 24; i++) {
            const a = angle - half + (2 * half * i) / 24;
            points.push(project(e.x + Math.cos(a) * reach, e.y + Math.sin(a) * reach));
        }
        points.push(p);
        const swinging = e.attackStage === 'recover' && (e.attackTimer || 0) > 0.68;
        if (e.attackStage === 'warn' || swinging) {
            c.save();
            c.globalAlpha = e.attackStage === 'warn' ? 0.08 + 0.08 * (e.attackTelegraph || 0) : 0.2;
            line(c, points, e.attackStage === 'warn' ? '#de995c' : '#f3c18a', 2);
            c.fillStyle = e.attackStage === 'warn' ? '#e5ac69' : '#fff0ac';
            c.fill();
            c.restore();
        }
        if (swinging) {
            const q = project(
                e.x + (e.attackNx || 0) * (e.r + 24),
                e.y + (e.attackNy || 0) * (e.r + 24),
                e.r,
            );
            line(c, [project(e.x, e.y, e.r), q], '#ffe3a6', 4);
        }
    }
    if (e.kind === 'flag' && e.hp > 0 && grounded && !(e.stun > 0)) {
        c.save();
        c.globalAlpha = 0.1;
        ellipse(
            c,
            p.x,
            p.y,
            (e.aura || 115) * CAMERA.scale,
            (e.aura || 115) * CAMERA.scale * Math.sin(CAMERA.pitch),
            '#d7caeb',
        );
        c.globalAlpha = 0.35;
        c.beginPath();
        c.ellipse(
            p.x,
            p.y,
            (e.aura || 115) * CAMERA.scale,
            (e.aura || 115) * CAMERA.scale * Math.sin(CAMERA.pitch),
            0,
            0,
            TAU,
        );
        c.strokeStyle = '#c5a8df';
        c.lineWidth = 1.5;
        c.setLineDash([3, 10]);
        c.stroke();
        c.setLineDash([]);
        c.restore();
    }
    if (e.kind === 'bomb' && Number.isFinite(e.fuse) && !e.exploded) {
        c.save();
        c.globalAlpha = 0.12 + 0.16 * (1 - clamp(e.fuse / 0.65, 0, 1));
        ellipse(
            c,
            p.x,
            p.y,
            105 * CAMERA.scale,
            105 * CAMERA.scale * Math.sin(CAMERA.pitch),
            '#f6a06a',
            '#f9c38c',
            2,
        );
        c.restore();
    }
    if (e.hp > 0 && shieldGuardUp(e)) {
        const points = [];
        for (let i = 0; i <= 20; i++) {
            const a = (e.facing || 0) - Math.PI / 3 + (i * Math.PI * 2) / 3 / 20;
            points.push(project(e.x + Math.cos(a) * (e.r + 7), e.y + Math.sin(a) * (e.r + 7)));
        }
        line(c, points, '#c7e6ed', 3);
    }
    if (e.kind === 'giant' && e.giantStage === 'warn') {
        c.save();
        c.globalAlpha = 0.3 + 0.35 * (e.telegraph || 0);
        if (e.giantAttack === 'sweep') {
            c.beginPath();
            c.ellipse(
                p.x,
                p.y,
                (e.r + 60) * CAMERA.scale,
                (e.r + 60) * CAMERA.scale * Math.sin(CAMERA.pitch),
                0,
                0,
                TAU,
            );
            c.strokeStyle = '#f7c27e';
            c.lineWidth = 3;
            c.stroke();
        } else {
            const q = project(
                e.x + (e.burstNx ?? Math.cos(e.facing || 0)) * 95,
                e.y + (e.burstNy ?? Math.sin(e.facing || 0)) * 95,
            );
            line(c, [p, q], '#f5c079', 7);
        }
        c.restore();
    }
}
const PIN_PALETTES = {
    grunt: { body: '#fff3d5', shadow: '#e9d6ac', stripe: '#b54143', rim: '#683f3c' },
    shield: { body: '#e5f1f3', shadow: '#a6c3cf', stripe: '#31738d', rim: '#365768' },
    flag: { body: '#f4e4f2', shadow: '#d5bbde', stripe: '#884895', rim: '#59455f' },
    bomb: { body: '#ffe3a9', shadow: '#dca56f', stripe: '#a84b31', rim: '#684638' },
    hopper: { body: '#e7f4bf', shadow: '#b3ce87', stripe: '#4e7960', rim: '#426750' },
    shooter: { body: '#dff7fb', shadow: '#a2c7d8', stripe: '#386288', rim: '#294957' },
    lobber: { body: '#ffe5c3', shadow: '#d9aa8b', stripe: '#965a69', rim: '#784c6e' },
    giant: { body: '#ddab81', shadow: '#b58365', stripe: '#743f4b', rim: '#5a413c' },
};
function pinShape(c, r) {
    c.beginPath();
    c.moveTo(-r * 0.65, r * 0.91);
    c.bezierCurveTo(-r * 1.12, r * 0.72, -r * 1.25, r * 0.17, -r * 1.05, -r * 0.41);
    c.bezierCurveTo(-r * 0.91, -r * 0.89, -r * 0.49, -r * 1.15, -r * 0.37, -r * 1.64);
    c.bezierCurveTo(-r * 0.31, -r * 1.93, -r * 0.63, -r * 2.02, -r * 0.58, -r * 2.39);
    c.bezierCurveTo(-r * 0.51, -r * 3.03, r * 0.51, -r * 3.03, r * 0.58, -r * 2.39);
    c.bezierCurveTo(r * 0.63, -r * 2.02, r * 0.31, -r * 1.93, r * 0.37, -r * 1.64);
    c.bezierCurveTo(r * 0.49, -r * 1.15, r * 0.91, -r * 0.89, r * 1.05, -r * 0.41);
    c.bezierCurveTo(r * 1.25, r * 0.17, r * 1.12, r * 0.72, r * 0.65, r * 0.91);
    c.quadraticCurveTo(0, r * 1.03, -r * 0.65, r * 0.91);
    c.closePath();
}
function pinBody(c, e) {
    const r = e.r,
        k = e.kind || 'grunt',
        p = PIN_PALETTES[k] || PIN_PALETTES.grunt;
    pinShape(c, r);
    c.fillStyle = e.flash > 0 ? '#fff9da' : p.body;
    c.fill();
    c.save();
    c.clip();
    ellipse(c, r * 0.51, r * 0.1, r * 0.7, r * 1.15, p.shadow);
    ellipse(c, r * 0.32, -r * 2.25, r * 0.38, r * 0.65, p.shadow);
    ellipse(c, -r * 0.43, -r * 0.37, r * 0.23, r * 0.55, '#fffaf3');
    for (const h of [1.32, 1.65]) {
        c.beginPath();
        c.moveTo(-r * 0.85, -r * h);
        c.quadraticCurveTo(0, r * (-h + 0.22), r * 0.85, -r * h);
        c.strokeStyle = p.stripe;
        c.lineWidth = Math.max(2.5, r * 0.21);
        c.stroke();
    }
    c.restore();
    pinShape(c, r);
    c.strokeStyle = p.rim;
    c.lineWidth = Math.max(1.8, r * 0.087);
    c.stroke();
    // Tiny eyes sit on the head; the red double stripe still reads clearly at small sizes.
    for (const x of [-0.19, 0.19])
        ellipse(
            c,
            r * x,
            -r * 2.25,
            Math.max(0.92, r * 0.075),
            Math.max(1.2, r * 0.105),
            '#423d35',
        );
    specialPinMark(c, k, r, threatInk);
    if (k === 'bomb') {
        line(
            c,
            [
                { x: r * 0.08, y: -r * 2.77 },
                { x: r * 0.35, y: -r * 3.12 },
                { x: r * 0.6, y: -r * 3.16 },
            ],
            '#684638',
            2.4,
        );
        ellipse(
            c,
            r * 0.63,
            -r * 3.17,
            Number.isFinite(e.fuse) ? 4 : 2.6,
            Number.isFinite(e.fuse) ? 4 : 2.6,
            Number.isFinite(e.fuse) ? '#fff4a4' : '#d17949',
        );
    }
    if (k === 'flag') {
        const x = -r * 0.87,
            y = -r * 2.97;
        line(
            c,
            [
                { x, y: r * 0.63 },
                { x, y },
            ],
            '#675179',
            2.7,
        );
        c.beginPath();
        c.moveTo(x, y);
        c.lineTo(x - r * 1.16, y + r * 0.18);
        c.lineTo(x - r * 0.78, y + r * 0.46);
        c.lineTo(x - r * 1.16, y + r * 0.75);
        c.lineTo(x, y + r * 0.63);
        c.closePath();
        c.fillStyle = '#d490df';
        c.fill();
        c.strokeStyle = '#774381';
        c.lineWidth = 1.5;
        c.stroke();
    }
    if (k === 'shield') {
        const x = r * 0.68,
            y = r * 0.15,
            dropped = e.guardDropsOnRecovery && e.attackStage === 'pin-recover';
        ellipse(
            c,
            x,
            y,
            r * 0.44,
            r * 0.62,
            dropped ? '#9e9e87' : '#829eb0',
            dropped ? '#656d5e' : '#396076',
            2,
        );
        ellipse(c, x - r * 0.08, y - r * 0.11, r * 0.16, r * 0.23, dropped ? '#c6c5a7' : '#c9e4ec');
    }
    if (k === 'giant') {
        for (const side of [-1, 1])
            ellipse(c, side * r * 0.81, r * 0.12, r * 0.3, r * 0.41, '#9e7370', '#684b4d', 2.6);
        line(
            c,
            [
                { x: -r * 0.49, y: -r * 2.46 },
                { x: -r * 0.31, y: -r * 2.96 },
                { x: 0, y: -r * 2.71 },
                { x: r * 0.3, y: -r * 2.96 },
                { x: r * 0.49, y: -r * 2.46 },
            ],
            '#714c4a',
            5,
        );
        if (e.campaignBoss === 'final') {
            if (e.armored) {
                ellipse(c, 0, r * 0.12, r * 0.62, r * 0.48, '#78909b', '#d4e1d6', 3);
                line(
                    c,
                    [
                        { x: -r * 0.35, y: r * 0.12 },
                        { x: r * 0.35, y: r * 0.12 },
                    ],
                    '#b8cccd',
                    3,
                );
            } else {
                ellipse(c, 0, r * 0.12, r * 0.4, r * 0.35, '#f3d083', '#fff4bc', 3);
                ellipse(c, 0, r * 0.12, r * 0.17, r * 0.15, '#fff4c7');
            }
        }
    }
}
const drawEnemy = (e) =>
    e.hp > 0 ||
    (e.z || 0) > 0 ||
    ((e.deadAge || 0) < 0.42 && Number.isFinite(e.deadAge)) ||
    (e.kind === 'bomb' && Number.isFinite(e.fuse) && !e.exploded);
function enemy(c, e, team) {
    const ground = project(e.x, e.y),
        r = e.r,
        z = e.z || 0,
        p = project(e.x, e.y, z + r),
        live = e.hp > 0;
    if (live && e.tactic === 'brace') {
        c.save();
        c.globalAlpha = 0.35 + 0.5 * clamp(e.telegraph || 0, 0, 1);
        c.beginPath();
        c.ellipse(
            ground.x,
            ground.y,
            (r + 7) * CAMERA.scale,
            (r + 7) * CAMERA.scale * Math.sin(CAMERA.pitch),
            0,
            0,
            TAU,
        );
        c.strokeStyle = '#f7d381';
        c.lineWidth = 2.5;
        c.stroke();
        c.restore();
    }
    if (live && e.tactic === 'burst' && z < 2) {
        const speed = Math.hypot(e.vx || 0, e.vy || 0) || 1;
        line(
            c,
            [project(e.x - ((e.vx || 0) / speed) * 18, e.y - ((e.vy || 0) / speed) * 18), ground],
            '#f6d28a99',
            3,
        );
    }
    if (z > 10) {
        c.save();
        c.globalAlpha = 0.22;
        line(c, [ground, p], '#fff2d0', 1, [2, 5]);
        c.restore();
    }
    const armed = e.kind === 'bomb' && Number.isFinite(e.fuse) && !e.exploded;
    const resting = !live && z < 1 && !armed,
        restAlpha = resting ? clamp(1 - (e.deadAge || 0) / 0.42, 0, 1) : 1;
    const angle = resting
        ? Math.sign(e.spin || e.angle || (e.id % 2) * 2 - 1) * 1.46
        : e.angle || 0;
    c.save();
    c.globalAlpha = restAlpha;
    c.translate(p.x, p.y);
    c.scale(CAMERA.scale, CAMERA.scale);
    c.rotate(angle);
    pinBody(c, e);
    if (team && live) {
        const band = [
            { x: -r * 0.67, y: r * 0.55 },
            { x: 0, y: r * 0.72 },
            { x: r * 0.67, y: r * 0.55 },
        ];
        line(c, band, team.ink, 4.1);
        line(c, band, team.light, 1.65);
    }
    if (live && e.supported) ellipse(c, 0, r + 4, 3.2, 2, '#dfc4ee');
    c.restore();
    const head = project(e.x, e.y, z + r * 4);
    if (live && (e.attached || e.tactic === 'brace' || e.giantStage === 'warn'))
        label(c, '!', head.x, head.y, e.kind === 'giant' ? 22 : 15, '#fff1b6');
    if (
        live &&
        (e.kind === 'shield' || e.armored) &&
        !(e.guardDropsOnRecovery && e.attackStage === 'pin-recover')
    ) {
        const points = [];
        for (let i = 0; i <= 12; i++) {
            const a = (e.facing || 0) - Math.PI / 3 + (i * Math.PI * 2) / 3 / 12;
            points.push(
                project(e.x + Math.cos(a) * (r + 2), e.y + Math.sin(a) * (r + 2), z + r * 0.7),
            );
        }
        line(c, points, '#425d68', 8);
        line(c, points, e.stun > 0 ? '#8c9d9b' : '#bbd9e1', 4);
    }
    if (live && e.hp < e.maxHp) {
        line(
            c,
            [
                { x: head.x - r, y: head.y - 6 },
                { x: head.x + r, y: head.y - 6 },
            ],
            '#3b5945',
            3,
        );
        line(
            c,
            [
                { x: head.x - r, y: head.y - 6 },
                { x: head.x - r + 2 * r * clamp(e.hp / e.maxHp, 0, 1), y: head.y - 6 },
            ],
            '#efd08b',
            2,
        );
    }
}
function orb(c, { x, y, z }, rx, ry, rz, part, surface, tilt, hit) {
    const p = project(x, y, z),
        w = rx * CAMERA.scale,
        h = Math.hypot(ry * Math.sin(CAMERA.pitch), rz * Math.cos(CAMERA.pitch)) * CAMERA.scale;
    if (tilt) {
        c.save();
        c.translate(p.x, p.y);
        c.rotate(tilt);
        p.x = 0;
        p.y = 0;
    }
    ellipse(c, p.x, p.y, w, h, part.shade, surface.outline, 2);
    const fill = hit ? (part.hit ?? part.fill) : part.fill;
    ellipse(c, p.x - w * 0.12, p.y - h * 0.14, w * 0.88, h * 0.84, fill);
    ellipse(c, p.x - w * 0.33, p.y - h * 0.48, w * 0.28, h * 0.13, surface.highlight);
    if (tilt) c.restore();
}
function boss(c, b, held = null, team) {
    const { palette, radius, draw } = bowlerDefinition(b.bowlerId);
    const pose = bowlerPose(b),
        face = pose.face,
        dx = Math.cos(face),
        dy = Math.sin(face),
        q = (v) => project(v.x, v.y, v.z),
        body = pose.body;
    const drive = pose.drive || 0,
        roll = (v) => bowlerRecoilPoint(b, v);
    const point = (side, forward, z) =>
        roll({
            x: b.x + dx * (forward + drive * z * 0.25) - dy * side,
            y: b.y + dy * (forward + drive * z * 0.25) + dx * side,
            z: z * (1 - drive * 0.28),
        });
    const flashing = b.flash > 0;
    if (draw) {
        c.save();
        try {
            draw({
                context: c,
                pose,
                palette,
                project: q,
                point,
                radius,
                flashing,
                drawHeldBall: held ? () => ball(c, held, team) : null,
            });
        } finally {
            c.restore();
        }
        return;
    }

    let tilt = 0;
    if (pose.phase === 'recoil') {
        const bottom = q(point(0, 0, 0)),
            top = q(point(0, 0, 114));
        tilt = Math.atan2(top.x - bottom.x, bottom.y - top.y);
    }
    const head = point(0, 12 + pose.lean * 12, 111),
        beak = point(0, 41 + pose.lean * 12, 106),
        other = point(-46, -8, 54),
        parts = [];
    const bodyShell = pose.phase === 'recoil' ? point(0, 0, 58) : { ...body, z: body.z + 6 };
    const add = (o, draw) => parts.push({ depth: cameraDepth(o.x, o.y, o.z), draw });
    const paintOrb = (o, width, depth, height, colors) =>
        orb(c, o, width, depth, height, colors, palette.surface, tilt, flashing);
    for (const foot of [pose.backFoot, pose.leadFoot])
        add(foot, () => paintOrb(foot, 19, 27, 7, palette.feet));
    add(other, () => {
        const p = q(other),
            a = q(body);
        line(c, [a, p], palette.farArm.outline, 22);
        line(c, [a, p], palette.farArm.fill, 16);
    });
    add(bodyShell, () =>
        paintOrb(bodyShell, 55 + 5 * drive, 46 + 8 * drive, 62 - 15 * drive, palette.body),
    );
    const belly = point(0, 31, 58);
    add(belly, () => paintOrb(belly, 40, 18 + 4 * drive, 44 - 10 * drive, palette.belly));
    add(head, () => {
        paintOrb(head, 32, 31, 34 - 6 * drive, palette.head);
        for (const side of [-1, 1]) {
            if (-dx * Math.sin(CAMERA.yaw) + dy * Math.cos(CAMERA.yaw) < -0.15) continue;
            const e = point(side * 14, 35 + pose.lean * 12, 120),
                p = q(e);
            ellipse(c, p.x, p.y, 3.2, 5, palette.eyes.pupil);
            ellipse(c, p.x - 1, p.y - 2, 1, 1.5, palette.eyes.shine);
        }
        const crown = [point(-16, 8, 141), point(0, 4, 153), point(16, 8, 142)].map(q);
        line(c, crown, palette.crown.fill, 7);
    });
    add(beak, () => paintOrb(beak, 20, 19, 8, palette.beak));
    const arm = [q(pose.shoulder), q(pose.elbow), q(pose.hand)];
    add(pose.elbow, () => {
        line(c, arm, palette.throwArm.outline, 21);
        line(c, arm, palette.throwArm.fill, 15);
        const e = q(pose.elbow);
        ellipse(c, e.x, e.y, 8, 8, palette.throwArm.elbow);
    });
    add(pose.hand, () => {
        const h = q(pose.hand);
        ellipse(c, h.x, h.y, 11, 9, palette.hand.fill, palette.hand.outline, 1.5);
    });
    if (held) add({ x: held.x, y: held.y, z: (held.z || 0) + held.r }, () => ball(c, held, team));
    parts.sort((a, b) => a.depth - b.depth);
    for (const p of parts) p.draw();
}

export function renderHomeDuck(c) {
    const duck = {
        ...CAMERA.worldCenter,
        facing: -0.16,
        delivery: { phase: 'follow', elapsed: FOLLOW_TIME * 0.3 },
    };
    const release = releasePoint(duck);
    const rolling = {
        x: release.x + Math.cos(duck.facing) * 28,
        y: release.y + Math.sin(duck.facing) * 28,
        r: release.radius,
    };
    const ground = project(duck.x, duck.y);
    c.save();
    c.translate(277, 263);
    c.scale(1.5, 1.5);
    c.translate(-ground.x, -ground.y);
    shadow(c, duck, 55);
    shadow(c, rolling, rolling.r * 0.9);
    boss(c, duck);
    ball(c, rolling);
    c.restore();
}

// The vault shadow tracks the moving ball, not an unverified landing target.
function ballVaultShadow(c, b) {
    const floor = project(b.x, b.y),
        bottom = project(b.x, b.y, b.z),
        r = b.r * CAMERA.scale;
    c.save();
    c.globalAlpha = 0.34;
    ellipse(c, floor.x, floor.y, r * 0.92, r * 0.92 * Math.sin(CAMERA.pitch), '#3b3459');
    if (b.z > 8) {
        c.globalAlpha = 0.53;
        line(c, [floor, bottom], '#51476a', 2.8, [2, 5]);
        line(c, [floor, bottom], '#e3d8ff', 1.25, [2, 5]);
    }
    c.restore();
}
function ballVaultFx(c, e) {
    const t = clamp(e.age / e.life, 0, 1),
        at = project(e.x, e.y, e.z || 0),
        size = (e.size || 20) * CAMERA.scale;
    if (t >= 1) return;
    c.save();
    if (e.kind === 'ball-vault') {
        c.globalAlpha = (1 - t) * 0.85;
        for (const side of [-1, 1]) {
            const x = at.x + side * size * (0.39 + t * 0.52),
                y = at.y - t * 11;
            const streak = [
                { x: x + side * 4, y: y + 3 },
                { x, y: y - 3 - size * 0.68 },
                { x: x - side * 4, y: y - 1 - size },
            ];
            line(c, streak, '#534567', 3);
            line(c, streak, '#ebddff', 1.75);
        }
    } else {
        const radius = size * (0.65 + t * 0.45);
        c.globalAlpha = (1 - t) * 0.74;
        c.beginPath();
        c.ellipse(at.x, at.y, radius, radius * Math.sin(CAMERA.pitch), 0, 0, TAU);
        c.strokeStyle = '#534567';
        c.lineWidth = 3;
        c.stroke();
        c.strokeStyle = '#ebddff';
        c.lineWidth = 1.75;
        c.stroke();
    }
    c.restore();
}
function secondRollPuff(c, e) {
    const t = clamp(e.age / 0.24, 0, 1),
        p = project(e.x, e.y),
        r = (e.size || 20) * CAMERA.scale * (0.55 + t * 0.74);
    if (t >= 1) return;
    c.save();
    c.globalAlpha = (1 - t) * 0.67;
    c.beginPath();
    c.ellipse(p.x, p.y, r, r * Math.sin(CAMERA.pitch), 0, 0, TAU);
    c.strokeStyle = '#735c45';
    c.lineWidth = 3;
    c.stroke();
    c.strokeStyle = '#ffe2a0';
    c.lineWidth = 1.8;
    c.stroke();
    c.restore();
}
// Short collision marks and a live inward field, all centered on actual simulation events.
function magnetGround(c, magnet, time) {
    const { x, y, radius, remainingMs, durationMs } = magnet;
    const fade = clamp(remainingMs / durationMs, 0, 1);
    if (!fade) return;
    const p = project(x, y);
    const rx = radius * CAMERA.scale;
    const ry = rx * Math.sin(CAMERA.pitch);
    c.save();
    c.globalAlpha = fade * 0.12;
    ellipse(c, p.x, p.y, rx, ry, '#7352a5');
    c.globalAlpha = fade * 0.8;
    c.beginPath();
    c.ellipse(p.x, p.y, rx, ry, 0, 0, TAU);
    c.strokeStyle = '#6a4a92';
    c.lineWidth = 2.2;
    c.setLineDash([5, 6]);
    c.stroke();
    c.setLineDash([]);
    const wave = 0.77 - ((time * 1.55) % 1) * 0.29;
    for (let i = 0; i < 4; i++) {
        const angle = (i * TAU) / 4 + TAU / 8;
        const at = (distance, angleOffset = 0) =>
            project(
                x + Math.cos(angle + angleOffset) * radius * distance,
                y + Math.sin(angle + angleOffset) * radius * distance,
            );
        const points = [at(wave + 0.09, -0.075), at(wave), at(wave + 0.09, 0.075)];
        line(c, points, '#6a4a92', 3.5);
        line(c, points, '#f1e1ff', 1.65);
    }
    c.restore();
}

const AUGMENT_CONTACT_INK = {
    'ball-carom': { edge: '#6b523b', core: '#fff0aa', rays: 4, life: 0.22 },
    'straight-shatter': { edge: '#366884', core: '#e1fbff', rays: 5, life: 0.25 },
    'air-catch': { edge: '#9b5335', core: '#ffdcab', rays: 3, life: 0.26 },
};
function augmentContact(c, e, style) {
    const t = clamp(e.age / style.life, 0, 1);
    if (t >= 1) return;
    const p = project(e.x, e.y, e.z || 0);
    const size = clamp((e.size || 20) * CAMERA.scale, 9, 26);
    c.save();
    c.globalAlpha = 1 - t;
    for (let i = 0; i < style.rays; i++) {
        const angle = (i * TAU) / style.rays + 0.25;
        const dx = Math.cos(angle);
        const dy = Math.sin(angle) * 0.81;
        const reach = size * (0.32 + t * 0.91);
        const start = { x: p.x + dx * reach * 0.59, y: p.y + dy * reach * 0.59 };
        const end = { x: p.x + dx * reach, y: p.y + dy * reach };
        line(c, [start, end], style.edge, 4);
        line(c, [start, end], style.core, 2);
    }
    if (t < 0.4) ellipse(c, p.x, p.y, size * 0.26 * (1 - t), size * 0.22 * (1 - t), style.core);
    c.restore();
}
function ball(c, b, team) {
    const r = b.r,
        p = project(b.x, b.y, (b.z || 0) + r),
        type = b.type || 'basic',
        base =
            type === 'heavy'
                ? '#8d9aa6'
                : type === 'rubber'
                  ? '#9edac1'
                  : type === 'spinner'
                    ? '#c8a8df'
                    : '#e6c583',
        stripe =
            type === 'heavy'
                ? '#526779'
                : type === 'rubber'
                  ? '#4d9c89'
                  : type === 'spinner'
                    ? '#8861aa'
                    : '#82976a',
        sr = r * CAMERA.scale;
    c.save();
    if (b.echo) c.globalAlpha = 0.67;
    c.translate(p.x, p.y);
    ellipse(c, 0, 0, sr, sr, base, team?.ink ?? (b.echo ? '#fff0aa' : '#344f40'), team ? 3.4 : 2.5);
    c.save();
    c.beginPath();
    c.arc(0, 0, sr - 1, 0, TAU);
    c.clip();
    ellipse(
        c,
        sr * 0.45,
        sr * 0.66,
        sr,
        sr * 0.75,
        type === 'heavy'
            ? '#687b8b'
            : type === 'rubber'
              ? '#70b4a1'
              : type === 'spinner'
                ? '#927baa'
                : '#b99958',
    );
    ellipse(c, -sr * 0.28, -sr * 0.37, sr * 0.37, sr * 0.18, '#fff5d888');
    // Rotate surface points about the real horizontal rolling axis, not the shaded disc.
    const speed = Math.hypot(b.vx || 0, b.vy || 0),
        nx = speed ? (b.vx || 0) / speed : 0,
        ny = speed ? (b.vy || 0) / speed : -1,
        axis = { x: -ny, y: nx },
        a = b.angle || 0,
        ca = Math.cos(a),
        sa = Math.sin(a);
    const rotate = (x, y, z) => {
        const dot = axis.x * x + axis.y * y;
        return {
            x: x * ca + axis.y * z * sa + axis.x * dot * (1 - ca),
            y: y * ca - axis.x * z * sa + axis.y * dot * (1 - ca),
            z: z * ca + (axis.x * y - axis.y * x) * sa,
        };
    };
    let segment = [];
    for (let i = 0; i <= 64; i++) {
        const t = (i * TAU) / 64,
            v = rotate(Math.cos(t) * r, 0, Math.sin(t) * r),
            visible = cameraDepth(CAMERA.worldCenter.x + v.x, CAMERA.worldCenter.y + v.y, v.z) > 0,
            q = project(b.x + v.x, b.y + v.y, (b.z || 0) + r + v.z);
        if (visible) segment.push({ x: q.x - p.x, y: q.y - p.y });
        else if (segment.length) {
            if (segment.length > 1) line(c, segment, stripe, type === 'heavy' ? 4 : 3);
            segment = [];
        }
    }
    if (segment.length > 1) line(c, segment, stripe, 3);
    for (const [x, z] of [
        [0, r * 0.72],
        [-r * 0.28, r * 0.58],
        [r * 0.28, r * 0.58],
    ]) {
        const y = -Math.sqrt(Math.max(0, r * r - x * x - z * z)),
            v = rotate(x, y, z);
        if (cameraDepth(CAMERA.worldCenter.x + v.x, CAMERA.worldCenter.y + v.y, v.z) > 0) {
            const q = project(b.x + v.x, b.y + v.y, (b.z || 0) + r + v.z);
            ellipse(c, q.x - p.x, q.y - p.y, 2.3, 2.7, '#3c5542');
        }
    }
    c.restore();
    c.restore();
}
function polygon(c, points, fill, stroke = null, width = 1) {
    line(c, [...points, points[0]], stroke || fill, width);
    c.fillStyle = fill;
    c.fill();
    if (stroke) {
        c.strokeStyle = stroke;
        c.stroke();
    }
}
function drawIngress(c, route) {
    // Inlaid chevrons mark ingress without adding walls or suggesting that any lane is safe.
    const entranceInlay = (x, y, nx, ny, color) => {
        const mark = (forward, side) =>
            project(x + nx * forward + ny * side, y + ny * forward - nx * side, 0.5);
        for (const offset of [0, 20])
            polygon(
                c,
                [
                    mark(offset, -20),
                    mark(offset + 12, 0),
                    mark(offset, 20),
                    mark(offset + 3, 20),
                    mark(offset + 16, 0),
                    mark(offset + 3, -20),
                ],
                color,
            );
    };
    for (const [packet, color] of [
        [0, '#f7e5ae92'],
        [1, '#d9e9b288'],
        [2, '#bde2c788'],
    ]) {
        const { x, y, nx, ny } = rackEntrance(packet, route),
            rewind = packet === 0 ? 163 : 135;
        entranceInlay(x - nx * rewind, y - ny * rewind, nx, ny, color);
    }
}
function field(c, route, arena, time, duel) {
    if (routeDefinition(route).landscape === 'storm') {
        stormLandscape(c, arena, time, {
            polygon,
            line,
            ellipse,
            ingress: () => drawIngress(c, route),
        });
        return;
    }
    c.fillStyle = '#d8e2c9';
    c.fillRect(0, 0, CAMERA.width, CAMERA.height);
    // Compress the woods into a shallow background frieze so the extended lane uses the height.
    for (let i = 0; i < 14; i++) {
        const x = i * 51 - 12,
            h = 27 + ((i * 37) % 45);
        line(
            c,
            [
                { x, y: 123 },
                { x: x + 4, y: 52 - h * 0.3 },
            ],
            '#aabc98',
            8,
        );
        ellipse(c, x, 63 - h * 0.3, 35, h, '#bdcdb0');
        ellipse(c, x - 13, 71 - h * 0.23, 23, h * 0.64, '#c8d5b8');
    }
    const { left: L, right: R, top: T, bottom: B } = arena;
    const corner = [
            [L, T],
            [R, T],
            [R, B],
            [L, B],
        ],
        top = corner.map(([x, y]) => project(x, y)),
        bottom = corner.map(([x, y]) => project(x, y, -30));
    polygon(c, [top[1], top[2], bottom[2], bottom[1]], '#658257', '#476546');
    polygon(c, [top[2], top[3], bottom[3], bottom[2]], '#536e49', '#3f5c3f');
    polygon(c, top, '#9eb77d', '#59794f', 3);
    for (let j = 0; T + j * 110 < B; j++) {
        const y = T + j * 110;
        polygon(
            c,
            [
                project(L, y),
                project(R, y),
                project(R, Math.min(B, y + 55)),
                project(L, Math.min(B, y + 55)),
            ],
            j % 2 ? '#a5bd85' : '#a1ba81',
        );
    }
    const returnY = B - 112;
    polygon(c, [project(L, returnY), project(R, returnY), project(R, B), project(L, B)], '#95ad78');
    line(c, [project(L + 12, returnY), project(R - 12, returnY)], '#e5e6b4aa', 1.7, [4, 9]);
    for (let x = L + 100; x < R; x += 100)
        line(c, [project(x, T), project(x, B)], '#d8dfb433', 1, [4, 14]);
    for (let y = 100; y < B; y += 110)
        line(c, [project(L, y), project(R, y)], '#6d8e5433', 1, [4, 14]);
    if (!duel) drawIngress(c, route);
    // Raised back wall and cutaway side rails share the actual collision boundaries.
    const wall = (a, b, h, color) => {
        polygon(
            c,
            [project(...a), project(...b), project(b[0], b[1], h), project(a[0], a[1], h)],
            color,
            '#55764a',
            1.5,
        );
        line(c, [project(a[0], a[1], h), project(b[0], b[1], h)], '#e5e4b9', 5);
    };
    wall([L, T], [R, T], 38, '#799563');
    wall([L, T], [L, B], 16, '#8ea66d');
    wall([R, T], [R, B], 16, '#829b65');
    for (const [x, y] of [
        [L, T],
        [R, T],
        [L, B],
        [R, B],
    ]) {
        const p = project(x, y, 20);
        ellipse(c, p.x, p.y, 7, 4, '#d1d8a8', '#657f4d', 1.5);
    }
    line(c, [...top, top[0]], '#d5d9a8', 1); // Exact floor rail remains readable inside raised wall.
}
function scoreCard(c, { x, y, w, h, fill, stroke }) {
    c.beginPath();
    c.roundRect(x - w / 2, y - h / 2, w, h, Math.min(15, h / 3));
    c.fillStyle = fill;
    c.fill();
    c.strokeStyle = stroke;
    c.lineWidth = 2;
    c.stroke();
}
function scoreFeedback(c, events, shift = { x: 0, y: 0 }, view) {
    if (!events?.length) return;
    const current = events.filter((e) => e.age >= 0 && e.age < e.life);
    const combo = current.findLast((e) => e.kind === 'combo' && e.count >= 2),
        strike = current.findLast((e) => e.kind === 'strike');
    if (combo) {
        const fade = clamp((combo.life - combo.age) / 0.22, 0, 1),
            appear = clamp((combo.age + 0.02) / 0.08, 0, 1);
        const hit = project(combo.x, combo.y, 40);
        const x = clamp(hit.x + shift.x, view.left + 76, view.left + view.width - 76);
        const topInset = strike
            ? Math.min(160, view.height * 0.23)
            : Math.min(119, view.height * 0.17);
        const bottomInset = Math.min(140, view.height * 0.2);
        const y = clamp(
            hit.y + shift.y - 50 - combo.age * 17,
            view.top + topInset,
            view.top + view.height - bottomInset,
        );
        c.save();
        c.globalAlpha = fade * appear;
        scoreCard(c, { x, y, w: 140, h: 41, fill: '#243f3b', stroke: '#b9e6b0' });
        label(c, '×' + String(combo.count), x - 27, y + 1, 28, '#fff1b2');
        label(c, 'COMBO', x + 27, y + 2, 16, '#ddf7de');
        c.restore();
    }
    if (strike) {
        const fade = clamp((strike.life - strike.age) / 0.3, 0, 1),
            progress = clamp(strike.age / 0.17, 0, 1);
        const x = view.left + view.width / 2,
            y = view.top + Math.min(107, view.height * 0.22) - 11 * progress;
        c.save();
        c.globalAlpha = fade;
        scoreCard(c, { x, y, w: 218, h: 79, fill: '#293c3c', stroke: '#f4d486' });
        label(c, 'STRIKE', x, y - 13, 37, '#ffe58e');
        label(c, `${strike.count} / ${strike.count} PINS`, x, y + 20, 18, '#fff8d8');
        for (const side of [-1, 1]) {
            const offset = (113 + 18 * progress) * side;
            line(
                c,
                [
                    { x: x + offset, y: y - 15 },
                    { x: x + offset + side * 19, y: y - 24 },
                ],
                '#ffe496',
                3,
            );
            line(
                c,
                [
                    { x: x + offset, y: y + 10 },
                    { x: x + offset + side * 13, y: y + 18 },
                ],
                '#caddaf',
                2,
            );
        }
        c.restore();
        const p = project(strike.x, strike.y, 30),
            burst = clamp(1 - strike.age / 0.45, 0, 1);
        if (burst > 0) {
            c.save();
            c.globalAlpha = burst * 0.67;
            for (let i = 0; i < 8; i++) {
                const a = (i * TAU) / 8 + 0.13,
                    r = 12 + (1 - burst) * 39;
                const px = p.x + shift.x + Math.cos(a) * r,
                    py = p.y + shift.y + Math.sin(a) * r * 0.65;
                ellipse(c, px, py, 2.3 + burst, 2.3 + burst, i % 2 ? '#e2f9c9' : '#ffe58e');
            }
            c.restore();
        }
    }
}
export const drawDepth = (o, type) =>
    cameraDepth(
        o.x,
        o.y,
        (o.recoil?.z ?? o.z ?? 0) +
            (type === 'boss' ? 58 : type === 'reflector' ? o.height / 2 : o.r || 0),
    );
export function expeditionCameraShift(expedition) {
    return expedition?.room
        ? worldVectorToScreen(
              CAMERA.worldCenter.x - (expedition.cameraX ?? expedition.room.centerX),
              CAMERA.worldCenter.y - (expedition.cameraY ?? expedition.room.centerY),
          )
        : null;
}

function bowlerTrail(c, b) {
    const speed = Math.hypot(b.moveVx || 0, b.moveVy || 0),
        age = b.dashPose ?? Infinity,
        dashing = age >= 0 && age < 0.29 && (!b.dashOnly || b.dashTrail?.length > 1);
    if (dashing) {
        const alpha = Math.max(0, 1 - age / 0.29),
            dirs = b.dashTrail || [];
        c.save();
        for (let i = 0; i < dirs.length - 1; i++) {
            const { x, y } = dirs[i],
                q = project(x, y, 39),
                foot = project(x, y);
            c.globalAlpha = ((alpha * (i + 1)) / dirs.length) * 0.25;
            ellipse(c, q.x, q.y, 36, 28, '#f2d386');
            ellipse(c, foot.x, foot.y, 43, 9, '#b1a16d');
        }
        if (dirs.length > 1) {
            c.globalAlpha = alpha * 0.42;
            for (const side of [-1, 1])
                line(
                    c,
                    dirs.map(({ x, y }) =>
                        project(x + (b.dashY || 0) * side * 26, y - (b.dashX || 0) * side * 26, 5),
                    ),
                    '#fff0b1',
                    3,
                );
        }
        c.restore();
    } else if (!b.dashOnly && speed > 2 && b.moving) {
        const nx = b.moveVx / speed,
            ny = b.moveVy / speed,
            dash = (b.dashRemaining || 0) > 0,
            len = dash ? 70 : 26;
        c.save();
        c.globalAlpha = dash ? 0.45 : 0.22;
        for (const side of [-1, 1])
            line(
                c,
                [
                    project(b.x - nx * len - ny * side * 22, b.y - ny * len + nx * side * 22),
                    project(b.x - ny * side * 22, b.y + nx * side * 22),
                ],
                dash ? '#fff0b1' : '#d7dfb7',
                dash ? 5 : 2,
            );
        c.restore();
    }
}

export function render(c, g, aim = null, view = CAMERA_VIEW) {
    c.save();
    c.clearRect(view.left, view.top, view.width, view.height);
    const shake = Math.min(2.5, Math.max(0, g.shake || 0));
    c.translate(Math.sin((g.time || 0) * 47) * shake, Math.cos((g.time || 0) * 39) * shake * 0.6);
    const arena = g.arena ?? arenaForRoute(g.route),
        exp = g.expedition;
    const shift = expeditionCameraShift(exp);
    if (shift) {
        const storm = routeDefinition(g.route).landscape === 'storm';
        c.fillStyle = storm ? STORM_SHADE : FOREST_SHADE;
        c.fillRect(view.left - 4, view.top - 4, view.width + 8, view.height + 8);
        c.save();
        c.translate(shift.x, shift.y);
        drawExpeditionLandscape(
            c,
            exp,
            shift,
            { polygon, line, ellipse },
            { storm, time: g.time, view },
        );
    } else field(c, g.route, arena, g.time, g.duel);
    if (g.duel) {
        const { y, halfWidth } = g.duel.centerLane;
        const { left, right } = arena;
        const top = y - halfWidth;
        const bottom = y + halfWidth;
        polygon(
            c,
            [
                project(left, top),
                project(right, top),
                project(right, bottom),
                project(left, bottom),
            ],
            '#bdd8df30',
        );
        for (const edge of [top, bottom]) {
            line(c, [project(left, edge), project(right, edge)], '#c4dce6c0', 2, [7, 8]);
        }
    }
    // Ready balls count as supply; echoes do not. Armed loose balls stay collectible while rolling or before auto-return.
    const bounds = exp?.room?.arena;
    const seen = (o) =>
        !bounds ||
        (o.x >= bounds.left && o.x <= bounds.right && o.y >= bounds.top && o.y <= bounds.bottom);
    const balls = g.balls || [],
        lowAmmo = balls.filter((b) => b.ready).length <= 1;
    const bowlers = g.duel?.players;
    const allBalls = bowlers?.flatMap((player) => player.balls) ?? balls;
    const teamOf = (o) => g.duel?.teams[o.side];
    const enemies = (g.enemies || []).filter(seen);
    const liveBalls = [
        ...allBalls.filter(
            (b) => (b.ready && b.held) || (!b.ready && (b.life > 0 || b.inWorld) && seen(b)),
        ),
        ...(g.echoes || []).filter(seen),
    ];
    for (const b of liveBalls)
        if (!b.held && b.trail?.length > 1) {
            c.save();
            c.globalAlpha = 0.25;
            line(
                c,
                b.trail.filter(seen).map((p) => project(p.x, p.y, p.z || 0)),
                teamOf(b)?.light ?? '#fff0b1',
                b.r * 0.8,
            );
            c.restore();
        }
    if (g.controlMode === 'manual') {
        if (bowlers) for (const player of bowlers) bowlerTrail(c, player.boss);
        else bowlerTrail(c, g.boss);
    }
    const liveShots = (g.enemyProjectiles || []).filter(seen);
    for (const magnet of (g.pinMagnets || []).filter(seen)) magnetGround(c, magnet, g.time || 0);
    for (const e of enemies) enemyGround(c, e, g.boss);
    for (const s of liveShots) enemyShotGround(c, s, threatInk);
    for (const e of enemies) if (drawEnemy(e)) shadow(c, e, e.r * 1.05);
    if (bowlers) {
        for (const player of bowlers) {
            const b = player.boss;
            shadow(c, b, b.r * 0.94);
            const p = project(b.x, b.y);
            const r = b.r * CAMERA.scale * 0.84;
            const team = teamOf(b);
            ellipse(c, p.x, p.y, r, r * Math.sin(CAMERA.pitch), team.ink + '22', team.ink, 4);
            ellipse(c, p.x, p.y, r, r * Math.sin(CAMERA.pitch), team.ink + '00', team.light, 1.55);
        }
    } else shadow(c, g.boss, g.boss.r * 0.94);
    for (const b of liveBalls) {
        if (b.vault && b.vault.kind !== 'second-roll' && b.z > 0) ballVaultShadow(c, b);
        else shadow(c, b, b.r * 0.9);
    }
    const objects = [
        ...(bowlers ?? [{ boss: g.boss }]).map(({ boss }) => ({ o: boss, type: 'boss' })),
        ...(arena.reflectors ?? [])
            .filter(reflectorIsActive)
            .map((o) => ({ o, type: 'reflector' })),
        ...enemies.filter(drawEnemy).map((o) => ({ o, type: 'enemy' })),
        ...liveBalls.filter((b) => !b.held).map((o) => ({ o, type: 'ball' })),
        ...liveShots.map((o) => ({ o, type: 'projectile' })),
    ].sort((a, b) => drawDepth(a.o, a.type) - drawDepth(b.o, b.type));
    for (const { o, type } of objects) {
        if (type === 'boss') {
            boss(
                c,
                o,
                liveBalls.find((b) => b.held && (!bowlers || b.side === o.side)),
                teamOf(o),
            );
        } else if (type === 'reflector') drawReflector(c, o, { polygon, line });
        else if (type === 'enemy') enemy(c, o, teamOf(o));
        else if (type === 'projectile') enemyShot(c, o, threatInk);
        else ball(c, o, teamOf(o));
    }
    if (bowlers) {
        for (const player of bowlers) {
            const b = player.boss;
            const at = project(b.x, b.y, Math.max(0, (b.recoil?.z ?? 0) - 7));
            const text = b.side === g.duel.side ? '나' : '상대';
            c.save();
            ellipse(c, at.x, at.y + 15, text === '나' ? 13 : 20, 9, teamOf(b).ink);
            label(c, text, at.x, at.y + 15, 12, '#fff9eb');
            c.restore();
        }
    }
    // Cutaway preserves enemy visibility; loose balls only get the low-ammo recovery cue.
    const bp = project(g.boss.x, g.boss.y, 68 + (g.boss.recoil?.z || 0)),
        bd = drawDepth(g.boss, 'boss');
    for (const { o, type } of objects) {
        if (type !== 'enemy' || drawDepth(o, type) >= bd) continue;
        const p = project(o.x, o.y, (o.z || 0) + (o.r || 0));
        if (Math.abs(p.x - bp.x) < 50 && p.y > bp.y - 73 && p.y < bp.y + 45) {
            c.save();
            c.globalAlpha = 0.8;
            ellipse(
                c,
                p.x,
                p.y,
                (o.r || 10) * CAMERA.scale + 3,
                (o.r || 10) * CAMERA.scale + 3,
                '#243d3022',
                '#ffe3a4',
                2,
            );
            if (o.hp > 0) label(c, o.attackStage === 'warn' ? '!' : '·', p.x, p.y, 13, '#fff2bd');
            c.restore();
        }
    }
    if (lowAmmo)
        for (const b of balls)
            if (!b.ready && !b.held && b.inWorld && b.pickupArmed && !b.vault && seen(b)) {
                const p = project(b.x, b.y),
                    r = (b.r + 9) * CAMERA.scale;
                c.beginPath();
                c.ellipse(p.x, p.y, r, r * Math.sin(CAMERA.pitch), 0, 0, TAU);
                c.strokeStyle = '#244c42';
                c.lineWidth = 4;
                c.stroke();
                c.strokeStyle = '#c2efd4';
                c.lineWidth = 2;
                c.stroke();
            }
    if (!shift)
        line(
            c,
            [project(arena.left, arena.bottom, 8), project(arena.right, arena.bottom, 8)],
            routeDefinition(g.route).landscape === 'storm' ? stormFrontRail : '#e2dfb699',
            4,
        );
    const hp = clamp(g.boss.hp / Math.max(1, g.boss.maxHp), 0, 1);
    for (const { boss: b } of bowlers ?? [{ boss: g.boss }]) {
        if (!b.lastDamage || (b.hurtAge ?? 99) >= 0.8) continue;
        const hpPoint = project(b.x, b.y, 170 + (b.recoil?.z || 0));
        const age = b.hurtAge || 0;
        c.save();
        c.globalAlpha = 1 - age / 0.8;
        label(
            c,
            '−' + Math.round(b.lastDamage.amount),
            hpPoint.x,
            hpPoint.y - 18 - age * 25,
            20,
            '#a74436',
        );
        c.restore();
    }
    if (hp <= 0.3) {
        c.save();
        c.globalAlpha = 0.28;
        c.strokeStyle = '#b95444';
        c.lineWidth = 7;
        c.strokeRect(4 - (shift?.x || 0), 4 - (shift?.y || 0), CAMERA.width - 8, CAMERA.height - 8);
        c.restore();
    }
    for (const e of (g.effects || []).filter(seen)) {
        if (e.kind === 'rock-break') {
            drawReflectorBreak(c, e, { polygon });
            continue;
        }
        if (e.kind === 'rock-return') {
            const p = project(e.x, e.y);
            const t = e.age / e.life;
            const r = e.size * CAMERA.scale * (0.65 + 0.55 * t);
            c.save();
            c.globalAlpha = (1 - t) * 0.5;
            ellipse(c, p.x, p.y, r, r * Math.sin(CAMERA.pitch), null, '#c7d4cf', 2);
            c.restore();
            continue;
        }
        const contactStyle = AUGMENT_CONTACT_INK[e.kind];
        if (contactStyle) {
            augmentContact(c, e, contactStyle);
            continue;
        }
        if (e.kind === 'pin-magnet-start') continue;
        if (e.kind === 'pin-blast') {
            blastPuff(c, e);
            continue;
        }
        if (e.kind === 'pin-lob-burst') {
            lobImpact(c, e, threatInk);
            continue;
        }
        if (e.kind === 'ball-vault' || e.kind === 'ball-vault-land') {
            ballVaultFx(c, e);
            continue;
        }
        if (e.kind === 'ball-second-roll') {
            secondRollPuff(c, e);
            continue;
        }
        if (e.kind === 'ball-second-roll-land') continue;
        const t = clamp(1 - (e.age || 0) / (e.life || 1), 0, 1),
            p = project(e.x, e.y, e.z || 0),
            r =
                (e.kind === 'stomp' && e.color !== '#ffae6f' && e.color !== '#e9a06b'
                    ? Math.min(35, e.size || 16)
                    : e.size || 16) *
                (1 + (1 - t) * 1.8);
        c.save();
        c.globalAlpha =
            e.kind === 'stomp' && e.color !== '#ffae6f' && e.color !== '#e9a06b' ? t * 0.22 : t;
        if (e.kind === 'pickup') {
            const pickupOwner = bowlers?.[e.side]?.boss ?? g.boss;
            const q = project(pickupOwner.x, pickupOwner.y, 80),
                travel = 1 - t;
            for (let i = 0; i < 4; i++) {
                const a = (i * TAU) / 4,
                    spread = (e.size || 20) * t;
                ellipse(
                    c,
                    p.x + (q.x - p.x) * travel + Math.cos(a) * spread,
                    p.y + (q.y - p.y) * travel + Math.sin(a) * spread * 0.65,
                    3 + t * 2,
                    3 + t * 2,
                    '#e5ffe1',
                    '#49795c',
                    1,
                );
            }
            c.beginPath();
            c.ellipse(p.x, p.y, r, r * 0.5, 0, 0, TAU);
            c.strokeStyle = '#bceccf';
            c.lineWidth = 3;
            c.stroke();
        } else if (['stomp', 'land', 'shot'].includes(e.kind)) {
            c.beginPath();
            c.ellipse(p.x, p.y, r, r * 0.4, 0, 0, TAU);
            c.strokeStyle = e.color || '#fff1b4';
            c.lineWidth = e.kind === 'stomp' ? 1.5 : 2;
            c.stroke();
        } else {
            for (let i = 0; i < 6; i++) {
                const a = (i * TAU) / 6;
                line(
                    c,
                    [
                        { x: p.x + Math.cos(a) * r * 0.3, y: p.y + Math.sin(a) * r * 0.3 },
                        { x: p.x + Math.cos(a) * r, y: p.y + Math.sin(a) * r },
                    ],
                    e.color || '#fff2bf',
                    3,
                );
            }
        }
        if (e.text) label(c, e.text, p.x, p.y - 20 - (1 - t) * 20, 18);
        c.restore();
    }
    if (aim) {
        const b = g.balls.find((b) => b.held && b.ready);
        if (b) {
            const bowler = g.duel ? { ...g.boss, facing: Math.atan2(aim.vy, aim.vx) } : g.boss;
            const release = releasePoint(bowler),
                origin = project(release.x, release.y, release.z),
                speed = Math.hypot(aim.vx, aim.vy),
                power = clamp(aim.power || 0, 0, 1),
                finger = aim.current || origin;
            if (!aim.detached && aim.trail?.length > 1) {
                c.save();
                c.globalAlpha = 0.65;
                line(c, aim.trail, '#fff4bf', 3);
                c.restore();
            }
            if (!aim.detached && aim.locked && aim.anchor) {
                const a = aim.anchor,
                    axis = aim.axis || { x: 0, y: 1 },
                    side = { x: axis.y, y: -axis.x };
                c.save();
                c.globalAlpha = 0.75;
                line(
                    c,
                    [
                        { x: a.x - side.x * 60, y: a.y - side.y * 60 },
                        { x: a.x + side.x * 60, y: a.y + side.y * 60 },
                    ],
                    '#fff4bf',
                    2,
                    [3, 6],
                );
                ellipse(c, a.x, a.y, 13, 13, '#a9bf8b88', '#fff4bf', 2);
                c.restore();
            }
            if (!aim.detached) {
                c.save();
                c.globalAlpha = 0.45;
                line(c, [aim.start || origin, finger], '#fff3c4', 2);
                if (aim.start) ellipse(c, aim.start.x, aim.start.y, 5, 5, '#fff3c4');
                ellipse(c, finger.x, finger.y, b.r * 0.65, b.r * 0.65, '#fff7d51a', '#fff3c4', 1.5);
                c.restore();
            }
            if (power > 0 && speed > 0) {
                const type = aim.type ?? g.selectedType ?? b.type ?? 'basic',
                    spin = aim.spin ?? g.selectedSpin ?? b.spin ?? 0,
                    profile = prepareRoll({
                        vx: aim.vx,
                        vy: aim.vy,
                        type,
                        spin,
                        mods: g.mods || {},
                    }),
                    points = predictRoll(
                        {
                            x: release.x,
                            y: release.y,
                            vx: aim.vx,
                            vy: aim.vy,
                            type,
                            spin,
                            mods: g.mods || {},
                            arena,
                        },
                        1.1,
                    ),
                    path = points.map((q) => project(q.x, q.y, release.z));
                c.save();
                c.globalAlpha = 0.85;
                line(c, path, '#496446', 7);
                line(c, path, '#fff4bf', 3.5, [4, 8]);
                c.restore();
                const walls = rollBounds(profile.r, arena);
                for (let i = 1; i < points.length; i++) {
                    const prev = points[i - 1],
                        q = points[i];
                    if (
                        q.rockHit ||
                        (prev.vx * q.vx < 0 && (q.x <= walls.left || q.x >= walls.right)) ||
                        (prev.vy * q.vy < 0 && (q.y <= walls.top || q.y >= walls.bottom))
                    ) {
                        const p = path[i];
                        ellipse(c, p.x, p.y, 7, 7, '#fff1b4', '#617845', 2);
                    }
                }
                const endIndex = Math.min(points.length - 1, 18),
                    end = path[endIndex],
                    last = path[Math.max(0, endIndex - 2)];
                line(c, path.slice(0, endIndex + 1), '#fff0ad', 7);
                const a = Math.atan2(end.y - last.y, end.x - last.x);
                line(
                    c,
                    [
                        { x: end.x - Math.cos(a - 0.55) * 18, y: end.y - Math.sin(a - 0.55) * 18 },
                        end,
                        { x: end.x - Math.cos(a + 0.55) * 18, y: end.y - Math.sin(a + 0.55) * 18 },
                    ],
                    '#fff0ad',
                    7,
                );
                const endpoint = path.at(-1);
                ellipse(c, endpoint.x, endpoint.y, 4, 4, '#fff3c7');
                if (!aim.detached)
                    label(
                        c,
                        (BALL_TYPES[type]?.name || '기본') +
                            ' · ' +
                            (spin < 0 ? '↶ 왼훅' : spin > 0 ? '오른훅 ↷' : '직선'),
                        CAMERA.width / 2,
                        CAMERA.height - 55,
                        15,
                        '#36553b',
                    );
            }

            if (!aim.detached) {
                label(
                    c,
                    '힘 ' +
                        Math.round(power * 100) +
                        '%' +
                        (Math.abs(aim.spin || 0) > 0.01
                            ? ' · ' +
                              (aim.spin < 0 ? '왼 훅 ' : '오른 훅 ') +
                              Math.round(Math.abs(aim.spin) * 100) +
                              '%'
                            : ''),
                    CAMERA.width / 2,
                    CAMERA.height - 27,
                    18,
                    '#354f38',
                );
                label(
                    c,
                    '반사·훅 예측 · 핀 충돌·회수 시 달라짐',
                    CAMERA.width / 2,
                    CAMERA.height - 11,
                    10,
                    '#5d7452',
                );
            }
        }
    }
    if (shift) c.restore();
    scoreFeedback(c, (g.scoreFeedback || []).filter(seen), shift ?? undefined, view);
    c.restore();
}
