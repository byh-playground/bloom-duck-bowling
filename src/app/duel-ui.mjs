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

export function installDuelUI({ onEnter, onFrame, onStopInput, onResult, onExit }) {
    const $ = (id) => document.getElementById(id);
    const picker = $('duel-picker');
    const pickerStatus = $('duel-picker-status');
    const friend = $('duel-friend');
    const practice = $('duel-practice');
    const lobby = $('duel-lobby');
    const host = $('duel-host');
    const join = $('duel-join');
    const code = $('duel-code');
    const room = $('duel-room');
    const copy = $('duel-copy');
    const lobbyStatus = $('duel-lobby-status');
    let active = null;

    function setLobbyEnabled(enabled) {
        host.disabled = !enabled;
        for (const field of join.elements) field.disabled = !enabled;
    }

    function resetMatch() {
        const previous = active;
        active = null;
        previous?.abort.abort();
        previous?.controller?.close();
        room.hidden = true;
        copy.hidden = true;
        room.textContent = '';
        setLobbyEnabled(true);
        setText(lobbyStatus, '');
    }

    function exit() {
        const returnTo = active?.practice ? practice : host;
        resetMatch();
        onExit();
        returnTo.focus({ preventScroll: true });
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
            status: '',
        };
        active = attempt;
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
                    const state = typeof value === 'string' ? value : value?.state;
                    if (state === 'running' || state === 'ready' || state === 'playing') {
                        attempt.connected = true;
                        attempt.status = '';
                        if (!attempt.game) setText(lobbyStatus, STATUS.open);
                    } else if (Object.hasOwn(STATUS, state)) {
                        attempt.connected = false;
                        attempt.status = isPractice
                            ? '연습 경기를 계속할 수 없어요.'
                            : STATUS[state];
                        if (attempt.game) {
                            onStopInput();
                            onFrame();
                        } else setText(lobbyStatus, attempt.status);
                    }
                },
                onFrame({ game, side, confirmedTick }) {
                    if (active !== attempt) return;
                    const first = attempt.game === null;
                    attempt.game = game;
                    attempt.side = side;
                    attempt.confirmedTick = confirmedTick;
                    if (first) onEnter();
                    onFrame();
                },
                onResult(value) {
                    if (active !== attempt || attempt.finished) return;
                    attempt.finished = true;
                    onStopInput();
                    onResult(value);
                },
            });
            void attempt.controller.opened.then(() => {
                if (active !== attempt) return;
                attempt.connected = true;
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
            if (active === attempt && !attempt?.game && !lobby.hidden)
                setText(lobbyStatus, '방 코드를 복사했어요. 친구가 참가하면 시작합니다.');
        } catch {
            if (active === attempt && !attempt?.game && !lobby.hidden)
                setText(lobbyStatus, '화면에 표시된 방 코드를 친구에게 알려주세요.');
        }
    });
    window.addEventListener('pagehide', () => {
        if (active?.game) exit();
        else leaveLobby();
    });
    $('duel-tab').hidden = false;
    return {
        get match() {
            return active?.game ? active : null;
        },
        exit,
        leaveLobby,
    };
}
