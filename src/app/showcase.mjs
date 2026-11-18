import { installShowcase } from '@bloom-gamekit/scenario';
import { SHOWCASE_DURATION_MS, SHOWCASE_TIMELINE } from './showcase-program.mjs';

// This is the fixed timeline rate used by GameKit's installShowcase host.
const SHOWCASE_FRAME_HZ = 30;
const FRAME_MS = 1000 / SHOWCASE_FRAME_HZ;
const FRAME_PREFIX = 'frame:';

export function installBowlingShowcase() {
    const frames = Array.from(
        { length: Math.ceil((SHOWCASE_DURATION_MS * SHOWCASE_FRAME_HZ) / 1000) + 1 },
        (_, tick) => ({ tick, action: 'custom', name: FRAME_PREFIX + tick }),
    );
    const player = installShowcase({
        title: '덕 볼링',
        locale: 'ko',
        launcher: '#play',
        playSelector: '#play',
        ready: (win) => Boolean(win.duckBowlingShowcase),
        durationMs: SHOWCASE_DURATION_MS,
        timeline: [...SHOWCASE_TIMELINE, ...frames],
        custom(name, win) {
            if (name.startsWith(FRAME_PREFIX)) {
                win.duckBowlingShowcase.frame(Number(name.slice(FRAME_PREFIX.length)) * FRAME_MS);
            } else {
                win.duckBowlingShowcase.command(name);
            }
        },
    });
    window.addEventListener('pagehide', (event) => {
        if (!event.persisted) player?.dispose();
    });
}
