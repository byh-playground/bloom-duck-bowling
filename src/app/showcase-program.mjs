export const SHOWCASE_DURATION_MS = 17000;

export const SHOWCASE_TIMELINE = [
    {
        atMs: 0,
        action: 'chapter',
        index: 1,
        title: '공 한 발, 핀은 연쇄로',
        caption: '숲 입구에서 굴린 공이 핀을 밀어 연쇄 타격을 만듭니다.',
    },
    { atMs: 400, action: 'custom', name: 'start-grove' },
    { atMs: 1100, action: 'custom', name: 'straight-roll' },
    {
        atMs: 2900,
        action: 'chapter',
        index: 2,
        title: '대시로 공을 회수',
        caption: '튕겨 돌아오는 공에 닿으면 다시 굴릴 수 있습니다.',
    },
    { atMs: 3400, action: 'custom', name: 'dash-forward' },
    { atMs: 4060, action: 'custom', name: 'dash-to-ball' },
    { atMs: 4700, action: 'custom', name: 'dash-to-ball' },
    { atMs: 6000, action: 'custom', name: 'recovery-roll' },
    {
        atMs: 9600,
        action: 'chapter',
        index: 3,
        title: '폭풍 길에서 훅 투구',
        caption: '옆으로 대시해 빈틈을 만들고, 공에 회전을 줘 핀 무리를 노립니다.',
    },
    { atMs: 9600, action: 'custom', name: 'start-storm' },
    { atMs: 10300, action: 'custom', name: 'dash-right' },
    { atMs: 11200, action: 'custom', name: 'storm-hook' },
    { atMs: 13800, action: 'custom', name: 'storm-approach' },
    { atMs: 14600, action: 'custom', name: 'storm-approach' },
    { atMs: 16100, action: 'custom', name: 'storm-return' },
];

const ROLL_SPEED = 831;

function roll(game, x, y, spin = 0) {
    const ball = game.balls.find((ball) => ball.ready && ball.held);
    const distance = Math.hypot(x, y);
    if (ball && distance) {
        game.launch(ball.id, (x * ROLL_SPEED) / distance, (y * ROLL_SPEED) / distance, spin);
    }
}

function rollToward(game, pin, spin) {
    if (pin) roll(game, pin.x - game.boss.x, pin.y - game.boss.y, spin);
}

function dash(game, x, y) {
    game.setMove(x, y);
    game.dash();
    game.setMove(0, 0);
}

function dashTowardBall(game) {
    const ball = game.balls.find((ball) => ball.inWorld && !ball.ready && ball.pickupArmed);
    if (ball) dash(game, ball.x - game.boss.x, ball.y - game.boss.y);
}

function firstLivePin(game) {
    return game.enemies.find((pin) => pin.hp > 0);
}

function nearestPin(game) {
    let nearest;
    let distance = Infinity;
    for (const pin of game.enemies) {
        if (pin.hp <= 0) continue;
        const next = Math.hypot(pin.x - game.boss.x, pin.y - game.boss.y);
        if (next < distance) {
            nearest = pin;
            distance = next;
        }
    }
    return nearest;
}

const commands = {
    'start-grove': ({ start }) => start('grove'),
    'start-storm': ({ start }) => start('storm'),
    'straight-roll': ({ game }) => roll(game(), 0, -1),
    'dash-forward': ({ game }) => dash(game(), 0, -1),
    'dash-to-ball': ({ game }) => dashTowardBall(game()),
    'recovery-roll': ({ game }) => rollToward(game(), firstLivePin(game()), -0.25),
    'dash-right': ({ game }) => dash(game(), 1, 0),
    'storm-hook': ({ game }) => rollToward(game(), firstLivePin(game()), 0.38),
    'storm-approach': ({ game }) => dash(game(), -0.75, -0.66),
    'storm-return': ({ game }) => rollToward(game(), nearestPin(game()), -0.2),
};

export function runShowcaseCommand(name, session) {
    if (!Object.hasOwn(commands, name)) throw new Error('Unknown showcase command: ' + name);
    commands[name](session);
    // A move can be declined during recoil. Let the timeline advance to the next frame anyway.
    return true;
}
