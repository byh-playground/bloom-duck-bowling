import { bowlerDefinitions } from '../content/index.mjs';

export const DEFAULT_BOWLER = 'duck';
const base = bowlerDefinitions.find((definition) => definition.id === DEFAULT_BOWLER);
if (!base) throw new Error('Default bowler definition is missing');

function freezeBowler({ id, label, radius = base.radius, palette = {}, draw }) {
    if (
        !id ||
        typeof label !== 'string' ||
        !label.trim() ||
        !Number.isFinite(radius) ||
        radius <= 0
    ) {
        throw new TypeError('Invalid bowler definition: ' + id);
    }

    if (draw !== undefined && typeof draw !== 'function') {
        throw new TypeError('Invalid bowler renderer: ' + id);
    }

    const colors = Object.fromEntries(
        Object.entries(base.palette).map(([part, defaults]) => [
            part,
            Object.freeze({ ...defaults, ...palette[part] }),
        ]),
    );
    return Object.freeze({ id, label, radius, palette: Object.freeze(colors), draw });
}

export const BOWLERS = Object.freeze(bowlerDefinitions.map(freezeBowler));
const byId = new Map(BOWLERS.map((bowler) => [bowler.id, bowler]));
if (byId.size !== BOWLERS.length) throw new Error('Duplicate bowler definition ID');

export function bowlerDefinition(id = DEFAULT_BOWLER) {
    return byId.get(id) ?? byId.get(DEFAULT_BOWLER);
}
