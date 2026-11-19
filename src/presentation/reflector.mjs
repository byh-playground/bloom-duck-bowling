import { cameraDepth, project } from './camera.mjs';

const blend = (from, to, amount) => ({
    x: from.x + (to.x - from.x) * amount,
    y: from.y + (to.y - from.y) * amount,
});

const LIP = [0.16, 0.25, 0.1, 0.2];
const RIM_HEIGHT = [0.76, 0.61, 0.72, 0.8];
const TOP_HEIGHT = [0.94, 0.89, 1, 0.98];
const FACET = ['#8196a5', '#677e90', '#788f9e', '#91a5ae'];

export function drawReflector(context, rock, { polygon, line }) {
    const ground = rock.corners.map(({ x, y }) => project(x, y));
    const shoulder = rock.corners.map(({ x, y }, i) => project(x, y, rock.height * RIM_HEIGHT[i]));
    const crown = rock.corners.map((corner, index) => {
        const inset = blend(corner, rock, LIP[index]);
        return project(inset.x, inset.y, rock.height * TOP_HEIGHT[index]);
    });
    const center = project(rock.x, rock.y, rock.height);
    const centerDepth = cameraDepth(rock.x, rock.y);
    context.save();
    context.lineJoin = 'round';
    context.lineCap = 'round';

    polygon(
        context,
        ground.map(({ x, y }) => ({ x: x + 5, y: y + 6 })),
        '#1d303b88',
    );

    for (let i = 0; i < ground.length; i++) {
        const next = (i + 1) % ground.length;
        const edge = blend(rock.corners[i], rock.corners[next], 0.5);
        if (cameraDepth(edge.x, edge.y) <= centerDepth) continue;
        const face = [ground[i], ground[next], shoulder[next], shoulder[i]];
        polygon(context, face, '#536e82', '#344f63', 1.5);
        line(
            context,
            [
                blend(ground[i], shoulder[i], 0.26),
                blend(
                    blend(ground[i], ground[next], 0.43),
                    blend(shoulder[i], shoulder[next], 0.43),
                    0.51,
                ),
                blend(ground[next], shoulder[next], 0.31),
            ],
            '#849cad',
            1.4,
        );
        line(context, [ground[i], ground[next]], '#a2b9c3', 1.5);
    }

    for (let i = 0; i < shoulder.length; i++) {
        const next = (i + 1) % shoulder.length;
        polygon(context, [shoulder[i], shoulder[next], crown[next], crown[i]], FACET[i]);
    }
    polygon(context, crown, '#8d9fa9', '#637f91', 1);
    polygon(
        context,
        [blend(crown[0], crown[1], 0.23), blend(crown[1], crown[2], 0.35), center, crown[0]],
        '#a0b1b8',
    );
    line(
        context,
        [
            blend(crown[3], center, 0.27),
            blend(center, crown[2], 0.23),
            blend(crown[1], crown[2], 0.64),
        ],
        '#657f92',
        1.1,
    );
    line(context, [crown[0], blend(crown[0], crown[1], 0.72)], '#c2d1d2', 1.5);
    context.restore();
}
