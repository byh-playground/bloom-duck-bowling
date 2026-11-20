import { render } from './render.mjs';

export const DUEL_TEAMS = Object.freeze({
    local: Object.freeze({ ink: '#07544a', light: '#66f2c6' }),
    opponent: Object.freeze({ ink: '#7d331a', light: '#ff904b' }),
});
// Both courts have their own actors at the same local world coordinates.
export function renderDuel(context, game, viewerSide, aim = null, courtSide = viewerSide) {
    const player = game.players[courtSide];
    const isLocal = courtSide === viewerSide;
    const onCourt = (entity) => entity.court === courtSide;
    render(
        context,
        {
            arena: game.courts[courtSide],
            time: game.time,
            route: game.route,
            controlMode: 'manual',
            boss: player.boss,
            balls: player.balls,
            selectedType: player.selectedType,
            enemies: game.pins.filter(onCourt),
            enemyProjectiles: game.projectiles.filter(onCourt),
            effects: game.effects.filter(onCourt),
            duel: {
                label: isLocal ? '나' : '상대',
                team: isLocal ? DUEL_TEAMS.local : DUEL_TEAMS.opponent,
                senderTeam: isLocal ? DUEL_TEAMS.opponent : DUEL_TEAMS.local,
                ended: game.result !== null,
            },
        },
        isLocal ? aim : null,
    );
}
