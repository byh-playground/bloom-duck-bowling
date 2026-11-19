import { mapDefinitions } from '../content/index.mjs';

export const DEFAULT_ROUTE = 'grove';

function prepareRoute(definition) {
    const { left, right, top, bottom } = definition.arena;
    const width = right - left;
    const height = bottom - top;
    const centerX = left + width / 2;
    const centerY = top + height / 2;
    const { id, unlockAt, trail, widths, depths, rackEntrances, home } = definition;
    if (
        !(Number.isFinite(width) && width > 0 && Number.isFinite(height) && height > 0) ||
        !trail.length ||
        !widths.length ||
        !depths.length ||
        !rackEntrances.length
    ) {
        throw new Error('Invalid arena or empty route layout: ' + id);
    }
    if (unlockAt !== undefined && (!Number.isSafeInteger(unlockAt) || unlockAt < 1)) {
        throw new Error('Invalid map unlock threshold: ' + id);
    }
    return Object.freeze({
        ...definition,
        unlock: unlockAt === undefined ? undefined : id,
        card: Object.freeze({
            ...definition.card,
            colors: Object.freeze(definition.card.colors ?? {}),
        }),
        arena: Object.freeze({ ...definition.arena, width, height, centerX, centerY }),
        home: Object.freeze({ x: centerX, ...home }),
        trail: Object.freeze(trail.map(Object.freeze)),
        widths: Object.freeze(widths),
        depths: Object.freeze(depths),
        pinKinds: Object.freeze(definition.pinKinds ?? {}),
        rackEntrances: Object.freeze(
            rackEntrances.map(({ offsetX = 0, ...entry }) =>
                Object.freeze({ x: centerX + offsetX, ...entry }),
            ),
        ),
    });
}

export const ROUTES = Object.freeze(
    mapDefinitions
        .map(prepareRoute)
        .sort((a, b) => Number(b.id === DEFAULT_ROUTE) - Number(a.id === DEFAULT_ROUTE)),
);
const byId = new Map(ROUTES.map((route) => [route.id, route]));
const defaultRoute = byId.get(DEFAULT_ROUTE);
if (byId.size !== ROUTES.length || !defaultRoute || defaultRoute.unlock) {
    throw new Error('Map IDs must be unique and the default map must be playable');
}

export const ARENA = defaultRoute.arena;
export const MAX_RECORD_STAGE = Math.max(8, ...ROUTES.map(({ trail }) => trail.length));
export const routeDefinition = (id) => byId.get(id) ?? defaultRoute;
export const arenaForRoute = (id) => routeDefinition(id).arena;

export function mapUnlocksForStage(bestStage) {
    return ROUTES.filter((route) => route.unlock && bestStage >= route.unlockAt).map(
        (route) => route.unlock,
    );
}

export function isRouteUnlocked(route, unlocks) {
    return !route.unlock || (Array.isArray(unlocks) && unlocks.includes(route.unlock));
}

export function unlockedRoute(id, unlocks) {
    const route = routeDefinition(id);
    return isRouteUnlocked(route, unlocks) ? route : defaultRoute;
}

// Each entry anchor is the head pin; the remaining rows form behind it.
export function rackEntrance(packet, route = DEFAULT_ROUTE) {
    const { rackEntrances } = routeDefinition(route);
    return { ...rackEntrances[packet % rackEntrances.length] };
}
