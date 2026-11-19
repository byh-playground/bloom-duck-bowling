import { cameraDepth, project } from './camera.mjs';

const blend = (from, to, amount) => ({
    x: from.x + (to.x - from.x) * amount,
    y: from.y + (to.y - from.y) * amount,
});

// The west edge stays flush with the bank face. The short ends are chipped
// and the opposite edge is broken into uneven shoulders.
const FOOTPRINT = [
    [0.06, 0],
    [0.91, 0],
    [1, 0.3],
    [0.95, 0.78],
    [0.79, 1],
    [0.51, 0.91],
    [0.3, 1],
    [0.12, 0.81],
    [0, 0.45],
];
const SHOULDERS = [
    [0.13, 0.15, 0.26],
    [0.86, 0.075, 0.42],
    [0.91, 0.28, 0.29],
    [0.84, 0.66, 0.47],
    [0.73, 0.86, 0.58],
    [0.5, 0.79, 0.74],
    [0.32, 0.85, 0.68],
    [0.19, 0.69, 0.43],
    [0.09, 0.42, 0.37],
];
const SLATE = [
    '#74868c',
    '#60737d',
    '#546774',
    '#607582',
    '#637784',
    '#74858a',
    '#87958f',
    '#73847e',
    '#657782',
];

export function drawReflector(context, rock, { polygon, line }) {
    const [rightStart, rightEnd, leftEnd, leftStart] = rock.corners;
    const at = (along, across) =>
        blend(blend(leftStart, leftEnd, along), blend(rightStart, rightEnd, along), across);
    const raised = (along, across, rise = 0) => {
        const { x, y } = at(along, across);
        return project(x, y, rock.height * rise);
    };
    const groundWorld = FOOTPRINT.map(([along, across]) => at(along, across));
    const base = groundWorld.map(({ x, y }) => project(x, y));
    const rim = SHOULDERS.map(([along, across, rise]) => raised(along, across, rise));
    const ridge = raised(0.43, 0.59, 1);
    const centerDepth = cameraDepth(rock.x, rock.y);

    context.save();
    context.lineJoin = 'round';
    context.lineCap = 'round';
    polygon(
        context,
        base.map(({ x, y }) => ({ x: x + 5, y: y + 5 })),
        '#1a2a37a0',
    );
    polygon(context, base, '#364955');
    for (let i = 0; i < base.length; i++) {
        const next = (i + 1) % base.length;
        const edge = blend(groundWorld[i], groundWorld[next], 0.5);
        if (cameraDepth(edge.x, edge.y) > centerDepth) {
            polygon(context, [base[i], base[next], rim[next], rim[i]], '#485d68', '#394d5a', 1);
        }
    }

    for (let i = 0; i < rim.length; i++) {
        const next = (i + 1) % rim.length;
        polygon(context, [rim[i], rim[next], ridge], SLATE[i]);
    }
    polygon(
        context,
        [rim[8], rim[7], blend(rim[7], ridge, 0.48), blend(rim[8], ridge, 0.64)],
        '#8d9c9080',
    );
    const split = blend(rim[1], ridge, 0.28);
    const bend = blend(rim[4], ridge, 0.78);
    line(context, [split, bend, blend(rim[6], ridge, 0.36)], '#3c515e', 1.2);
    line(context, [bend, blend(rim[5], ridge, 0.49)], '#465b67', 0.95);
    line(context, [blend(rim[7], ridge, 0.3), ridge], '#a7aca18c', 1.4);
    context.restore();
}
