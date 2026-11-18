const bootScreen = document.getElementById('boot-screen');
const progress = document.getElementById('boot-progress');
const status = document.getElementById('boot-status');
const retry = document.getElementById('boot-retry');
const home = document.getElementById('home-screen');
const labels = { modules: '게임 파일', art: '화면 준비', audio: '소리 준비' };
const loadError = '게임을 불러오지 못했어요.';
const showcaseDemo = new URLSearchParams(location.search).get('showcaseDemo') === '1';
if (showcaseDemo) document.documentElement.dataset.showcaseDemo = 'true';

let boot;
let unbind;
try {
    const { createBoot, bindBootProgress } = await import('@bloom-gamekit/boot');
    boot = createBoot({
        stages: [
            { id: 'modules', weight: 2 },
            { id: 'art', weight: 1 },
            ...(showcaseDemo ? [] : [{ id: 'audio', weight: 1 }]),
        ],
    });
    unbind = bindBootProgress(boot, {
        progress,
        label: status,
        text: ({ stage, overall, failed }) =>
            failed ? loadError : stage ? `${labels[stage]} · ${Math.round(overall * 100)}%` : null,
    });

    boot.begin('modules', 1);
    const { startBowling } = await import('./app.mjs');
    boot.advance('modules');

    const images = [document.getElementById('boot-mark'), document.getElementById('home-court')];
    boot.begin('art', images.length);
    await Promise.all(
        images.map(async (image) => {
            await image.decode();
            boot.advance('art');
        }),
    );

    if (!showcaseDemo) boot.begin('audio', 1);
    const { audioReady, showcase } = startBowling({
        showcaseDemo,
        seed: showcaseDemo ? 42 : undefined,
    });
    if (showcase) {
        const { runShowcaseCommand } = await import('./showcase-program.mjs');
        window.duckBowlingShowcase = {
            frame: showcase.frame,
            command: (name) => runShowcaseCommand(name, showcase),
        };
    } else {
        await audioReady;
        boot.advance('audio');
    }
    boot.complete();

    home.append(document.getElementById('product-version'));
    bootScreen.hidden = true;
    home.hidden = false;

    if (!showcaseDemo) {
        void import('./home-motion.mjs')
            .then(({ installHomeMotion }) => installHomeMotion(home))
            .catch((error) => console.warn('Duck Bowling title showcase could not load', error));
        void import('./showcase.mjs')
            .then(({ installBowlingShowcase }) => installBowlingShowcase())
            .catch((error) => console.warn('Duck Bowling showcase could not load', error));
    }
} catch (error) {
    if (boot) boot.fail(error);
    else status.textContent = loadError;
    progress.hidden = true;
    retry.hidden = false;
    console.error('Duck Bowling could not start', error);
} finally {
    unbind?.();
}
