import { AudioPlayer } from '@bloom-gamekit/audio';

const MUSIC_URL = new URL('../../assets/audio/head-in-the-sand.ogg', import.meta.url);
const MUSIC_LEVELS = { home: 0.75, playing: 0.4, paused: 0.2 };
const MUSIC_FADE_MS = 400;
const tone = (hz, end, ms, gain, type = 'triangle', delay = 0) => ({
    kind: 'tone',
    hz,
    end,
    ms,
    gain,
    type,
    delay,
});
const noise = (hz, ms, gain, delay = 0) => ({ kind: 'noise', hz, ms, gain, delay });

const MIX = {
    volume: 0.75,
    headroom: 0.35,
    maxVoices: 8,
    categories: {
        action: { volume: 0.8, max: 2, gapMs: 35, priority: 2 },
        impact: { volume: 1, max: 4, gapMs: 32, priority: 3 },
        signal: { volume: 0.85, max: 2, gapMs: 75, priority: 5 },
        music: { volume: 0.8, max: 1, gapMs: 0, priority: 0 },
    },
    sounds: {
        dash: {
            category: 'action',
            layers: [noise(2100, 70, 0.21), tone(330, 145, 78, 0.15, 'sine')],
        },
        release: {
            category: 'action',
            layers: [tone(205, 69, 103, 0.38), noise(630, 75, 0.21)],
        },
        pinHit: {
            category: 'impact',
            priority: 4,
            layers: [noise(3500, 28, 0.58), tone(360, 138, 64, 0.56)],
        },
        pinChain: {
            category: 'impact',
            layers: [noise(2750, 24, 0.42), tone(530, 310, 54, 0.3), noise(1950, 18, 0.2, 24)],
        },
        pinBlock: {
            category: 'impact',
            layers: [noise(4600, 25, 0.33), tone(1250, 960, 115, 0.35, 'sine')],
        },
        pickup: {
            category: 'signal',
            layers: [tone(440, 440, 70, 0.27), tone(660, 660, 88, 0.21, 'sine', 48)],
        },
        duckHit: {
            category: 'impact',
            gapMs: 0,
            priority: 6,
            layers: [noise(550, 65, 0.4), tone(175, 60, 140, 0.62, 'sine')],
        },
        clear: {
            category: 'signal',
            gapMs: 0,
            priority: 7,
            layers: [
                tone(392, 392, 105, 0.3),
                tone(494, 494, 129, 0.27, 'triangle', 65),
                tone(587, 587, 220, 0.26, 'sine', 130),
            ],
        },
    },
    beds: {
        music: {
            category: 'music',
            layers: [{ kind: 'buffer', bufferId: 'music', gain: 1, lowCutHz: 80 }],
        },
    },
};

export function createBowlingAudio() {
    const player = new AudioPlayer(MIX);
    const preload = new AbortController();
    let music = null;
    let musicReady = false;
    let scene = 'home';

    function startMusic() {
        if (musicReady && !music && player.context?.state === 'running') {
            music = player.startBed('music', { level: MUSIC_LEVELS[scene], fadeMs: MUSIC_FADE_MS });
        }
    }

    // Decode from boot, independently of the user's gesture to start playback.
    async function preloadMusic() {
        const response = await fetch(MUSIC_URL, { signal: preload.signal });
        if (!response.ok) throw new Error(`Music HTTP ${response.status}`);
        const decoder = new OfflineAudioContext(1, 1, 44100);
        const buffer = await decoder.decodeAudioData(await response.arrayBuffer());
        if (preload.signal.aborted) return;
        player.setBuffer('music', buffer);
        musicReady = true;
        startMusic();
    }

    const ready = preloadMusic().catch((error) => {
        if (!preload.signal.aborted) {
            console.warn('Duck Bowling music could not load', error);
        }
    });

    return {
        ready,
        async unlock() {
            const unlocked = await player.unlock();
            if (unlocked) startMusic();
            return unlocked;
        },
        setBackground(nextScene) {
            if (scene === nextScene) return;
            scene = nextScene;
            music?.setLevel(MUSIC_LEVELS[scene], MUSIC_FADE_MS);
        },
        play: (id, strength) => player.play(id, strength),
        get muted() {
            return player.muted;
        },
        setMuted: (muted) => player.setMuted(muted),
        dispose() {
            preload.abort();
            return player.dispose();
        },
    };
}
