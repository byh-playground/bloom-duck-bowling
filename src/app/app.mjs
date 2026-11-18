import { STEP_SECONDS, MAX_FRAME_SECONDS, MAX_FRAME_STEPS } from '../domain/timing.mjs';
import { ROUTES } from '../domain/arena.mjs';
import { CampaignGame, AUGMENTS, STAGES } from '../domain/campaign.mjs';
import {
    defaultProfile,
    loadProfile,
    saveProfile,
    recordRun,
    resetProfile,
} from './progression.mjs';
import { BowlingInput } from '../input/input.mjs';
import { MovementInput } from '../input/movement-input.mjs';
import { render, project } from '../presentation/render.mjs';
import { DUCK_COMBAT } from '../domain/combat-clock.mjs';
import { duckAimOpen, duckDashOpen } from '../domain/duck-recoil.mjs';
import { renderThrowPad } from '../presentation/throw-pad.mjs';
const SHOT_LABELS = {
    basic: ['기본 공', '균형'],
    heavy: ['무거운 공', '강한 충돌'],
    rubber: ['고무 공', '강한 벽 반사'],
    spinner: ['회전 공', '깊은 훅'],
};
// QA can supply a real-physics driver and faster clock; the shipped entry uses defaults.
export function startBowling({ beforeStep = null, stepRate = 1, seed } = {}) {
    const $ = (id) => document.getElementById(id),
        canvas = $('game'),
        ctx = canvas.getContext('2d'),
        throwPad = $('throw-pad'),
        throwCtx = throwPad.getContext('2d');
    let storage = null;
    try {
        storage = window.localStorage;
    } catch {
        // 저장이 차단된 브라우저에서도 이번 판은 메모리에서 실행한다.
    }
    const menuButton = $('menu'),
        menuDialog = $('menu-dialog'),
        menuPanel = $('menu-panel');
    const health = $('health'),
        lifePips = Array.from({ length: DUCK_COMBAT.hitsToDefeat }, () => {
            const pip = document.createElement('i');
            pip.className = 'life-pip';
            pip.setAttribute('aria-hidden', 'true');
            return pip;
        });
    health.append(...lifePips);
    health.setAttribute('aria-valuemin', '0');
    health.setAttribute('aria-valuemax', String(DUCK_COMBAT.maxHp));
    const newGame = (route, unlocks) =>
        new CampaignGame(seed ?? 42, {
            route,
            unlocks,
            expedition: true,
            shotSeed: seed ?? crypto.getRandomValues(new Uint32Array(1))[0],
        });
    let profile = loadProfile(storage),
        game = newGame('grove', profile.unlocks),
        aim = null,
        last = 0,
        acc = 0,
        recorded = false,
        overlayKey = '',
        menuPage = null,
        saveFailed = false,
        frameNumber = 0,
        displayedShot;
    const inputMetrics = [];
    const input = new BowlingInput(throwPad, {
        coordinateScale: 2,
        keyboardTarget: canvas,
        getBalls: () => game.balls,
        getBoss: () => game.boss,
        enabled: () =>
            !menuPage && game.phase === 'playing' && !game.boss.delivery && duckAimOpen(game.boss),
        project,
        onAim: (a) => {
            if (a) for (const m of inputMetrics) if (m.firstMovementMs === null) m.cancelled = true;
            aim = a;
            game.setAim(a);
        },
        onLaunch: (id, vx, vy, spin = 0) => game.launch(id, vx, vy, spin),
    });
    const movement = new MovementInput({
        stick: $('move-stick'),
        enabled: () => !menuPage && game.phase === 'playing',
        onMove: (x, y) => game.setMove(x, y),
        onDash: (event = {}) => {
            const at = performance.now(),
                from = { x: game.boss.x, y: game.boss.y };
            if (!game.dash()) return false;
            input.cancel();
            for (const m of inputMetrics) if (m.firstMovementMs === null) m.cancelled = true;
            inputMetrics.push({
                source: event.source || 'unknown',
                eventToDashMs: Number.isFinite(event.eventTimeStamp)
                    ? Math.max(0, at - event.eventTimeStamp)
                    : null,
                requestAt: at,
                frame: frameNumber,
                x: from.x,
                y: from.y,
                synchronousRemaining: game.boss.dashRemaining,
                firstMovementMs: null,
                firstMovementFrames: null,
            });
            if (inputMetrics.length > 12) inputMetrics.shift();
            return true;
        },
    });
    function persistRun() {
        if (recorded) return;
        profile = recordRun(profile, {
            stage: game.stageIndex + 1,
            won: game.phase === 'won',
            total: game.expedition?.roomCount ?? STAGES.length,
        });
        recorded = true;
        saveFailed = saveProfile(storage, profile) === false;
    }
    function clearInput() {
        movement.reset();
        input.cancel();
        acc = 0;
    }
    function reset(newRoute = game.route) {
        if (game.elapsed > 1) persistRun();
        clearInput();
        inputMetrics.length = 0;
        game = newGame(newRoute, profile.unlocks);
        displayedShot = undefined;
        recorded = false;
        overlayKey = '';
        showMenu(null);
    }
    function button(text, fn, cls = '') {
        const b = document.createElement('button');
        b.type = 'button';
        b.textContent = text;
        b.className = cls;
        b.addEventListener('click', fn);
        return b;
    }
    function message(tag, text) {
        const e = document.createElement(tag);
        e.textContent = text;
        return e;
    }
    function overlayTitle(overlay, label) {
        const heading = message('h2', label);
        heading.id = 'overlay-title';
        overlay.append(heading);
    }
    function showMenu(page) {
        const wasOpen = menuPage !== null;
        menuPage = page;
        if (page) {
            if (!wasOpen) clearInput();
            menuPanel.scrollTop = 0;
            menuPanel.replaceChildren();
            const title = message('h2', page.title);
            title.id = 'menu-title';
            menuPanel.append(title);
            const preferred = page.render(menuPanel);
            if (!wasOpen) {
                preferred.setAttribute('autofocus', '');
                menuDialog.showModal();
            } else preferred.focus({ preventScroll: true });
        } else if (wasOpen) {
            last = 0;
            menuDialog.close();
        }
        update();
    }
    function backFromMenu() {
        if (menuPage) showMenu(menuPage.parent);
    }
    function openMenu() {
        if (menuPage) return;
        const page = {
            title: game.phase === 'playing' ? '일시정지' : '메뉴',
            parent: null,
            render(o) {
                const resume = button(
                    game.phase === 'playing' ? '계속하기' : '돌아가기',
                    backFromMenu,
                    'primary',
                );
                o.append(resume);
                if (availableMaps().length > 1) o.append(button('맵 선택', () => openMaps(page)));
                o.append(
                    button('다시 시작', () => confirmRestart(game.route, page)),
                    button('기록과 해금', () => openRecords(page)),
                );
                return resume;
            },
        };
        showMenu(page);
    }
    function availableMaps() {
        return ROUTES.filter(({ unlock }) => !unlock || profile.unlocks.includes(unlock));
    }
    function openMaps(parent) {
        const page = {
            title: '맵 선택',
            parent,
            render(o) {
                for (const { id: route, label } of availableMaps()) {
                    const option = button(label, () => {
                        if (route === game.route) return;
                        if (game.phase === 'won' || game.phase === 'lost' || game.elapsed === 0) {
                            reset(route);
                        } else {
                            confirmRestart(route, page);
                        }
                    });
                    if (route === game.route) {
                        option.disabled = true;
                        option.setAttribute('aria-current', 'true');
                    }
                    o.append(option);
                }
                const back = button('돌아가기', backFromMenu);
                o.append(back);
                return back;
            },
        };
        showMenu(page);
    }
    function confirmRestart(newRoute, parent) {
        const changingMap = newRoute !== game.route;
        showMenu({
            title: changingMap ? '맵을 바꿀까요?' : '다시 시작할까요?',
            parent,
            render(o) {
                const cancel = button('취소', backFromMenu, 'primary');
                o.append(
                    message('p', '이번 판은 여기서 끝나요.'),
                    cancel,
                    button(
                        changingMap ? '맵 바꾸기' : '다시 시작',
                        () => reset(newRoute),
                        'danger',
                    ),
                );
                return cancel;
            },
        });
    }
    function openRecords(parent = null) {
        const page = {
            title: '기록과 해금',
            parent,
            render(o) {
                return renderRecords(o, page);
            },
        };
        showMenu(page);
    }
    function renderRecords(o, page) {
        o.append($('game-intro').content.cloneNode(true));
        o.append(message('p', `최고 ${profile.bestStage}구역 · 완주 ${profile.wins}회`));
        const spinner = profile.unlocks.includes('spinner'),
            storm = profile.unlocks.includes('storm');
        o.append(
            message(
                'small',
                `${spinner ? '회전 공: 다음 판부터 등장' : '3구역 도달: 회전 공 해금'}\n${storm ? '폭풍 길: 열림' : '5구역 도달: 폭풍 길 해금'}`,
            ),
        );
        if (game.augments.length) {
            const names = game.augments.map((id) => AUGMENTS.find((a) => a.id === id)?.name || id);
            o.append(message('small', '이번 판 증강: ' + names.join(' · ')));
        }
        const back = button('돌아가기', backFromMenu, 'primary');
        if (saveFailed) o.append(message('p', '이 브라우저에 기록을 저장하지 못했어요.'));
        o.append(back);
        o.append(
            button(
                '기록 초기화',
                () =>
                    showMenu({
                        title: '기록을 초기화할까요?',
                        parent: page,
                        render(confirm) {
                            const cancel = button('취소', backFromMenu, 'primary');
                            confirm.append(
                                message('p', '기록과 해금이 지워져요.'),
                                cancel,
                                button(
                                    '기록과 해금 지우기',
                                    () => {
                                        const ok = resetProfile(storage);
                                        if (ok) {
                                            profile = defaultProfile();
                                            recorded =
                                                game.phase === 'won' || game.phase === 'lost';
                                        }
                                        saveFailed = !ok;
                                        backFromMenu();
                                    },
                                    'danger',
                                ),
                            );
                            return cancel;
                        },
                    }),
                'subtle',
            ),
        );
        return back;
    }
    menuButton.addEventListener('click', openMenu);
    menuDialog.addEventListener('cancel', (event) => {
        event.preventDefault();
        backFromMenu();
    });
    let backdropDown = false;
    menuDialog.addEventListener('pointerdown', (event) => {
        backdropDown = event.target === menuDialog;
    });
    menuDialog.addEventListener('pointercancel', () => {
        backdropDown = false;
    });
    menuDialog.addEventListener('click', (event) => {
        const dismiss = backdropDown && event.target === menuDialog;
        backdropDown = false;
        if (dismiss) backFromMenu();
    });
    document.addEventListener('visibilitychange', () => {
        if (document.hidden && !menuPage && game.phase === 'playing') openMenu();
    });
    function renderAugments(o) {
        o.append(
            message(
                'small',
                game.expedition
                    ? `${game.expedition.room.title} 정리`
                    : `${game.stageIndex + 1}라운드 통과`,
            ),
        );
        overlayTitle(o, '증강 선택');
        for (const option of game.choices) {
            const card = button(
                '',
                () => {
                    if (game.chooseAugment(option.id)) {
                        overlayKey = '';
                        acc = 0;
                        update();
                    }
                },
                'augment',
            );
            card.append(message('strong', option.name), message('span', option.description));
            o.append(card);
        }
        o.append(message('p', '선택하면 체력 1칸 회복'));
    }
    function renderResult(o) {
        persistRun();
        overlayTitle(
            o,
            game.phase === 'won' ? '완주!' : game.endless ? '무한 라운드 종료' : '도전 종료',
        );
        const mins = Math.floor(game.elapsed / 60),
            secs = Math.floor(game.elapsed % 60);
        const progress = game.expedition
            ? `${game.stageClears}/${game.expedition.roomCount} 구역`
            : `${game.stageIndex + 1}/${STAGES.length} 라운드`;
        o.append(
            message(
                'p',
                `${progress} · ${mins}분 ${secs}초\n핀 ${game.stats.kills}개 · 최고 ${game.scoring.best}콤보 · 스트라이크 ${game.scoring.strikes}회`,
            ),
        );
        if (saveFailed) o.append(message('p', '이 브라우저에 기록을 저장하지 못했어요.'));
        if (game.phase === 'won' && !game.expedition)
            o.append(
                button(
                    '무한 라운드',
                    () => {
                        if (game.continueEndless()) {
                            overlayKey = '';
                            acc = 0;
                            movement.reset();
                            input.cancel();
                            update();
                        }
                    },
                    'primary',
                ),
            );
        o.append(
            button(
                '다시 굴리기',
                () => reset(),
                game.phase === 'won' && !game.expedition ? '' : 'primary',
            ),
            button('기록과 해금', () => openRecords()),
        );
    }
    function showOverlay() {
        const key =
            game.phase === 'choice'
                ? `choice:${game.stageIndex}`
                : game.phase === 'won' || (game.phase === 'lost' && !game.defeatAnimating)
                  ? game.phase
                  : 'none';
        if (key === overlayKey) return;
        overlayKey = key;
        const o = $('overlay');
        o.replaceChildren();
        o.hidden = key === 'none';
        if (game.phase === 'choice') renderAugments(o);
        else if (!o.hidden) renderResult(o);
    }
    function setText(el, value) {
        const next = String(value);
        if (el.textContent !== next) el.textContent = next;
    }
    function updateRound(s) {
        const trail = game.expedition;
        setText(
            $('round'),
            trail?.room.title ?? (s.endless ? '무한 라운드' : `${s.stage}/${STAGES.length} 라운드`),
        );
        const needs = [];
        if (trail && s.phase === 'playing') {
            if (trail.phase === 'gates') needs.push('다음 길로 대시');
            else if (trail.packetsSent < trail.packetTarget) needs.push('핀 진입 중');
            else if (s.alive > 0) needs.push(`남은 핀 ${s.alive}개`);
        } else if (!trail && !s.endless && s.phase === 'playing') {
            const seconds = Math.ceil(Math.max(0, s.stageMin - game.stageTime));
            if (seconds > 0) needs.push(`남은 ${seconds}초`);
            if (s.stageKills < s.stageKillTarget)
                needs.push(`핀 ${s.stageKills}/${s.stageKillTarget}`);
            if (s.stageBossPending || (s.stageBossId && !s.stageBossDefeated))
                needs.push('보스 핀');
        }
        setText($('objective'), needs.join(' · '));
        health.setAttribute('aria-valuenow', String(Math.ceil(s.hp)));
        const remaining = s.hp / DUCK_COMBAT.damagePerHit;
        health.classList.toggle('critical', remaining <= 1);
        lifePips.forEach((pip, i) =>
            pip.style.setProperty(
                '--life-fill',
                `${100 * Math.max(0, Math.min(1, remaining - i))}%`,
            ),
        );
    }
    function updateControls(s) {
        const type = s.nextBallType ?? (s.ready > 0 ? displayedShot : null);
        if (type !== displayedShot) {
            displayedShot = type;
            const [name, trait] = SHOT_LABELS[type] ?? ['', ''];
            $('shot-orb').hidden = !name;
            $('shot-orb').className = 'orb' + (name ? ' ' + type : '');
            setText($('shot-kind'), name);
            setText($('shot-trait'), trait);
        }
        const picked = game.lastPickup && game.time - game.lastPickup.time < 1.1;
        setText($('ammo-count'), `${s.ready}/${game.balls.length}`);
        $('ammo').classList.toggle('picked', !!picked);
        const inactive = menuPage !== null || s.phase !== 'playing',
            landing = !duckAimOpen(game.boss);
        $('move-stick').classList.toggle('armed', !!movement.dashArmed);
        $('move-stick').classList.toggle('dashing', game.boss.dashRemaining > 0);
        $('move-stick').setAttribute('aria-disabled', String(inactive));
        const { dashCharges: charges, dashCapacity: capacity, dashRechargeProgress: progress } = s;
        $('dash-charges').setAttribute('aria-label', `대시 ${charges}/${capacity}회 준비`);
        for (let i = 0; i < capacity; i++) {
            const chip = $('dash-charge-' + i),
                full = i < charges;
            chip.classList.toggle('full', full);
            chip.classList.toggle('charging', i === charges && charges < capacity);
            chip.style.setProperty(
                '--charge-fill',
                `${(full ? 1 : i === charges ? progress : 0) * 100}%`,
            );
        }
        const delivering = !!game.boss.delivery;
        throwPad.setAttribute(
            'aria-disabled',
            String(inactive || delivering || landing || s.ready === 0),
        );
        throwPad.setAttribute(
            'aria-label',
            inactive
                ? '오른쪽 굴리기 영역'
                : landing
                  ? '착지 후 굴리기'
                  : delivering
                    ? '굴리는 중'
                    : s.ready === 0
                      ? '공 회수 대기'
                      : aim
                        ? '조준 중. 놓으면 굴리기'
                        : '오른쪽 굴리기. 보낼 방향으로 밀고 놓으세요. 끝을 휘면 훅.',
        );
    }
    function update() {
        movement.refresh();
        if ((game.phase !== 'playing' || !duckAimOpen(game.boss)) && (aim || input.id !== null))
            input.cancel();
        const s = game.snapshot();
        updateRound(s);
        updateControls(s);
        $('summary').dataset.state = JSON.stringify(s);
        $('summary').dataset.inputMetrics = JSON.stringify(inputMetrics);
        $('summary').dataset.profile = JSON.stringify(profile);
        showOverlay();
    }
    function repeatHeldDash() {
        const b = game.boss;
        // Finish each burst and don't let a held direction cancel an in-progress throw.
        if (
            game.dashCharges > 0 &&
            !(b.dashRemaining > 0) &&
            !b.aiming &&
            !b.delivery &&
            input.id === null &&
            duckDashOpen(b)
        )
            movement.repeatDash();
    }
    function frame(now) {
        frameNumber++;
        movement.refresh();
        const dt = last ? Math.min(MAX_FRAME_SECONDS, (now - last) / 1000) : 0;
        last = now;
        if (!menuPage && game.phase === 'playing') {
            acc += dt * stepRate;
            let count = 0;
            while (
                acc >= STEP_SECONDS &&
                count++ < Math.max(MAX_FRAME_STEPS, Math.ceil(stepRate * MAX_FRAME_STEPS))
            ) {
                beforeStep?.(game);
                repeatHeldDash();
                game.step(STEP_SECONDS);
                acc -= STEP_SECONDS;
                if (game.phase !== 'playing') {
                    acc = 0;
                    break;
                }
            }
        } else if (!menuPage && game.defeatAnimating) game.stepDefeat(dt);
        for (const m of inputMetrics) {
            if (
                !m.cancelled &&
                m.firstMovementMs === null &&
                Math.hypot(game.boss.x - m.x, game.boss.y - m.y) > 0.001
            ) {
                m.firstMovementMs = performance.now() - m.requestAt;
                m.firstMovementFrames = frameNumber - m.frame;
            }
        }
        render(ctx, game, aim ? { ...aim, detached: true } : null);
        const box = throwPad.getBoundingClientRect(),
            pw = Math.max(1, Math.round(box.width * 2)),
            ph = Math.max(1, Math.round(box.height * 2));
        if (throwPad.width !== pw || throwPad.height !== ph) {
            throwPad.width = pw;
            throwPad.height = ph;
        }
        renderThrowPad(throwCtx, aim, {
            width: pw,
            height: ph,
            available: !menuPage && game.phase === 'playing',
            airborne: !duckAimOpen(game.boss),
            doubleArmed: game.doubleArmed,
            delivering: game.boss.delivery?.phase,
            ready: game.balls.filter((b) => b.ready).length,
            keyboard: !!aim && input.id === null,
        });
        update();
        requestAnimationFrame(frame);
    }
    update();
    requestAnimationFrame(frame);
    return { snapshot: () => game.snapshot() };
}
