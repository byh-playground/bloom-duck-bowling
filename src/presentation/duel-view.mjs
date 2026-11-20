import { render } from './render.mjs';

export const DUEL_TEAMS = Object.freeze({
    local: Object.freeze({ ink: '#07544a', light: '#66f2c6', shape: 'circle' }),
    opponent: Object.freeze({ ink: '#7d331a', light: '#ff904b', shape: 'diamond' }),
});
const teamsBySide = [
    [DUEL_TEAMS.local, DUEL_TEAMS.opponent],
    [DUEL_TEAMS.opponent, DUEL_TEAMS.local],
];

// A read-only presentation view. Local ammo, aim and recovery remain owner-specific.
export function renderDuel(context, game, side, aim = null) {
    const local = game.players[side];
    render(
        context,
        {
            arena: game.arena,
            time: game.time,
            route: game.route,
            controlMode: 'manual',
            boss: local.boss,
            balls: local.balls,
            selectedType: local.selectedType,
            enemies: game.pins,
            enemyProjectiles: game.projectiles,
            effects: game.effects,
            duel: {
                players: game.players,
                side,
                teams: teamsBySide[side],
                centerLane: game.centerLane,
                ended: game.result !== null,
            },
        },
        aim,
    );
}
