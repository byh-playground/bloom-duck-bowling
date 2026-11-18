// 한 틱 설정에서 입력, 시뮬레이션, 투구 예측의 간격을 파생한다.
const TICK_RATE_HZ = 60;
const SUBSTEPS = 2;
export const MAX_FRAME_MS = 100;
export const STEP_SECONDS = 1 / TICK_RATE_HZ;
export const PHYSICS_STEP_SECONDS = STEP_SECONDS / SUBSTEPS;
export const MAX_FRAME_SECONDS = MAX_FRAME_MS / 1000;
export const MAX_FRAME_STEPS = Math.round(MAX_FRAME_SECONDS / STEP_SECONDS);

export const ENEMY_TIMING = {
    approach: 3.2,
    brace: 0.65,
    burst: 0.7,
    recover: 1.2,
    burstSpeed: 96,
};
// A wave braces on its own current ground positions; faster followers naturally bunch up.
// Burst heading locks once, so moving/aiming decisions can produce real misses.
export function enemyDrive(u, b, dt) {
    const c = ENEMY_TIMING;
    u.tacticAge = (u.tacticAge || 0) + dt;
    const period = c.approach + c.brace + c.burst + c.recover,
        t = u.tacticAge % period,
        old = u.tactic || 'approach';
    let stage =
        t < c.approach
            ? 'approach'
            : t < c.approach + c.brace
              ? 'brace'
              : t < c.approach + c.brace + c.burst
                ? 'burst'
                : 'recover';
    const dx = b.x - u.x,
        dy = b.y - u.y,
        d = Math.hypot(dx, dy) || 1;
    if (d < 100) stage = 'approach';
    u.tactic = stage;
    u.telegraph = stage === 'brace' ? Math.min(1, (t - c.approach) / c.brace) : 0;
    if (stage === 'burst' && old !== 'burst') {
        u.burstNx = dx / d;
        u.burstNy = dy / d;
    }
    const speed =
        stage === 'brace'
            ? 0
            : stage === 'burst'
              ? c.burstSpeed
              : stage === 'recover'
                ? u.speed * 0.65
                : u.speed;
    return {
        vx: stage === 'burst' ? (u.burstNx ?? dx / d) * speed : (dx / d) * speed,
        vy: stage === 'burst' ? (u.burstNy ?? dy / d) * speed : (dy / d) * speed,
        stage,
    };
}
