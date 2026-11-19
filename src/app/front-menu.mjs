import { ROUTES, isRouteUnlocked } from '../domain/arena.mjs';

const CARD_COLORS = {
    imageBackground: '--map-image-background',
    badgeBackground: '--map-badge-background',
    badgeInk: '--map-badge-ink',
    line: '--map-badge-line',
};

export function button(text, onClick, className = '') {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = text;
    b.className = className;
    b.addEventListener('click', onClick);
    return b;
}

export function message(tag, text, className = '') {
    const el = document.createElement(tag);
    el.textContent = text;
    el.className = className;
    return el;
}

function createMapCard({ id, label, card: art }, unlocked, onStart) {
    const card = button('', () => onStart(id), 'map-card');
    for (const [field, property] of Object.entries(CARD_COLORS)) {
        if (art.colors[field]) card.style.setProperty(property, art.colors[field]);
    }
    card.disabled = !unlocked;
    card.dataset.route = id;
    if (!unlocked) card.classList.add('locked');

    const image = document.createElement('img');
    image.src = art.src;
    image.alt = '';
    image.className = 'map-card-art';
    const text = message('span', '', 'map-card-copy');
    const status = message('span', unlocked ? '플레이 가능' : '잠김', 'map-card-status');
    text.append(
        status,
        message('strong', label),
        message('span', unlocked ? art.description : art.locked, 'map-card-detail'),
    );
    const arrow = message('span', '→', 'map-card-arrow');
    arrow.setAttribute('aria-hidden', 'true');
    const imagePane = message('span', '', 'map-card-image');
    imagePane.append(image);
    card.append(imagePane, text);
    if (unlocked) card.append(arrow);
    return card;
}

export function renderMapCards(list, unlocks, onStart) {
    list.replaceChildren(
        ...ROUTES.map((route) => createMapCard(route, isRouteUnlocked(route, unlocks), onStart)),
    );
}
