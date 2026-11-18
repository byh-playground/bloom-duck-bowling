// Project simulation-owned attack targets, hit areas and flight without predicting new state.
import { CAMERA, project } from './camera.mjs';

const TAU = 2 * Math.PI,
    clamp = (n) => Math.max(0, Math.min(1, n));
const rx = (r) => r * CAMERA.scale,
    ry = (r) => rx(r) * Math.sin(CAMERA.pitch);
const HOP = '#edffd0',
    HOP_EDGE = '#426750',
    BOLT = '#c7f4ff',
    BOLT_EDGE = '#294957',
    LOB = '#ffcf9d',
    LOB_EDGE = '#784c6e';

export function specialPinMark(c, kind, r, { line, ellipse }) {
    if (kind === 'hopper') {
        const zig = (x) => [
            { x, y: r * 0.22 },
            { x: x + r * 0.31, y: r * 0.4 },
            { x, y: r * 0.62 },
            { x: x + r * 0.31, y: r * 0.86 },
            { x, y: r * 1.08 },
        ];
        for (const x of [-r * 0.61, r * 0.27]) {
            line(c, zig(x), HOP_EDGE, 4.5);
            line(c, zig(x), HOP, 2.35);
        }
    } else if (kind === 'shooter') {
        const crest = [
            { x: -r * 0.55, y: -r * 2.46 },
            { x: 0, y: -r * 3.12 },
            { x: r * 0.55, y: -r * 2.46 },
        ];
        line(c, crest, BOLT_EDGE, 5.3);
        line(c, crest, BOLT, 2.7);
    } else if (kind === 'lobber') {
        ellipse(c, 0, -r * 2.96, r * 0.39, r * 0.31, '#cf8c68', LOB_EDGE, 2.4);
        ellipse(c, 0, -r * 3.02, r * 0.2, r * 0.12, LOB);
    }
}

function groundArc(c, p, r, start, end, color, width, dash = []) {
    c.beginPath();
    c.ellipse(p.x, p.y, rx(r), ry(r), 0, start, end);
    c.strokeStyle = color;
    c.lineWidth = width;
    c.setLineDash(dash);
    c.stroke();
    c.setLineDash([]);
}
function lobTarget(c, x, y, r, progress, airborne, { ellipse, line }) {
    if (!(r > 0) || !Number.isFinite(r)) return;
    const p = project(x, y);
    c.save();
    c.globalAlpha = airborne ? 0.24 : 0.12 + 0.08 * progress;
    ellipse(c, p.x, p.y, rx(r), ry(r), '#eaa879');
    c.globalAlpha = 0.78;
    groundArc(c, p, r, 0, TAU, LOB_EDGE, 4.4);
    groundArc(c, p, r, 0, TAU, LOB, 2.5, airborne ? [] : [5, 5]);
    if (!airborne && progress > 0)
        groundArc(c, p, r, -Math.PI / 2, -Math.PI / 2 + TAU * progress, LOB, 3);
    const d = 5;
    line(
        c,
        [
            { x: p.x - d, y: p.y },
            { x: p.x + d, y: p.y },
        ],
        LOB,
        1.8,
    );
    line(
        c,
        [
            { x: p.x, y: p.y - d },
            { x: p.x, y: p.y + d },
        ],
        LOB,
        1.8,
    );
    c.restore();
}
export function pinThreatGround(c, w, d) {
    if (!w) return;
    const { kind, x, y, targetX: tx, targetY: ty, radius } = w;
    if (![x, y, tx, ty].every(Number.isFinite)) return;
    const t = clamp(w.durationMs > 0 ? 1 - w.timeMs / w.durationMs : 0),
        a = project(x, y),
        b = project(tx, ty);
    if (kind === 'lob') {
        lobTarget(c, tx, ty, radius, t, false, d);
        return;
    }
    c.save();
    c.globalAlpha = 0.63 + 0.33 * t;
    if (kind === 'straight') {
        d.line(c, [a, b], BOLT_EDGE, 4);
        d.line(c, [a, b], BOLT, 2.2, [8, 5]);
        const ang = Math.atan2(b.y - a.y, b.x - a.x),
            s = 11;
        d.line(
            c,
            [
                { x: b.x - s * Math.cos(ang - 0.55), y: b.y - s * Math.sin(ang - 0.55) },
                b,
                { x: b.x - s * Math.cos(ang + 0.55), y: b.y - s * Math.sin(ang + 0.55) },
            ],
            BOLT,
            2.2,
        );
    } else if (kind === 'hop') {
        // Travel marks, not a blast radius: the jump itself causes no ranged damage.
        d.line(c, [a, b], HOP_EDGE, 4, [4, 9]);
        d.line(c, [a, b], HOP, 2, [4, 9]);
        const dX = 8;
        d.line(c, [{ x: b.x - dX, y: b.y + 4 }, b, { x: b.x + dX, y: b.y + 4 }], HOP_EDGE, 4);
        d.line(c, [{ x: b.x - dX, y: b.y + 4 }, b, { x: b.x + dX, y: b.y + 4 }], HOP, 2.2);
    }
    c.restore();
}

export function enemyShotGround(c, s, d) {
    if (s.kind === 'lob' && [s.targetX, s.targetY].every(Number.isFinite))
        lobTarget(c, s.targetX, s.targetY, s.blastRadius, 1, true, d);
    const p = project(s.x, s.y),
        r = Math.max(2, rx(s.radius));
    c.save();
    c.globalAlpha = s.kind === 'lob' ? 0.35 : 0.2;
    d.ellipse(
        c,
        p.x,
        p.y,
        r * 1.25,
        Math.max(1.5, r * 0.53),
        s.kind === 'lob' ? LOB_EDGE : BOLT_EDGE,
    );
    c.restore();
}
export function enemyShot(c, s, { line, ellipse }) {
    const z = s.z || 0,
        p = project(s.x, s.y, z),
        r = Math.max(2, rx(s.radius));
    if (s.kind === 'lob') {
        const base = project(s.x, s.y);
        if (z > 12) {
            c.save();
            c.globalAlpha = 0.28;
            line(c, [base, p], LOB, 1, [3, 5]);
            c.restore();
        }
        ellipse(c, p.x, p.y, r, r, '#da8c69', LOB_EDGE, 2.8);
        ellipse(c, p.x - r * 0.22, p.y - r * 0.29, r * 0.49, r * 0.36, LOB);
    } else {
        const dx = s.vx ?? s.targetX - s.x,
            dy = s.vy ?? s.targetY - s.y,
            len = Math.hypot(dx, dy);
        if (len > 0 && Number.isFinite(len)) {
            const tail = project(s.x - (dx / len) * 18, s.y - (dy / len) * 18, z);
            line(c, [tail, p], BOLT_EDGE, 5);
            line(c, [tail, p], BOLT, 2.3);
        }
        ellipse(c, p.x, p.y, r, r * 0.68, BOLT, BOLT_EDGE, 2.4);
    }
}
export function lobImpact(c, e, { ellipse }) {
    const t = clamp(e.age / e.life),
        r = e.size,
        p = project(e.x, e.y, e.z || 0);
    if (!(r > 0) || t >= 1) return;
    c.save();
    c.globalAlpha = (1 - t) * 0.24;
    ellipse(c, p.x, p.y, rx(r), ry(r), '#ffae88');
    c.globalAlpha = (1 - t) * 0.7;
    groundArc(c, p, r, 0, TAU, LOB, 3);
    for (let i = 0; i < 5; i++) {
        const a = (i * TAU) / 5,
            dist = r * (0.46 + t * 0.53),
            q = project(e.x + Math.cos(a) * dist, e.y + Math.sin(a) * dist, 9 + t * 18);
        ellipse(c, q.x, q.y, 3.0 + t * 1.7, 2.1 + t * 1.4, LOB, LOB_EDGE, 1);
    }
    c.restore();
}
