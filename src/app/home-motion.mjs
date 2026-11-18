import { createHomeShowcase } from './home-showcase.mjs';

export function installHomeMotion(home) {
    const canvas = home.querySelector('#home-showcase');
    const main = home.closest('main');
    const settings = document.getElementById('menu-dialog');
    const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
    const preview = createHomeShowcase(canvas);
    const listeners = new AbortController();
    const options = { signal: listeners.signal };

    function sync() {
        if (home.hidden || reducedMotion.matches) {
            preview.stop();
            canvas.hidden = true;
        } else if (document.hidden || main.inert || settings.open) {
            preview.pause();
        } else if (preview.state !== 'playing') {
            preview.play();
            preview.render();
            canvas.hidden = false;
        }
    }

    const observer = new MutationObserver(sync);
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
            listeners.abort();
            preview.dispose();
        },
        options,
    );
    sync();
}
