export default {
    id: 'grove',
    label: '숲길',
    landscape: 'forest',
    card: {
        src: 'assets/grove-card.svg',
        description: '숲속 공터와 갈림길',
    },
    arena: { left: -80, right: 680, top: 0, bottom: 1150 },
    home: { y: 895, ballY: 1055 },
    trail: [
        { title: '숲 입구', decor: 'trailhead', packets: 2, stage: 0 },
        { title: '자작나무 길', decor: 'birches', packets: 2, stage: 1 },
        { title: '고사리 골짜기', decor: 'ferns', packets: 3, stage: 2 },
        { title: '묵은 숲의 문', decor: 'old-woods', packets: 3, stage: 3 },
        { title: '숲의 심장', decor: 'forest-heart', packets: 3, stage: 7 },
    ],
    widths: [700, 735, 715, 740],
    depths: [900, 830, 930, 875],
    pinKinds: {},
    rackEntrances: [
        { y: 425, nx: 0, ny: 1, lane: 'middle' },
        { offsetX: -240, y: 238, nx: 0.6, ny: 0.8, lane: 'left' },
        { offsetX: 240, y: 168, nx: -0.6, ny: 0.8, lane: 'right' },
    ],
};
