import { project } from './camera.mjs';

const blend = (from, to, amount) => ({
    x: from.x + (to.x - from.x) * amount,
    y: from.y + (to.y - from.y) * amount,
});

// Coordinates are fractions of the long side, short side, and height. The two
// left anchors sit on the bank face, while the rest taper at different rates.
const OUTLINE = [
    [0.11, 0.12, 0.28],
    [0.21, 0.27, 0.87],
    [0.25, 0.62, 0.96],
    [0.35, 0.9, 0.79],
    [0.55, 1, 0.39],
    [0.87, 0.91, 0.14],
    [0.98, 0.6, 0],
    [0.93, 0.19, 0.015],
    [0.78, 0, 0.13],
    [0.31, 0, 0.32],
];

function roundedPath(context, points) {
    const start = blend(points.at(-1), points[0], 0.82);
    context.beginPath();
    context.moveTo(start.x, start.y);
    for (const [index, point] of points.entries()) {
        const next = points[(index + 1) % points.length];
        const exit = blend(point, next, 0.18);
        context.quadraticCurveTo(point.x, point.y, exit.x, exit.y);
        const entry = blend(point, next, 0.82);
        context.lineTo(entry.x, entry.y);
    }
    context.closePath();
}

export function drawReflector(context, rock, { polygon, line }) {
    const [rightStart, rightEnd, leftEnd, leftStart] = rock.corners;
    const at = (along, across, rise = 0) => {
        const point = blend(
            blend(leftStart, leftEnd, along),
            blend(rightStart, rightEnd, along),
            across,
        );
        return project(point.x, point.y, rock.height * rise);
    };
    const outline = OUTLINE.map((point) => at(...point));
    const north = at(0.38, 0.46);
    const south = at(1, 0.56);
    const crown = at(0.24, 0.47, 0.94);
    const shadow = at(0.74, 0.59);
    const spanX = outline.map(({ x }) => x);
    const shadowWidth = (Math.max(...spanX) - Math.min(...spanX)) * 0.47;

    context.save();
    context.lineCap = 'round';
    context.fillStyle = '#1e303bd0';
    context.beginPath();
    context.ellipse(
        shadow.x + 2,
        shadow.y + 3,
        shadowWidth,
        Math.abs(south.y - north.y) * 0.47,
        -0.15,
        0,
        2 * Math.PI,
    );
    context.fill();

    const stone = context.createLinearGradient(crown.x - 10, crown.y, south.x + 8, south.y);
    stone.addColorStop(0, '#aeafa0');
    stone.addColorStop(0.49, '#798281');
    stone.addColorStop(0.78, '#626e70');
    stone.addColorStop(1, '#444e55');
    roundedPath(context, outline);
    context.fillStyle = stone;
    context.fill();
    context.strokeStyle = '#334754';
    context.lineWidth = 1.6;
    context.stroke();
    context.clip();

    const ledge = at(0.5, 0.15, 0.51);
    const split = at(0.51, 0.47, 0.56);
    const slope = at(0.68, 0.88, 0.39);
    polygon(
        context,
        [outline[0], outline[1], crown, at(0.36, 0.64, 0.79), split, ledge],
        '#b4b3a466',
    );
    polygon(
        context,
        [crown, outline[2], outline[3], outline[4], slope, split, at(0.36, 0.64, 0.79)],
        '#5a646c48',
    );
    polygon(
        context,
        [ledge, split, slope, outline[5], outline[6], outline[7], at(0.73, 0.34, 0.16), outline[8]],
        '#47545b46',
    );
    const crack = at(0.68, 0.62, 0.45);
    line(context, [ledge, split, crack, at(0.73, 0.86, 0.28)], '#515d62', 1);
    line(context, [crack, at(0.79, 0.55, 0.25)], '#535c60', 0.9);
    context.fillStyle = '#b1ad9677';
    for (const [along, across, rise, size] of [
        [0.33, 0.34, 0.77, 2.8],
        [0.37, 0.42, 0.73, 1.6],
        [0.51, 0.77, 0.55, 2.9],
        [0.54, 0.79, 0.51, 1.7],
    ]) {
        const spot = at(along, across, rise);
        context.beginPath();
        context.ellipse(spot.x, spot.y, size, size * 0.48, -0.38, 0, 2 * Math.PI);
        context.fill();
    }
    context.restore();
}

const SHARDS = [
    { angle: 0.17, reach: 1.28, lift: 1, size: 0.29, fill: '#7b8887' },
    { angle: 0.93, reach: 0.87, lift: 0.81, size: 0.21, fill: '#8d9184' },
    { angle: 1.93, reach: 1.15, lift: 1.14, size: 0.28, fill: '#a7ab9a' },
    { angle: 2.66, reach: 1.37, lift: 0.73, size: 0.18, fill: '#687877' },
    { angle: 3.46, reach: 0.94, lift: 1.39, size: 0.3, fill: '#85908a' },
    { angle: 4.51, reach: 1.13, lift: 1.08, size: 0.25, fill: '#818b84' },
    { angle: 5.62, reach: 1.2, lift: 1.2, size: 0.19, fill: '#acac99' },
];

const SHARD_POINTS = [
    [0, 1.06],
    [1.35, 0.78],
    [2.71, 1.03],
    [3.52, 0.63],
    [5.05, 0.92],
];

export function drawReflectorBreak(context, effect, { polygon }) {
    const t = Math.max(0, Math.min(1, effect.age / effect.life));
    const drift = 1 - (1 - t) ** 2;
    const lift = 4 * t * (1 - t);
    const ground = project(effect.x, effect.y);
    const size = effect.size;
    context.save();

    context.globalAlpha = 0.24 * (1 - t);
    context.fillStyle = '#c4c6b5';
    for (const [offset, radius] of [
        [-0.28, 0.58],
        [0.31, 0.47],
    ]) {
        const spread = size * radius * (0.65 + drift);
        context.beginPath();
        context.ellipse(
            ground.x + offset * spread,
            ground.y - size * t * 0.15,
            spread,
            spread * 0.48,
            0,
            0,
            2 * Math.PI,
        );
        context.fill();
    }

    context.globalAlpha = Math.min(1, (1 - t) * 2.4);
    for (const shard of SHARDS) {
        const distance = size * shard.reach * (0.22 + drift);
        const point = project(
            effect.x + Math.cos(shard.angle) * distance,
            effect.y + Math.sin(shard.angle) * distance,
            effect.z * (1 - t) + size * shard.lift * lift,
        );
        const edge = size * shard.size * (1 - t * 0.24);
        const turn = shard.angle + t * 2;
        const corners = SHARD_POINTS.map(([angle, reach]) => ({
            x: point.x + Math.cos(turn + angle) * edge * reach,
            y: point.y + Math.sin(turn + angle) * edge * reach * 0.8,
        }));
        polygon(context, corners, shard.fill, '#3e535d', 1);
    }
    context.restore();
}
