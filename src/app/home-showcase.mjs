import { createScenario } from '@bloom-gamekit/scenario';
import { CampaignGame } from '../domain/campaign.mjs';
import { STEP_SECONDS, TICK_RATE_HZ } from '../domain/timing.mjs';
import { CAMERA, project } from '../presentation/camera.mjs';
import { expeditionCameraShift, render } from '../presentation/render.mjs';
import { runShowcaseCommand } from './showcase-program.mjs';

const SHOT_MS = 3000;
const WIDE_SHOT = { width: 500, height: 390, duckY: 0.77 };
const RECOVERY_SHOT = { width: 410, height: 320, duckY: 0.69 };
const TIMELINE = [
    { atMs: 700, command: 'straight-roll' },
    { atMs: SHOT_MS, command: 'dash-forward' },
    { atMs: SHOT_MS + 660, command: 'dash-to-ball' },
    { atMs: SHOT_MS + 1300, command: 'dash-to-ball' },
    { atMs: SHOT_MS + 2600, command: 'recovery-roll' },
    { atMs: SHOT_MS * 2, command: 'start-storm' },
    { atMs: SHOT_MS * 2 + 700, command: 'dash-right' },
    { atMs: SHOT_MS * 2 + 1600, command: 'storm-hook' },
];

function renderShot(ctx, game, timeMs) {
    const recovery = timeMs >= SHOT_MS && timeMs < SHOT_MS * 2;
    const shot = recovery ? RECOVERY_SHOT : WIDE_SHOT;
    const zoom = Math.min(ctx.canvas.width / shot.width, ctx.canvas.height / shot.height);
    const width = ctx.canvas.width / zoom;
    const height = ctx.canvas.height / zoom;
    const shift = expeditionCameraShift(game.expedition);
    const duck = project(game.boss.x, game.boss.y);
    const centerX = recovery ? duck.x + shift.x : CAMERA.screenAnchor.x;
    const left = centerX - width / 2;
    const top = duck.y + shift.y - height * shot.duckY;
    ctx.save();
    try {
        ctx.scale(zoom, zoom);
        ctx.translate(-left, -top);
        render(ctx, game, null, { left, top, width, height });
    } finally {
        ctx.restore();
    }
}

export function createHomeShowcase(canvas) {
    const ctx = canvas.getContext('2d');
    return createScenario({
        definition: {
            seed: 42,
            tickRate: TICK_RATE_HZ,
            endTick: (SHOT_MS * 3 * TICK_RATE_HZ) / 1000,
            loop: true,
            timeline: TIMELINE,
        },
        createRun({ seed }) {
            let game;
            const session = {
                game: () => game,
                start(route) {
                    game = new CampaignGame(seed, {
                        route,
                        unlocks: ['storm'],
                        shotSeed: seed,
                        expedition: true,
                    });
                },
            };
            session.start('grove');
            return {
                step({ events }) {
                    for (const event of events) runShowcaseCommand(event.command, session);
                    game.step(STEP_SECONDS);
                },
                render({ timeMs }) {
                    renderShot(ctx, game, timeMs);
                },
                dispose() {},
            };
        },
    });
}
