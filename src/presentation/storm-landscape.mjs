// Paints the rainy ravine below actors and telegraphs; no weather collision or state.
import { CAMERA, project } from './camera.mjs';

const { width: W, height: H } = CAMERA;
const P = (x, y) => ({ x, y });
const ridge = (heights, underside) => {
    const points = heights.map(([x, y]) => P(x, y));
    return [...points, P(points.at(-1).x, underside), P(points[0].x, underside)];
};
const topRidges = [
    [
        [0, 89],
        [0, 35],
        [53, 48],
        [82, 27],
        [137, 42],
        [172, 18],
        [203, 37],
        [223, 32],
        [257, 65],
        [281, 78],
        [319, 87],
        [346, 73],
        [376, 66],
        [421, 31],
        [463, 39],
        [491, 25],
        [537, 48],
        [585, 30],
        [640, 43],
    ],
    [
        [0, 122],
        [0, 66],
        [46, 75],
        [92, 49],
        [118, 51],
        [149, 68],
        [170, 54],
        [207, 69],
        [241, 88],
        [267, 103],
        [322, 109],
        [363, 95],
        [400, 69],
        [448, 58],
        [474, 72],
        [503, 58],
        [550, 76],
        [578, 54],
        [640, 70],
    ],
];
const shelves = [
    [
        [0, 103],
        [43, 96],
        [64, 143],
        [50, 176],
        [79, 219],
        [52, 261],
        [69, 296],
        [47, 360],
        [72, 413],
        [43, 446],
        [48, 505],
        [23, 561],
        [0, 595],
    ],
    [
        [640, 96],
        [604, 101],
        [580, 140],
        [602, 173],
        [570, 207],
        [601, 247],
        [579, 288],
        [602, 346],
        [571, 386],
        [600, 443],
        [568, 491],
        [579, 535],
        [619, 579],
        [640, 588],
    ],
];
const facets = [
    [
        [0, 103],
        [43, 96],
        [64, 143],
        [27, 129],
        [0, 154],
    ],
    [
        [0, 177],
        [50, 176],
        [79, 219],
        [38, 211],
        [18, 267],
        [0, 254],
    ],
    [
        [0, 303],
        [69, 296],
        [47, 360],
        [20, 348],
        [0, 377],
    ],
    [
        [0, 391],
        [72, 413],
        [43, 446],
        [10, 454],
        [0, 491],
    ],
    [
        [640, 96],
        [604, 101],
        [580, 140],
        [610, 123],
        [640, 161],
    ],
    [
        [640, 173],
        [602, 173],
        [570, 207],
        [611, 207],
        [627, 271],
        [640, 245],
    ],
    [
        [640, 262],
        [579, 288],
        [602, 346],
        [636, 323],
        [640, 345],
    ],
    [
        [640, 373],
        [571, 386],
        [600, 443],
        [620, 414],
        [640, 471],
    ],
];
const seamFractions = [0.09, 0.16, 0.21, 0.33, 0.39, 0.53, 0.64, 0.69, 0.79, 0.87];
const rain = Array.from({ length: 44 }, (_, i) => P((i * 127 + 17) % W, (i * 59 + 43) % H));

export const stormFrontRail = '#becbd6a6';
export function stormLandscape(c, a, time, { polygon, line, ellipse, ingress }) {
    c.fillStyle = '#637989';
    c.fillRect(0, 0, W, H);
    polygon(c, ridge(topRidges[0], H), '#536d80');
    polygon(c, ridge(topRidges[1], H), '#475f71');
    for (let i = 0; i < 4; i++) ellipse(c, 265 + i * 39, 72 + (i % 2) * 22, 71, 6, '#a4b5c023');
    for (const shelf of shelves)
        polygon(
            c,
            shelf.map(([x, y]) => P(x, y)),
            '#263c4c',
        );
    facets.forEach((s, i) =>
        polygon(
            c,
            s.map(([x, y]) => P(x, y)),
            i % 2 ? '#365061' : '#4b6577',
        ),
    );
    for (const [x, y, dx] of [
        [18, 141, 29],
        [46, 223, 16],
        [10, 348, 24],
        [19, 431, 25],
        [592, 138, 28],
        [608, 215, 18],
        [597, 304, 23],
        [594, 402, 22],
    ]) {
        line(c, [P(x, y), P(x + dx, y - 10)], '#90acbb66', 1.4);
    }
    const { left: L, right: R, top: T, bottom: B } = a,
        corner = [
            [L, T],
            [R, T],
            [R, B],
            [L, B],
        ],
        top = corner.map(([x, y]) => project(x, y)),
        bottom = corner.map(([x, y]) => project(x, y, -30));
    polygon(c, [top[1], top[2], bottom[2], bottom[1]], '#405b71', '#314b60', 2);
    polygon(c, [top[2], top[3], bottom[3], bottom[2]], '#314b61', '#233747', 2);
    polygon(c, top, '#526b80', '#294657', 3);
    // Layered slate strata and water seams sit below the physical floor boundary.
    const w = R - L,
        h = B - T;
    for (let i = 0; i < seamFractions.length; i++) {
        const y = T + h * seamFractions[i],
            x = L + w * (i % 3 === 0 ? 0.08 : i % 3 === 1 ? 0.56 : 0.27);
        const dx = Math.min(w * (i % 2 ? 0.33 : 0.52), R - w * 0.08 - x),
            dy = ((i % 3) - 1) * 35;
        line(
            c,
            [project(x, y), project(x + dx * 0.49, y + dy), project(x + dx, y + dy - 8)],
            i % 2 ? '#a6c3d22b' : '#324f624c',
            i % 2 ? 2 : 3,
        );
    }
    const returnY = B - 112;
    polygon(c, [project(L, returnY), project(R, returnY), project(R, B), project(L, B)], '#4a6278');
    line(c, [project(L + 12, returnY), project(R - 12, returnY)], '#aecddd83', 1.7, [4, 9]);
    drawStormRain(c, time);
    ingress();
    const wall = (x1, y1, x2, y2, height, fill) => {
        polygon(
            c,
            [project(x1, y1), project(x2, y2), project(x2, y2, height), project(x1, y1, height)],
            fill,
            '#2d4a5d',
            1.5,
        );
        line(c, [project(x1, y1, height), project(x2, y2, height)], '#bdcfdb', 4);
    };
    wall(L, T, R, T, 38, '#3a546a');
    wall(L, T, L, B, 16, '#637f94');
    wall(R, T, R, B, 16, '#57738a');
    for (const [x, y] of corner) {
        const p = project(x, y, 20);
        ellipse(c, p.x, p.y, 6, 4, '#d0e0e8', '#3b566d', 1.5);
    }
    line(c, [...top, top[0]], '#b2c8d6', 1.4);
}

export function drawStormRain(c, time, shift = { x: 0, y: 0 }) {
    const t = Number.isFinite(time) ? time : 0; // Gameplay time also makes rain stop when paused.
    c.save();
    c.translate(-shift.x, -shift.y);
    c.globalAlpha = 0.25;
    c.beginPath();
    for (let i = 0; i < rain.length; i++) {
        const d = rain[i],
            y = (d.y + t * 137) % H,
            x = (((d.x - y * 0.13) % W) + W) % W,
            len = 5 + (i % 5);
        c.moveTo(x, y);
        c.lineTo(x - 3, y + len);
    }
    c.strokeStyle = '#d2e6ef';
    c.lineWidth = 1.15;
    c.stroke();
    c.restore();
}
