// Shared physical bounds; the portrait camera is fixed and does not affect world movement.
export const ARENA = Object.freeze({
    left: -80,
    right: 680,
    top: 0,
    bottom: 1150,
    width: 760,
    height: 1150,
    centerX: 300,
    centerY: 575,
});
export const DUCK_HOME = Object.freeze({ x: 300, y: 895, ballY: 1055 });
const stormEdges = { left: 10, right: 590, top: -20, bottom: 1170 };
export const STORM_ARENA = Object.freeze({
    ...stormEdges,
    enclosedPins: true,
    width: stormEdges.right - stormEdges.left,
    height: stormEdges.bottom - stormEdges.top,
    centerX: (stormEdges.left + stormEdges.right) / 2,
    centerY: (stormEdges.top + stormEdges.bottom) / 2,
});
const STORM_HOME = Object.freeze({ x: STORM_ARENA.centerX, y: 920, ballY: 1080 });
const GROVE_TRAIL = Object.freeze([
    { title: '숲 입구', decor: 'trailhead', packets: 2, stage: 0 },
    { title: '자작나무 길', decor: 'birches', packets: 2, stage: 1 },
    { title: '고사리 골짜기', decor: 'ferns', packets: 3, stage: 2 },
    { title: '묵은 숲의 문', decor: 'old-woods', packets: 3, stage: 3 },
    { title: '숲의 심장', decor: 'forest-heart', packets: 3, stage: 7 },
]);
const STORM_TRAIL = Object.freeze([
    { title: '폭풍 협곡 입구', decor: 'ravine', packets: 2, stage: 0 },
    { title: '빗물 굽이', decor: 'rainbend', packets: 2, stage: 1 },
    { title: '번개 골짜기', decor: 'thunderpass', packets: 3, stage: 2 },
    { title: '폭풍의 문', decor: 'storm-gate', packets: 3, stage: 3 },
    { title: '폭풍의 눈', decor: 'storm-eye', packets: 3, stage: 7 },
]);

const ROUTES = Object.freeze(
    [
        {
            id: 'grove',
            label: '숲길',
            landscape: 'forest',
            arena: ARENA,
            home: DUCK_HOME,
            trail: GROVE_TRAIL,
            widths: [700, 735, 715, 740],
            depths: [900, 830, 930, 875],
            pinKinds: {},
            rackEntrances: [
                { x: ARENA.centerX, y: 425, nx: 0, ny: 1, lane: 'middle' },
                { x: ARENA.centerX - 240, y: 238, nx: 0.6, ny: 0.8, lane: 'left' },
                { x: ARENA.centerX + 240, y: 168, nx: -0.6, ny: 0.8, lane: 'right' },
            ],
        },
        {
            id: 'storm',
            label: '폭풍 길',
            landscape: 'storm',
            unlock: 'storm',
            arena: STORM_ARENA,
            home: STORM_HOME,
            trail: STORM_TRAIL,
            widths: [525, 565, 540, 555],
            depths: [905, 855, 945, 885],
            pinKinds: { shield: 'bomb', bomb: 'shield' },
            rackEntrances: [
                { x: STORM_ARENA.centerX, y: 440, nx: 0, ny: 1, lane: 'middle' },
                { x: STORM_ARENA.centerX + 165, y: 270, nx: -0.6, ny: 0.8, lane: 'right' },
                { x: STORM_ARENA.centerX - 165, y: 170, nx: 0.6, ny: 0.8, lane: 'left' },
            ],
        },
    ].map((route) =>
        Object.freeze({
            ...route,
            trail: Object.freeze(route.trail.map(Object.freeze)),
            widths: Object.freeze(route.widths),
            depths: Object.freeze(route.depths),
            pinKinds: Object.freeze(route.pinKinds),
            rackEntrances: Object.freeze(route.rackEntrances.map(Object.freeze)),
        }),
    ),
);

export { ROUTES };
export const routeDefinition = (id) => ROUTES.find((route) => route.id === id) ?? ROUTES[0];
export const arenaForRoute = (id) => routeDefinition(id).arena;
export function unlockedRoute(id, unlocks) {
    const DEFINITION = routeDefinition(id);
    return !DEFINITION.unlock || (Array.isArray(unlocks) && unlocks.includes(DEFINITION.unlock))
        ? DEFINITION
        : ROUTES[0];
}
// Each entry anchor is the head pin; the remaining rows form behind it.
export function rackEntrance(packet, route = 'grove') {
    return { ...routeDefinition(route).rackEntrances[packet % 3] };
}
