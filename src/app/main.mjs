const bootScreen = document.getElementById('boot-screen');
const progress = document.getElementById('boot-progress');
const status = document.getElementById('boot-status');
const retry = document.getElementById('boot-retry');
const home = document.getElementById('home-screen');
const labels = { modules: '게임 파일', art: '화면 준비', audio: '소리 준비' };
const loadError = '게임을 불러오지 못했어요.';

let boot;
let unbind;
try {
    const { createBoot, bindBootProgress } = await import('@bloom-gamekit/boot');
    boot = createBoot({
        stages: [
            { id: 'modules', weight: 2 },
            { id: 'art', weight: 1 },
            { id: 'audio', weight: 1 },
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

    boot.begin('audio', 1);
    const { audioReady } = startBowling();
    await audioReady;
    boot.advance('audio');
    boot.complete();

    home.append(document.getElementById('product-version'));
    bootScreen.hidden = true;
    home.hidden = false;
} catch (error) {
    if (boot) boot.fail(error);
    else status.textContent = loadError;
    progress.hidden = true;
    retry.hidden = false;
    console.error('Duck Bowling could not start', error);
} finally {
    unbind?.();
}
