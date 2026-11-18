// Connected forest artwork is grounded in the real room rectangles and gate seams.
import { CAMERA, project, unproject } from './camera.mjs';
import { drawStormRain } from './storm-landscape.mjs';
const POINT = (x, y, z = 0) => project(x, y, z);
const colors = [
    {
        low: '#9cae73',
        bright: '#afbd85',
        moss: '#567650',
        wall: '#5d7852',
        rim: '#d5dcaa',
        fringe: '#657e57',
    },
    {
        low: '#879e70',
        bright: '#a0b180',
        moss: '#56775b',
        wall: '#4f6e55',
        rim: '#cddfb3',
        fringe: '#66846e',
    },
    {
        low: '#a4af7d',
        bright: '#b8be8c',
        moss: '#637951',
        wall: '#677854',
        rim: '#e1dfb4',
        fringe: '#71815b',
    },
    {
        low: '#90a575',
        bright: '#aabc87',
        moss: '#547858',
        wall: '#4c7057',
        rim: '#cde1b7',
        fringe: '#638661',
    },
    {
        low: '#a0a777',
        bright: '#b2b586',
        moss: '#64704b',
        wall: '#616c4e',
        rim: '#dfd9a6',
        fringe: '#738056',
    },
];
const STORM_COLORS = [
    {
        low: '#526b80',
        bright: '#607b8e',
        moss: '#374f62',
        wall: '#49657a',
        rim: '#b2c8d6',
        fringe: '#355163',
    },
    {
        low: '#48657b',
        bright: '#557489',
        moss: '#314d60',
        wall: '#3d5b70',
        rim: '#bbd3de',
        fringe: '#2f4b60',
    },
    {
        low: '#536e83',
        bright: '#657d92',
        moss: '#3e536d',
        wall: '#48627a',
        rim: '#c0d3df',
        fringe: '#3c4e65',
    },
    {
        low: '#445d76',
        bright: '#536e87',
        moss: '#324b60',
        wall: '#385369',
        rim: '#a7c0d0',
        fringe: '#30465b',
    },
    {
        low: '#5a7487',
        bright: '#6b8495',
        moss: '#3c5869',
        wall: '#476478',
        rim: '#c5d8e1',
        fringe: '#3a5669',
    },
];
const inkFor = (room, storm) =>
    (storm ? STORM_COLORS : colors)[Math.abs(room.index ?? 0) % colors.length];
function edges(a) {
    const { left: L, right: R, top: T, bottom: B } = a;
    return [
        { axis: 'x', at: T, min: L, max: R },
        { axis: 'y', at: R, min: T, max: B },
        { axis: 'x', at: B, min: L, max: R },
        { axis: 'y', at: L, min: T, max: B },
    ];
}
function edgeGates(edge, all) {
    return all.filter((g) => {
        if (!Number.isFinite(g?.width) || g.width <= 0) return false;
        const [along, across] = edge.axis === 'x' ? ['x', 'y'] : ['y', 'x'];
        return Math.abs(edge.at - g[across]) < 1e-5 && g[along] > edge.min && g[along] < edge.max;
    });
}
const on = (e, v, z = 0) => (e.axis === 'x' ? POINT(v, e.at, z) : POINT(e.at, v, z));
function edgeRail(c, e, from, to, ink, { line, polygon }) {
    if (to - from <= 1e-4) return;
    const a = on(e, from),
        b = on(e, to),
        aTop = on(e, from, 13),
        bTop = on(e, to, 13);
    polygon(c, [a, b, bTop, aTop], ink.wall);
    line(c, [aTop, bTop], ink.rim, 3.5);
    line(c, [a, b], ink.moss, 1.35);
}
function woodlandOutside(c, room, { polygon, ellipse, line }) {
    const { left: L, right: R, top: T, bottom: B } = room.arena,
        n = room.index ?? 0,
        { fringe, moss } = colors[n % colors.length],
        h = B - T;
    for (const side of [-1, 1]) {
        const x = side < 0 ? L : R;
        const bank = Array.from({ length: 11 }, (_, i) =>
            POINT(x + side * (30 + ((i * 19 + n * 13) % 45)), T + (i * h) / 10),
        );
        polygon(c, [POINT(x, T), ...bank, POINT(x, B)], fringe);
        const creek = ['birches', 'forest-heart'].includes(room.decor);
        if (creek) {
            const strand = bank.map((_, i) =>
                POINT(x + side * (27 + ((i * 9) % 24)), T + (i * h) / 10),
            );
            line(c, strand, '#567e7b', 18);
            line(c, strand, '#89b2a5', 12);
            line(c, strand, '#c0d9bb88', 2, [7, 12]);
        }
        for (let i = 0; i < 9; i++) {
            const y = T + 30 + (i * (h - 60)) / 8,
                off = 46 + ((i * 31 + n * 19) % 36),
                p = POINT(x + side * off, y);
            if (creek && i % 3) {
                ellipse(c, p.x, p.y, 11 + (i % 5), 6, '#6e7e73', '#4d675b', 1.2);
                ellipse(c, p.x - side * 4, p.y - 3, 6, 2, '#98a18a');
            } else {
                const crown = POINT(x + side * off, y, 22 + (i % 3) * 5),
                    tone = n % 3 === 2 ? '#83916a' : moss;
                ellipse(c, p.x, p.y, 13, 7, '#45675077');
                line(c, [p, crown], n % 3 === 2 ? '#adb59a' : '#536a48', 3);
                ellipse(c, crown.x, crown.y, 11 + (i % 3) * 2, 11 + (i % 2) * 4, tone);
                ellipse(c, crown.x - 4, crown.y - 4, 6, 7, '#adc09977');
            }
        }
    }
}
function floor(c, room, inks) {
    const { polygon, line, ellipse } = inks,
        a = room.arena,
        { left: L, right: R, top: T, bottom: B } = a;
    const n = Number.isFinite(room.index) ? room.index : 0,
        ink = colors[Math.abs(n) % colors.length],
        w = R - L,
        h = B - T;
    polygon(c, [POINT(L, T), POINT(R, T), POINT(R, B), POINT(L, B)], ink.low);
    // Low-contrast uneven lawn layers, never obstacles or attack-range markers.
    for (let i = 0; i < 4; i++) {
        const y = T + h * (0.07 + i * 0.23),
            d = h * (0.09 + (i % 2) * 0.021);
        polygon(
            c,
            [
                POINT(L, y + d * 0.2),
                POINT(L + w * 0.29, y),
                POINT(L + w * 0.66, y + d * 0.24),
                POINT(R, y + d * 0.05),
                POINT(R, y + d * 0.78),
                POINT(L + w * 0.55, y + d),
                POINT(L, y + d * 0.83),
            ],
            ink.bright,
        );
    }
    for (let i = 0; i < 18; i++) {
        const x = L + 35 + (((i * 131 + n * 83) % 71) / 71) * (w - 70),
            y = T + 28 + (((i * 191 + n * 41) % 89) / 89) * (h - 56),
            p = POINT(x, y);
        c.save();
        c.globalAlpha = 0.2;
        line(
            c,
            [
                { x: p.x - 5, y: p.y + 2 },
                { x: p.x, y: p.y - 2 },
                { x: p.x + 6, y: p.y + 1 },
            ],
            ink.moss,
            1.1,
        );
        c.restore();
    }
    // Shallow patches at corners are scenic only. They lie flat, unlike the raised edge rails.
    for (let side = 0; side < 2; side++)
        for (let i = 0; i < 4; i++) {
            const y = T + 48 + (i * (h - 96)) / 3,
                x = (side === 0 ? L + 20 : R - 20) + (i % 2 ? 2 : -2),
                p = POINT(x, y);
            if (['birches', 'forest-heart'].includes(room.decor))
                ellipse(c, p.x, p.y, 11, 4, '#82a99a80', '#547d716c', 1);
            else ellipse(c, p.x, p.y, 12, 5, ink.fringe + '70');
        }
}
function gateMark(c, e, g, inks, soft = false, storm = false) {
    const { polygon, line, ellipse } = inks,
        v = e.axis === 'x' ? g.x : g.y,
        h = g.width * 0.5;
    const a = on(e, v - h),
        b = on(e, v + h),
        bank = (u, side) =>
            e.axis === 'x' ? POINT(u, e.at + side * 12) : POINT(e.at + side * 12, u);
    if (g.open) {
        polygon(
            c,
            [bank(v - h, -1), bank(v + h, -1), bank(v + h, 1), bank(v - h, 1)],
            storm ? '#9ecddc80' : '#c6d99d6b',
        );
        line(c, [a, b], storm ? '#d8f3ff' : '#eff0b6', 2.6, [6, 7]);
    } else if (!soft) {
        line(c, [on(e, v - h, 14), on(e, v + h, 14)], storm ? '#30485b' : '#445a3d', 6);
        line(c, [on(e, v - h, 15), on(e, v + h, 15)], storm ? '#829bac' : '#b0b68a', 2, [4, 5]);
    }
    if (!soft)
        for (const p of [on(e, v - h, 14), on(e, v + h, 14)])
            ellipse(
                c,
                p.x,
                p.y,
                5.7,
                3.2,
                g.open ? (storm ? '#e1f8ff' : '#f2e3ab') : storm ? '#658096' : '#829473',
                storm ? '#35536a' : '#4d654b',
                1.1,
            );
}
function roomRails(c, room, gates, inks, renderedGates, storm) {
    const ink = inkFor(room, storm);
    for (const e of edges(room.arena)) {
        const crossing = edgeGates(e, gates).sort((a, b) =>
            e.axis === 'x' ? a.x - b.x : a.y - b.y,
        );
        let cursor = e.min;
        for (const g of crossing) {
            const v = e.axis === 'x' ? g.x : g.y,
                l = Math.max(e.min, v - g.width * 0.5),
                r = Math.min(e.max, v + g.width * 0.5);
            if (g.open) {
                edgeRail(c, e, cursor, l, ink, inks);
                cursor = Math.max(cursor, r);
            }
        }
        edgeRail(c, e, cursor, e.max, ink, inks);
        for (const g of crossing)
            if (!renderedGates.has(g)) {
                gateMark(c, e, g, inks, g.entered === true, storm);
                renderedGates.add(g);
            }
    }
}
function gateChevrons(c, gate, { line }, storm) {
    const [dx, dy] =
        gate.direction === 'north' ? [0, -1] : gate.direction === 'west' ? [-1, 0] : [1, 0];
    const point = (back, side) =>
        POINT(gate.x - dx * back - dy * side, gate.y - dy * back + dx * side, 2);
    for (const back of [22, 63]) {
        const mark = [point(back + 22, -29), point(back, 0), point(back + 22, 29)];
        line(c, mark, storm ? '#273e54' : '#54633c', 8);
        line(c, mark, storm ? '#dbf4ff' : '#fff0b5', 4.5);
    }
}
const CANOPY = ['#26392f', '#2a4034', '#304739', '#253b30', '#344b3b'];
export const FOREST_SHADE = '#22362c';
export const STORM_SHADE = '#243746';
const direction = (gate) =>
    gate.direction === 'north' ? [0, -1] : gate.direction === 'west' ? [-1, 0] : [1, 0];
const hash = (x, y) => (Math.imul(x + 187, 73856093) ^ Math.imul(y - 241, 19349663)) >>> 0;
function canopy(c, shift, arena, { ellipse }) {
    // Continuous leaf masses, unrelated to room topology. Never draw a hidden room's floor or rails.
    const size = 84,
        loX = Math.floor((-shift.x - 85) / size),
        hiX = Math.ceil((CAMERA.width - shift.x + 85) / size),
        loY = Math.floor((-shift.y - 85) / size),
        hiY = Math.ceil((CAMERA.height - shift.y + 85) / size);
    for (let row = loY; row <= hiY; row++)
        for (let col = loX; col <= hiX; col++) {
            const h = hash(col, row),
                dx = (h % 65) - 32,
                dy = ((h >>> 7) % 53) - 26;
            const x = col * size + dx + (row % 2 ? 25 : 0),
                y = row * size + dy,
                r = 28 + (h % 36);
            const at = unproject(x, y);
            if (
                at.x > arena.left + 132 &&
                at.x < arena.right - 132 &&
                at.y > arena.top + 180 &&
                at.y < arena.bottom - 180
            )
                continue;
            ellipse(c, x, y, r, r * 0.7, CANOPY[h % CANOPY.length]);
            ellipse(
                c,
                x + r * 0.3,
                y - r * 0.22,
                r * 0.72,
                r * 0.66,
                CANOPY[(h >>> 6) % CANOPY.length],
            );
        }
}
function gateMouth(c, gate, { polygon }, returning = false, storm = false) {
    if (!gate.open) return;
    const [nx, ny] = direction(gate).map((n) => n * (returning ? -1 : 1)),
        w = gate.width * 0.5,
        p = (ahead, s) => POINT(gate.x + nx * ahead - ny * s, gate.y + ny * ahead + nx * s);
    // A short, tapering bit of path is the only peek beyond a gate; no neighboring room outline.
    polygon(
        c,
        [
            p(-8, -w),
            p(3, -w),
            p(43, -w * 0.72),
            p(87, -w * 0.43),
            p(92, -w * 0.11),
            p(82, w * 0.27),
            p(65, w * 0.49),
            p(31, w * 0.78),
            p(2, w),
            p(-8, w),
        ],
        storm ? '#3f5d70' : '#536752',
    );
    polygon(
        c,
        [
            p(-5, -w * 0.86),
            p(16, -w * 0.76),
            p(52, -w * 0.44),
            p(46, w * 0.35),
            p(12, w * 0.78),
            p(-5, w * 0.86),
        ],
        storm ? '#5a788c' : '#768467',
    );
    polygon(
        c,
        [p(-6, -w * 0.73), p(11, -w * 0.68), p(22, -w * 0.38), p(19, w * 0.41), p(-6, w * 0.75)],
        storm ? '#7392a4' : '#a2a878',
    );
}
function entryFalloff(c, exp, storm) {
    const gate = exp.entryGate;
    if (!gate) return;
    const [nx, ny] = direction(gate),
        a = exp.room.arena;
    const depth = nx ? a.right - a.left : a.bottom - a.top;
    const advance =
        nx * ((exp.cameraX ?? exp.room.centerX) - gate.x) +
        ny * ((exp.cameraY ?? exp.room.centerY) - gate.y);
    const horizon = 150 + Math.max(0, advance) * 3.15;
    if (horizon >= depth + 90) return;
    const from = POINT(gate.x + nx * (horizon - 45), gate.y + ny * (horizon - 45)),
        to = POINT(gate.x + nx * (horizon + 125), gate.y + ny * (horizon + 125));
    const veil = c.createLinearGradient(from.x, from.y, to.x, to.y);
    const shade = storm ? STORM_SHADE : FOREST_SHADE;
    veil.addColorStop(0, shade + '00');
    veil.addColorStop(1, shade + 'f2');
    const { left: L, right: R, top: T, bottom: B } = a;
    // Lighting falls off across the active clearing only. The hidden regions have no layout to reveal.
    c.beginPath();
    const head = POINT(L, T);
    c.moveTo(head.x, head.y);
    for (const p of [POINT(R, T), POINT(R, B), POINT(L, B)]) c.lineTo(p.x, p.y);
    c.closePath();
    c.fillStyle = veil;
    c.fill();
}
function stormMist(c, shift, { polygon }) {
    const rock = ['#273b4b', '#2b4254', '#30495b', '#344e60'],
        step = 105;
    const minX = Math.floor((-shift.x - step) / step),
        maxX = Math.ceil((CAMERA.width - shift.x + step) / step);
    const minY = Math.floor((-shift.y - step) / step),
        maxY = Math.ceil((CAMERA.height - shift.y + step) / step);
    for (let row = minY; row <= maxY; row++)
        for (let col = minX; col <= maxX; col++) {
            const h = hash(col, row),
                x = col * step + (h % 83) - 40,
                y = row * step + ((h >>> 7) % 57) - 28,
                r = 38 + (h % 49);
            polygon(
                c,
                [
                    { x: x - r, y: y + 13 },
                    { x: x - r * 0.74, y: y - r * 0.24 },
                    { x: x - r * 0.12, y: y - r * 0.49 },
                    { x: x + r * 0.55, y: y - r * 0.3 },
                    { x: x + r, y: y + 9 },
                    { x: x + r * 0.64, y: y + r * 0.44 },
                    { x: x - r * 0.39, y: y + r * 0.36 },
                ],
                rock[h % rock.length],
            );
        }
}
function stormFloor(c, room, { polygon, line, ellipse }) {
    const { left: L, right: R, top: T, bottom: B, width: w, height: h } = room.arena,
        ink = inkFor(room, true),
        n = room.index;
    polygon(c, [POINT(L, T), POINT(R, T), POINT(R, B), POINT(L, B)], ink.low);
    for (let i = 0; i < 10; i++) {
        const y = T + h * (0.07 + i * 0.088),
            x = L + w * (i % 3 === 0 ? 0.08 : i % 3 === 1 ? 0.56 : 0.27);
        const dx = Math.min(w * (i % 2 ? 0.33 : 0.52), R - w * 0.08 - x),
            dy = (((i + n) % 3) - 1) * 35;
        line(
            c,
            [POINT(x, y), POINT(x + dx * 0.49, y + dy), POINT(x + dx, y + dy - 8)],
            i % 2 ? '#a6c3d23b' : ink.moss,
            i % 2 ? 2 : 3,
        );
    }
    // Shallow rainwater on the slate stays flat and never suggests a physical obstacle.
    for (let i = 0; i < 5; i++) {
        const x = L + w * (0.12 + ((i * 19 + n * 13) % 70) / 100),
            y = T + h * (0.16 + i * 0.16),
            p = POINT(x, y);
        ellipse(c, p.x, p.y, 20 + (i % 3) * 4, 4, '#aecddd30');
    }
}
export function drawExpeditionLandscape(c, exp, shift, inks, { storm = false, time = 0 } = {}) {
    if (storm) stormMist(c, shift, inks);
    else canopy(c, shift, exp.room.arena, inks);
    // All destination and earlier geometry remains hidden. Only a real entrance breaks the scenery.
    const room = exp.room,
        all = exp.entryGate ? [exp.entryGate, ...(exp.gates || [])] : exp.gates || [];
    if (!storm) woodlandOutside(c, room, inks);
    for (const gate of exp.gates || []) gateMouth(c, gate, inks, false, storm);
    if (exp.entryGate?.open) gateMouth(c, exp.entryGate, inks, true, storm);
    if (storm) stormFloor(c, room, inks);
    else floor(c, room, inks);
    const renderedGates = new Set();
    roomRails(c, room, all, inks, renderedGates, storm);
    entryFalloff(c, exp, storm);
    if (storm) drawStormRain(c, time, shift);
    for (const gate of exp.gates || [])
        if (gate.open && renderedGates.has(gate)) gateChevrons(c, gate, inks, storm);
}
