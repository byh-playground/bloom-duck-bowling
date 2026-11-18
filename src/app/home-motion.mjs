import { createHomeShowcase } from './home-showcase.mjs';

export function installHomeMotion(home) {
    const art = home.querySelector('.home-art');
    const canvas = art.querySelector('#home-showcase');
    const main = home.closest('main');
    const settings = document.getElementById('menu-dialog');
    const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
    const preview = createHomeShowcase(canvas);
    const listeners = new AbortController();
    const options = { signal: listeners.signal };

    function resizeCanvas() {
        const { width, height } = art.getBoundingClientRect();
        if (!width || !height) return;
        const density = Math.min(window.devicePixelRatio, 1440 / Math.max(width, height));
        const pixelWidth = Math.max(1, Math.round(width * density));
        const pixelHeight = Math.max(1, Math.round(height * density));
        if (canvas.width === pixelWidth && canvas.height === pixelHeight) return;
        canvas.width = pixelWidth;
        canvas.height = pixelHeight;
        if (!canvas.hidden) preview.render();
    }

    function sync() {
        if (home.hidden || reducedMotion.matches) {
            preview.stop();
            canvas.hidden = true;
        } else if (document.hidden || main.inert || settings.open) {
            preview.pause();
        } else if (preview.state !== 'playing') {
            resizeCanvas();
            preview.play();
            preview.render();
            canvas.hidden = false;
        }
    }

    const observer = new MutationObserver(sync);
    const resize = new ResizeObserver(resizeCanvas);
    resize.observe(art);
    observer.observe(home, { attributes: true, attributeFilter: ['hidden'] });
    observer.observe(main, { attributes: true, attributeFilter: ['inert'] });
    observer.observe(settings, { attributes: true, attributeFilter: ['open'] });
    document.addEventListener('visibilitychange', sync, options);
    reducedMotion.addEventListener('change', sync, options);
    window.addEventListener('pageshow', sync, options);
    window.addEventListener(
        'pagehide',
        (event) => {
            if (event.persisted) {
                preview.pause();
                return;
            }
            observer.disconnect();
            resize.disconnect();
            listeners.abort();
            preview.dispose();
        },
        options,
    );
    sync();
}
