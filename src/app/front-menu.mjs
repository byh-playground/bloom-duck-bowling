import { ROUTES } from '../domain/arena.mjs';

const CARD_ART = {
    grove: {
        src: 'assets/grove-card.svg',
        description: '숲속 공터와 갈림길',
    },
    storm: {
        src: 'assets/storm-card.svg',
        description: '비 내리는 좁은 협곡',
        locked: '숲길 5구역 도달 시 해금',
    },
};

export const STORM_UNLOCK_NOTICE = '폭풍 길이 열렸어요!';

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

function createMapCard({ id, label, unlock }, unlocked, onStart) {
    const art = CARD_ART[id];
    const card = button('', () => onStart(id), `map-card map-card--${id}`);
    card.disabled = !unlocked;
    card.dataset.route = id;
    if (unlock && !unlocked) card.classList.add('locked');

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
        ...ROUTES.map((route) =>
            createMapCard(route, !route.unlock || unlocks.includes(route.unlock), onStart),
        ),
    );
}
