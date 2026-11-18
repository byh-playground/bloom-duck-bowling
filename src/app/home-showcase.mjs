import { createScenario } from '@bloom-gamekit/scenario';
import { CampaignGame } from '../domain/campaign.mjs';
import { STEP_SECONDS, TICK_RATE_HZ } from '../domain/timing.mjs';
import { CAMERA, project } from '../presentation/camera.mjs';
import { expeditionCameraShift, render } from '../presentation/render.mjs';
import { runShowcaseCommand } from './showcase-program.mjs';

const SHOT_MS = 3000;
const RECOVERY_ZOOM = 1.22;
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

const clamp = (value, max) => Math.max(0, Math.min(value, max));

function renderShot(ctx, game, timeMs) {
    const recovery = timeMs >= SHOT_MS && timeMs < SHOT_MS * 2;
    const zoom = recovery ? RECOVERY_ZOOM : 1;
    const width = ctx.canvas.width / zoom;
    const height = ctx.canvas.height / zoom;
    const shift = expeditionCameraShift(game.expedition);
    const duck = project(game.boss.x, game.boss.y);
    const left = clamp(
        recovery ? duck.x + shift.x - width * 0.52 : (CAMERA.width - width) * 0.5,
        CAMERA.width - width,
    );
    const top = clamp(
        duck.y + shift.y - (recovery ? height * 0.72 : height - 24),
        CAMERA.height - height,
    );
    ctx.save();
    try {
        ctx.scale(zoom, zoom);
        ctx.translate(-left, -top);
        render(ctx, game);
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
