import { ENEMY_TYPES } from './enemies.mjs';
import { PIN_BLAST } from './pin-blast.mjs';
import { LARGE_PIN_FORMATION, PIN_DEPTH, PIN_GAP, pinSlots } from './pin-formation.mjs';
import { reflectorIsActive, reflectorOverlaps } from './terrain.mjs';

export const DUEL_SPAWN_CLEARANCE = PIN_BLAST.trigger * 1.5;
const SPAWN_INSET = 325;
const OFFSETS = [0, 2, -2, 4, -4, 6, -6];
const GRUNT_RADIUS = ENEMY_TYPES.grunt.r;

const distanceSquared = (a, b) => (a.x - b.x) ** 2 + (a.y - b.y) ** 2;

export function planDuelSpawn(game, side, specials) {
    const arena = game.courts[side];
    const { top, bottom } = arena;
    const { boss } = game.players[side];
    const facing = Math.PI / 2;
    const originY = top + SPAWN_INSET;
    const rocks = arena.reflectors.filter(reflectorIsActive);
    const safe = (point) => {
        const { r, x, y } = point;
        const radius = DUEL_SPAWN_CLEARANCE + (r - GRUNT_RADIUS);
        return (
            x - r >= arena.left &&
            x + r <= arena.right &&
            y - r >= top &&
            y + r <= bottom &&
            distanceSquared(boss, point) >= radius ** 2 &&
            rocks.every((rock) => !reflectorOverlaps(point, rock))
        );
    };

    for (const depth of OFFSETS) {
        for (const across of OFFSETS) {
            const x = arena.centerX + across * PIN_GAP;
            const y = originY + depth * PIN_DEPTH;
            const grunts = pinSlots(LARGE_PIN_FORMATION, { x, y, nx: 0, ny: 1 }).map((point) => ({
                ...point,
                kind: 'grunt',
                r: GRUNT_RADIUS,
                facing,
            }));
            if (!grunts.every(safe)) continue;
            const points = [];
            for (let row = top + PIN_GAP; row < bottom; row += PIN_GAP) {
                for (let col = arena.left + PIN_GAP; col < arena.right; col += PIN_GAP) {
                    points.push({ x: col, y: row });
                }
            }
            const flank = { x, y: y - PIN_DEPTH };
            points.sort((a, b) => distanceSquared(a, flank) - distanceSquared(b, flank));
            const roster = [...grunts];
            for (const kind of specials) {
                const r = ENEMY_TYPES[kind].r;
                const position = points.find(
                    (point) =>
                        safe({ ...point, r }) &&
                        roster.every((pin) => distanceSquared(pin, point) >= (r + pin.r + 4) ** 2),
                );
                if (!position) break;
                roster.push({ ...position, r, facing, kind });
            }
            if (roster.length === grunts.length + specials.length) return roster;
        }
    }
    return null;
}
