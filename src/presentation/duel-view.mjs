import { render } from './render.mjs';

export const DUEL_TEAMS = Object.freeze([
    Object.freeze({ ink: '#146352', light: '#9fe4cf' }),
    Object.freeze({ ink: '#974260', light: '#f5b6ce' }),
]);

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
            duel: { players: game.players, side, teams: DUEL_TEAMS, centerLane: game.centerLane },
        },
        aim,
    );
}
