import { createLoop } from '@bloom-gamekit/simloop';
import { createDuelBot } from '../domain/duel-bot.mjs';
import { DuelGame } from '../domain/duel.mjs';
import { MAX_FRAME_STEPS, TICK_RATE_HZ } from '../domain/timing.mjs';

export function openPracticeDuel({ onFrame, onResult, onStatus }) {
    const game = new DuelGame(crypto.getRandomValues(new Uint32Array(1))[0]);
    const bot = createDuelBot();
    const idle = new Uint8Array(0);
    const advanced = { status: 'advanced' };
    let move = { moveX: 0, moveY: 0 };
    let dash = null;
    let shot = null;
    function clearInput() {
        move = { moveX: 0, moveY: 0 };
        dash = null;
        shot = null;
    }
    const loop = createLoop({
        session: {
            profile: { tickRate: TICK_RATE_HZ, maxCatchupSteps: MAX_FRAME_STEPS },
            pace: 1,
            poll() {},
            releaseInput: clearInput,
            advance() {
                game.step([{ ...(dash ?? move), shot }, bot(game, 1)]);
                dash = null;
                shot = null;
                return advanced;
            },
        },
        getInput: () => idle,
        canAdvance: () => !document.hidden && game.result === null,
        onInputRelease: clearInput,
        onError(error) {
            loop.stop();
            onStatus('failed', error);
        },
        render() {
            onFrame({ game, side: 0, confirmedTick: game.tick - 1 });
            if (game.result !== null) {
                onResult(game.result);
                loop.stop();
            }
        },
    });
    loop.start();
    return {
        opened: Promise.resolve(),
        close() {
            clearInput();
            loop.stop();
        },
        setMove(x, y) {
            move = { moveX: x, moveY: y };
        },
        dash(x, y) {
            dash ??= { moveX: x, moveY: y };
        },
        throw(vx, vy, spin) {
            shot ??= { vx, vy, spin };
        },
    };
}
