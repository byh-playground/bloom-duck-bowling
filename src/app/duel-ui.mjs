import { BowlingInput } from '../input/input.mjs';
import { MovementInput } from '../input/movement-input.mjs';
import { DUCK_COMBAT } from '../domain/combat-clock.mjs';
import { BALL_TYPES } from '../domain/dynamics.mjs';
import { duckAimOpen } from '../domain/duck-recoil.mjs';
import { renderDuel } from '../presentation/duel-view.mjs';
import { renderThrowPad } from '../presentation/throw-pad.mjs';
import { openPracticeDuel } from './duel-practice.mjs';

const STATUS = {
    connecting: '상대를 기다리고 있어요.',
    open: '상대와 연결됐어요. 경기를 준비하고 있어요.',
    synchronizing: '경기 상태를 맞추고 있어요.',
    recovering: '경기 상태를 복구하고 있어요.',
    disconnected: '상대와의 연결이 끊겼어요.',
    interrupted: '연결이 잠시 끊겼어요. 다시 연결하고 있어요.',
    'peer-interrupted': '연결이 잠시 끊겼어요. 다시 연결하고 있어요.',
    failed: '상대와 연결하지 못했어요.',
    closed: '방 연결이 종료됐어요.',
    'peer-disconnected': '상대와의 연결이 종료됐어요.',
};

function connectionError(error) {
    if (error?.code === 'version-mismatch')
        return '상대와 게임 버전이 달라요. 둘 다 새로고침한 뒤 다시 시도하세요.';
    if (error?.code === 'timeout')
        return '상대를 찾지 못했어요. 방 코드를 확인한 뒤 다시 시도하세요.';
    return '방에 연결하지 못했어요. 잠시 뒤 다시 시도하세요.';
}

function setText(node, value) {
    const next = String(value);
    if (node.textContent !== next) node.textContent = next;
}

const healthCells = ({ hp, maxHp }) => {
    const pip = DUCK_COMBAT.damagePerHit;
    return Math.max(0, hp) / pip + ' / ' + maxHp / pip;
};

export function installDuelUI() {
    const $ = (id) => document.getElementById(id);
    const dialog = $('duel-dialog');
    const picker = $('duel-picker');
    const pickerStatus = $('duel-picker-status');
    const friend = $('duel-friend');
    const practice = $('duel-practice');
    const lobby = $('duel-lobby');
    const match = $('duel-match');
    const host = $('duel-host');
    const join = $('duel-join');
    const code = $('duel-code');
    const room = $('duel-room');
    const copy = $('duel-copy');
    const status = $('duel-status');
    const lobbyStatus = $('duel-lobby-status');
    const canvas = $('duel-game');
    const pad = $('duel-throw');
    const stick = $('duel-stick');
    const result = $('duel-result');
    const ctx = canvas.getContext('2d');
    const padCtx = pad.getContext('2d');
    const localHp = $('duel-local-hp');
    const remoteHp = $('duel-remote-hp');
    const kills = $('duel-kills');
    const ammo = $('duel-ammo');
    let active = null;
    let aim = null;
    let moveX = 0;
    let moveY = 0;

    const player = () => active?.game?.players[active.side];
    const canPlay = () => !!(dialog.open && active?.connected && active.game && !active.finished);
    const canThrow = () => {
        const local = player();
        return (
            canPlay() &&
            local?.boss.hp > 0 &&
            !local.boss.delivery &&
            duckAimOpen(local.boss) &&
            local.balls.some((ball) => ball.ready && ball.held)
        );
    };

    const throwInput = new BowlingInput(pad, {
        keyboardTarget: canvas,
        coordinateScale: 2,
        getBoss: () => player()?.boss,
        getBalls: () => player()?.balls ?? [],
        enabled: canThrow,
        onAim(value) {
            aim = value;
        },
        onLaunch(id, vx, vy, spin) {
            if (canThrow()) active.controller.throw(vx, vy, spin);
        },
    });
    const movement = new MovementInput({
        stick,
        enabled: canPlay,
        onMove(x, y) {
            moveX = x;
            moveY = y;
            if (canPlay()) active.controller.setMove(x, y);
        },
        onDash() {
            if (!canPlay()) return false;
            throwInput.cancel();
            active.controller.dash(moveX, moveY);
            return true;
        },
    });

    function renderFrame({ game, side, confirmedTick }) {
        const first = active.game === null;
        active.game = game;
        active.side = side;
        if (first) {
            match.hidden = false;
            if (!dialog.open) dialog.showModal();
            throwInput.keyAngle = side === 1 ? Math.PI / 2 : -Math.PI / 2;
            canvas.focus({ preventScroll: true });
            setText(status, active.practice ? '연습 중' : '대전 중');
        }

        const local = game.players[side];
        const opponent = game.players[1 - side];
        if (aim && !canThrow()) throwInput.cancel();
        renderDuel(ctx, game, side, aim ? { ...aim, detached: true } : null);
        const ready = local.balls.filter((ball) => ball.ready).length;
        setText(localHp, healthCells(local.boss));
        setText(remoteHp, healthCells(opponent.boss));
        setText(kills, '처치 ' + local.kills);
        const type = BALL_TYPES[local.selectedType];
        const ballName = type && ready > 0 ? type.name + ' 공 · ' : '';
        setText(ammo, ballName + ready + ' / ' + local.balls.length);
        match.dataset.confirmedTick = String(confirmedTick);
        match.dataset.tick = String(game.tick);
        match.dataset.side = String(side);

        const { width, height } = pad.getBoundingClientRect();
        const w = Math.max(1, Math.round(width * 2));
        const h = Math.max(1, Math.round(height * 2));
        if (pad.width !== w) pad.width = w;
        if (pad.height !== h) pad.height = h;
        const available = canPlay();
        pad.setAttribute('aria-disabled', String(!canThrow()));
        stick.setAttribute('aria-disabled', String(!available));
        renderThrowPad(padCtx, aim, {
            width: w,
            height: h,
            available,
            paused: !available && !active.finished,
            airborne: !duckAimOpen(local.boss),
            delivering: local.boss.delivery?.phase,
            ready,
            keyboard: !!aim && throwInput.id === null,
        });
    }

    function setLobbyEnabled(enabled) {
        host.disabled = !enabled;
        for (const field of join.elements) field.disabled = !enabled;
    }

    function clearInput() {
        movement.reset();
        throwInput.cancel();
        active?.controller?.setMove(0, 0);
    }

    function resetMatch() {
        const previous = active;
        clearInput();
        active = null;
        previous?.abort.abort();
        previous?.controller?.close();
        match.hidden = true;
        result.hidden = true;
        room.hidden = true;
        copy.hidden = true;
        room.textContent = '';
        delete match.dataset.confirmedTick;
        delete match.dataset.tick;
        delete match.dataset.side;
        setLobbyEnabled(true);
        setText(status, '');
        setText(lobbyStatus, '');
    }

    function leaveLobby() {
        resetMatch();
        setText(pickerStatus, '');
        picker.hidden = false;
        lobby.hidden = true;
    }

    async function start(role, roomCode) {
        if (active) return;
        const isPractice = role === 'practice';
        const attempt = {
            abort: new AbortController(),
            controller: null,
            connected: false,
            game: null,
            side: role === 'join' ? 1 : 0,
            finished: false,
            practice: isPractice,
        };
        active = attempt;
        throwInput.keyPower = 0.7;
        setText($('duel-title'), isPractice ? 'AI 연습' : '친구와 대전');
        setText($('duel-opponent'), isPractice ? 'AI' : '상대');
        if (!isPractice) {
            setLobbyEnabled(false);
            setText(lobbyStatus, role === 'host' ? '방을 만들고 있어요.' : '방에 참가하고 있어요.');
        }
        try {
            const openMatch = isPractice
                ? openPracticeDuel
                : (await import('./duel-network.mjs')).openDuel;
            if (active !== attempt) return;
            attempt.controller = openMatch({
                role,
                code: roomCode,
                version: $('product-version').textContent.trim(),
                signal: attempt.abort.signal,
                onRoom(value) {
                    if (active !== attempt || role !== 'host') return;
                    setText(room, value);
                    room.hidden = false;
                    copy.hidden = false;
                },
                onStatus(value, error) {
                    if (active !== attempt || attempt.finished) return;
                    if (isPractice && value === 'failed' && !attempt.game) {
                        failed(error);
                        return;
                    }
                    if (isPractice && value === 'failed')
                        console.error('Duck Bowling practice stopped', error);
                    const statusNode = attempt.game ? status : lobbyStatus;
                    const state = typeof value === 'string' ? value : value?.state;
                    if (state === 'running' || state === 'ready' || state === 'playing') {
                        attempt.connected = true;
                        if (!isPractice)
                            setText(statusNode, attempt.game ? '대전 중' : STATUS.open);
                    } else if (Object.hasOwn(STATUS, state)) {
                        clearInput();
                        attempt.connected = false;
                        setText(
                            statusNode,
                            isPractice ? '연습 경기를 계속할 수 없어요.' : STATUS[state],
                        );
                    }
                },
                onFrame(frame) {
                    if (active === attempt) renderFrame(frame);
                },
                onResult(value) {
                    if (active !== attempt || attempt.finished) return;
                    clearInput();
                    attempt.finished = true;
                    setText(
                        $('duel-result-message'),
                        value === 'draw' ? '무승부' : value === attempt.side ? '승리!' : '패배',
                    );
                    setText(status, '경기 종료');
                    result.hidden = false;
                    $('duel-exit-match').focus({ preventScroll: true });
                },
            });
            void attempt.controller.opened.then(() => {
                if (active !== attempt) return;
                attempt.connected = true;
                if (attempt.game) canvas.focus({ preventScroll: true });
            }, failed);
        } catch (error) {
            failed(error);
        }

        function failed(error) {
            if (active !== attempt) return;
            resetMatch();
            if (isPractice) {
                console.error('Duck Bowling practice could not start', error);
                setText(pickerStatus, '연습 경기를 열지 못했어요. 다시 시도해 주세요.');
            } else {
                setText(lobbyStatus, connectionError(error));
            }
            (isPractice ? practice : host).focus({ preventScroll: true });
        }
    }

    friend.addEventListener('click', () => {
        picker.hidden = true;
        lobby.hidden = false;
        host.focus({ preventScroll: true });
    });
    practice.addEventListener('click', () => {
        setText(pickerStatus, '');
        void start('practice');
    });
    function backToPicker() {
        leaveLobby();
        friend.focus({ preventScroll: true });
    }
    $('duel-back').addEventListener('click', backToPicker);
    lobby.addEventListener('keydown', (event) => {
        if (event.key !== 'Escape') return;
        event.preventDefault();
        backToPicker();
    });
    $('duel-close').addEventListener('click', () => dialog.close());
    $('duel-exit-match').addEventListener('click', () => dialog.close());
    dialog.addEventListener('close', () => {
        const returnTo = active?.practice ? practice : host;
        resetMatch();
        returnTo.focus({ preventScroll: true });
    });
    host.addEventListener('click', () => start('host'));
    join.addEventListener('submit', (event) => {
        event.preventDefault();
        const value = code.value.trim();
        if (!/^\d{4}$/.test(value)) {
            setText(lobbyStatus, '숫자 네 자리 방 코드를 입력하세요.');
            code.focus();
            return;
        }
        start('join', value);
    });
    copy.addEventListener('click', async () => {
        const attempt = active;
        try {
            await navigator.clipboard.writeText(room.textContent);
            if (active === attempt && match.hidden && !lobby.hidden)
                setText(lobbyStatus, '방 코드를 복사했어요. 친구가 참가하면 시작합니다.');
        } catch {
            if (active === attempt && match.hidden && !lobby.hidden)
                setText(lobbyStatus, '화면에 표시된 방 코드를 친구에게 알려주세요.');
        }
    });
    window.addEventListener('pagehide', () => {
        if (dialog.open) dialog.close();
        leaveLobby();
    });
    $('duel-tab').hidden = false;
    return { leaveLobby };
}
