import { createValueCodec, hashBytes } from '@bloom-gamekit/deterministic';
import { createSession, profiles } from '@bloom-gamekit/rollback';
import { createLoop } from '@bloom-gamekit/simloop';
import { createNostrRoom } from '@bloom-gamekit/transport';
import { DuelGame } from '../domain/duel.mjs';
import { TICK_RATE_HZ } from '../domain/timing.mjs';

const PLAYERS = Object.freeze(['a', 'b']);
const RELAYS = [
    'wss://relay.primal.net',
    'wss://nos.lol',
    'wss://relay.damus.io',
    'wss://relay.snort.social',
];
const ICE_SERVERS = [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:3478' },
];
const CODEC = createValueCodec({ omitUndefined: true });
const AXIS = 127;
const MAX_SHOT_SPEED = 1080;
const SPIN = 32767;
const HANDSHAKE_TIMEOUT_MS = 15000;

const clamp = (value, bound) => Math.min(bound, Math.max(-bound, value));
const packAxis = (value) => Math.round(clamp(value, 1) * AXIS) & 255;
const unpackAxis = (byte) => clamp(((byte << 24) >> 24) / AXIS, 1);

function packShot(vx, vy, spin) {
    const payload = new Uint8Array(6);
    const view = new DataView(payload.buffer);
    const scale = Math.min(1, MAX_SHOT_SPEED / Math.hypot(vx, vy));
    view.setInt16(0, Math.round(vx * scale), true);
    view.setInt16(2, Math.round(vy * scale), true);
    view.setInt16(4, Math.round(clamp(spin, 1) * SPIN), true);
    return payload;
}

function readAction({ input, commands }) {
    const dash = commands.find(({ payload }) => payload.length === 2);
    const move = dash?.payload ?? input;
    const shot = commands.find(({ payload }) => payload.length === 6)?.payload;
    const action = { moveX: unpackAxis(move[0]), moveY: unpackAxis(move[1]), dash: Boolean(dash) };
    if (shot) {
        const view = new DataView(shot.buffer, shot.byteOffset, shot.byteLength);
        const vx = view.getInt16(0, true);
        const vy = view.getInt16(2, true);
        if (Math.hypot(vx, vy) <= MAX_SHOT_SPEED + 1) {
            action.shot = { vx, vy, spin: clamp(view.getInt16(4, true) / SPIN, 1) };
        }
    }
    return action;
}

function matchAdapter(game, seed) {
    let boundary = 0;
    let terminalBoundary = null;
    return {
        saveInto(out) {
            CODEC.encodeInto({ boundary, terminalBoundary, state: game.exportState() }, out);
        },
        load(bytes) {
            const state = CODEC.decode(bytes);
            game.importState(state.state);
            boundary = state.boundary;
            terminalBoundary = state.terminalBoundary;
        },
        validateSnapshot(bytes, context) {
            try {
                const { boundary, terminalBoundary, state } = CODEC.decode(bytes);
                if (
                    boundary !== context.tick ||
                    (terminalBoundary !== null &&
                        (!Number.isSafeInteger(terminalBoundary) ||
                            terminalBoundary <= 0 ||
                            terminalBoundary > boundary))
                ) {
                    return false;
                }
                const other = new DuelGame(seed);
                other.importState(state);
                if (other.tick !== (terminalBoundary ?? boundary)) return false;
                if ((other.result === null) !== (terminalBoundary === null)) return false;
                const roundTrip = CODEC.encode({
                    boundary,
                    terminalBoundary,
                    state: other.exportState(),
                });
                return (
                    roundTrip.length === bytes.length &&
                    roundTrip.every((byte, i) => byte === bytes[i])
                );
            } catch {
                return false;
            }
        },
        step({ tick, inputs }) {
            if (tick !== boundary)
                throw new Error('Duel tick does not match the snapshot boundary');
            if (game.result === null) {
                const actions = PLAYERS.map((playerId) => {
                    const entry = inputs.find((input) => input.playerId === playerId);
                    if (!entry) throw new Error('Duel input is missing for ' + playerId);
                    return readAction(entry);
                });
                game.step(actions);
                if (game.result !== null) terminalBoundary = tick + 1;
            }
            boundary = tick + 1;
        },
        resultAt(confirmedBoundary) {
            return terminalBoundary !== null && terminalBoundary <= confirmedBoundary
                ? game.result
                : null;
        },
    };
}

export function openDuel({
    role,
    code,
    version,
    signal,
    signalerFactory,
    onRoom = () => {},
    onStatus = () => {},
    onReady = () => {},
    onFrame = () => {},
    onResult = () => {},
}) {
    if (!['host', 'join'].includes(role)) throw new TypeError('Invalid duel room role');
    if (role === 'join' && !/^\d{4}$/.test(code ?? '')) {
        throw new TypeError('방 코드는 숫자 4자리입니다.');
    }

    const lifecycle = new AbortController();
    const held = new Uint8Array(2);
    const side = role === 'host' ? 0 : 1;
    let queuedDash = null;
    let queuedShot = null;
    let room;
    let session;
    let loop;
    let game;
    let unsubscribeRoom;
    let handshakeTimer;
    let ready = false;
    let announcedResult = false;
    let status;
    let resolveReady;
    let rejectReady;
    const opened = new Promise((resolve, reject) => {
        resolveReady = resolve;
        rejectReady = reject;
    });
    // Consumers can subscribe after a cancellation without causing an unhandled rejection.
    void opened.catch(() => {});

    function report(next, reason) {
        if (status === next) return;
        status = next;
        onStatus(next, reason);
    }

    function clearInput() {
        held.fill(0);
        queuedDash = null;
        queuedShot = null;
    }

    function shutdown(next, error) {
        if (lifecycle.signal.aborted) return;
        lifecycle.abort(error);
        signal?.removeEventListener('abort', close);
        clearTimeout(handshakeTimer);
        clearInput();
        loop?.stop();
        unsubscribeRoom?.();
        session?.close();
        room?.close();
        rejectReady(error);
        report(next, error);
    }

    function close() {
        shutdown('closed', new DOMException('Duel closed', 'AbortError'));
    }

    function fail(error) {
        shutdown('failed', error);
    }

    function sample() {
        const commands = [];
        if (queuedDash) commands.push({ payload: queuedDash });
        if (queuedShot) commands.push({ payload: queuedShot });
        queuedDash = null;
        queuedShot = null;
        return { input: held, commands };
    }

    const linkReady = () =>
        room?.state === 'open' &&
        session?.ready &&
        !session.failure &&
        session.status !== 'recovering';

    async function connect() {
        report('connecting');
        const joined = await createNostrRoom({
            role,
            room: role === 'join' ? code : undefined,
            namespace: 'bloom-duck-bowling-duel',
            version,
            signal: lifecycle.signal,
            relays: RELAYS,
            rtcConfig: { iceServers: signalerFactory ? [] : ICE_SERVERS },
            timeoutMs: role === 'host' ? 3600000 : 30000,
            signalerFactory,
            collisionCheckMs: signalerFactory ? 0 : undefined,
        });
        if (lifecycle.signal.aborted) {
            joined.close();
            return;
        }
        room = joined;
        onRoom(room.room);
        unsubscribeRoom = room.subscribe((event) => {
            if (event.type !== 'state' || lifecycle.signal.aborted) return;
            if (event.state === 'failed' || event.state === 'closed') {
                fail(new Error(room.failure?.message || '친구와의 연결이 종료됐습니다.'));
            } else if (event.state === 'interrupted') {
                clearInput();
                report('interrupted');
            } else if (event.state === 'open') {
                report('synchronizing');
            }
        });
        await room.opened;
        if (lifecycle.signal.aborted) return;
        if (!room.sessionId) throw new Error('대전 식별자를 확인하지 못했습니다.');
        report('synchronizing');

        // The room's fresh identity is agreed by the signaling protocol before either core starts.
        const seed = hashBytes(new TextEncoder().encode(room.sessionId));
        game = new DuelGame(seed);
        const adapter = matchAdapter(game, seed);
        session = createSession({
            players: PLAYERS,
            localPlayerId: room.localPlayerId,
            authorityPlayerId: PLAYERS[0],
            sessionId: room.sessionId,
            simulationVersion: version,
            seed,
            inputSize: 2,
            profile: { ...profiles.action, tickRate: TICK_RATE_HZ, mode: 'rollback' },
            adapter,
            onEvent(event) {
                if (event.type === 'version-mismatch' || event.type === 'handshake-mismatch') {
                    fail(new Error('상대와 게임 버전 또는 경기 설정이 다릅니다.'));
                } else if (event.type === 'fatal' || event.type === 'desync-unrecoverable') {
                    fail(new Error('경기 동기화를 완료하지 못했습니다.'));
                }
            },
        });
        session.attachTransport(room.remotePlayerId, room.transport);
        if (lifecycle.signal.aborted) return;
        handshakeTimer = setTimeout(() => {
            if (!ready) fail(new Error('친구와 경기 동기화를 시작하지 못했습니다.'));
        }, HANDSHAKE_TIMEOUT_MS);
        loop = createLoop({
            session,
            getInput: sample,
            canAdvance: linkReady,
            canObserveInput: linkReady,
            onInputRelease: clearInput,
            onError: fail,
            render() {
                if (lifecycle.signal.aborted) return;
                if (session.failure) {
                    fail(new Error('경기 동기화를 완료하지 못했습니다.'));
                    return;
                }
                if (session.status === 'recovering') {
                    clearInput();
                    report('recovering');
                } else if (linkReady()) report('running');
                else if (session.status === 'interrupted' || session.status === 'disconnected') {
                    clearInput();
                    report('interrupted');
                } else if (room.state === 'open') report('synchronizing');

                if (!ready && linkReady()) {
                    ready = true;
                    clearTimeout(handshakeTimer);
                    const initial = { game, side };
                    resolveReady(initial);
                    onReady(initial);
                }
                if (!ready) return;
                onFrame({ game, side, confirmedTick: session.confirmedBoundary - 1 });
                if (!announcedResult && !session.resimulating) {
                    const result = adapter.resultAt(session.confirmedBoundary);
                    if (result !== null) {
                        announcedResult = true;
                        clearInput();
                        onResult(result);
                    }
                }
            },
        });
        loop.start();
    }

    const acceptsInput = () =>
        !lifecycle.signal.aborted && linkReady() && !announcedResult && game?.result === null;

    if (signal?.aborted) close();
    else {
        signal?.addEventListener('abort', close, { once: true });
        void connect().catch(fail);
    }

    return {
        opened,
        close,
        clearInput,
        setMove(x, y) {
            if (x === 0 && y === 0) {
                held.fill(0);
                return;
            }
            if (!acceptsInput()) return;
            held[0] = Number.isFinite(x) ? packAxis(x) : 0;
            held[1] = Number.isFinite(y) ? packAxis(y) : 0;
        },
        dash(x, y) {
            if (!acceptsInput() || queuedDash || !Number.isFinite(x) || !Number.isFinite(y))
                return false;
            if (!x && !y) return false;
            queuedDash = new Uint8Array([packAxis(x), packAxis(y)]);
            return true;
        },
        throw(vx, vy, spin = 0) {
            if (
                !acceptsInput() ||
                queuedShot ||
                !Number.isFinite(vx) ||
                !Number.isFinite(vy) ||
                !Number.isFinite(spin) ||
                !Math.hypot(vx, vy)
            )
                return false;
            queuedShot = packShot(vx, vy, spin);
            return true;
        },
    };
}
