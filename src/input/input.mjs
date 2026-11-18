import {
    project as cameraProject,
    screenVectorToWorld,
    worldVectorToScreen,
} from '../presentation/camera.mjs';
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
export function pushVector(dx, dy) {
    const length = Math.hypot(dx, dy),
        power = clamp(length / 110, 0, 1);
    if (length < 10) return { vx: 0, vy: 0, power: 0 };
    const { x, y } = screenVectorToWorld(dx, dy),
        n = Math.hypot(x, y);
    return { vx: (x / n) * (250 + 830 * power), vy: (y / n) * (250 + 830 * power), power };
}
export const GESTURE = { lock: 65, recenter: 35, deadzone: 14, fullSpin: 60 };
// Endpoint-relative bend, never accumulated curvature: returning to the axis removes spin.
export function gestureAim(previous, point) {
    const dx = point.x - previous.start.x,
        dy = point.y - previous.start.y,
        length = Math.hypot(dx, dy);
    const trail = [...(previous.trail || []), { x: point.x, y: point.y }].slice(-20);
    let axis = previous.axis || null;
    if (length < GESTURE.recenter) axis = null;
    if (!axis && length >= GESTURE.lock) axis = { x: dx / length, y: dy / length };
    if (!axis)
        return {
            ...previous,
            current: point,
            trail,
            axis: null,
            locked: false,
            anchor: null,
            spin: 0,
            ...pushVector(dx, dy),
        };
    const along = Math.max(0, dx * axis.x + dy * axis.y),
        lateral = dy * axis.x - dx * axis.y;
    const spin =
        Math.abs(lateral) <= GESTURE.deadzone
            ? 0
            : Math.sign(lateral) *
              clamp(
                  (Math.abs(lateral) - GESTURE.deadzone) / (GESTURE.fullSpin - GESTURE.deadzone),
                  0,
                  1,
              );
    return {
        ...previous,
        current: point,
        trail,
        axis,
        locked: true,
        anchor: {
            x: previous.start.x + axis.x * GESTURE.lock,
            y: previous.start.y + axis.y * GESTURE.lock,
        },
        spin,
        ...pushVector(axis.x * along, axis.y * along),
    };
}
export class BowlingInput {
    constructor(
        el,
        {
            getBalls,
            getBoss = () => null,
            onAim,
            onLaunch,
            enabled = () => true,
            project = cameraProject,
            coordinateScale = null,
            keyboardTarget = el,
        },
    ) {
        this.el = el;
        this.coordinateScale = coordinateScale;
        this.getBalls = getBalls;
        this.getBoss = getBoss;
        this.onAim = onAim;
        this.onLaunch = onLaunch;
        this.enabled = enabled;
        this.project = project;
        this.id = null;
        this.aim = null;
        this.selected = 1;
        this.keyAngle = -Math.PI / 2;
        this.keyPower = 0.7;
        el.addEventListener('pointerdown', (e) => this.down(e));
        el.addEventListener('pointermove', (e) => this.move(e));
        el.addEventListener('pointerup', (e) => this.up(e));
        for (const type of ['pointercancel', 'lostpointercapture'])
            el.addEventListener(type, (e) => {
                if (e.pointerId === this.id) this.cancel();
            });
        window.addEventListener('blur', () => this.cancel());
        el.addEventListener('keydown', (e) => this.key(e));
        if (keyboardTarget && keyboardTarget !== el)
            keyboardTarget.addEventListener('keydown', (e) => this.key(e));
    }
    point(e) {
        const r = this.el.getBoundingClientRect();
        if (Number.isFinite(this.coordinateScale) && this.coordinateScale > 0)
            return {
                x: (e.clientX - r.left) * this.coordinateScale,
                y: (e.clientY - r.top) * this.coordinateScale,
            };
        return {
            x: ((e.clientX - r.left) * (this.el.width || 600)) / r.width,
            y: ((e.clientY - r.top) * (this.el.height || 820)) / r.height,
        };
    }
    down(e) {
        if (!this.enabled() || this.id !== null || e.button > 0) return;
        const p = this.point(e);
        let choice = null,
            nearest = 58;
        const boss = this.getBoss();
        if (boss) {
            choice = this.getBalls().find((b) => b.ready && b.held) || null;
        } else
            for (const b of this.getBalls()) {
                const q = this.project(b.x, b.y),
                    d = Math.hypot(q.x - p.x, q.y - p.y);
                if (b.ready && d < nearest) {
                    nearest = d;
                    choice = b;
                }
            }
        if (!choice) return;
        e.preventDefault();
        this.el.focus?.({ preventScroll: true });
        this.id = e.pointerId;
        this.selected = choice.id;
        this.aim = {
            ballId: choice.id,
            start: p,
            current: p,
            vx: 0,
            vy: 0,
            power: 0,
            spin: 0,
            locked: false,
            anchor: null,
            axis: null,
            trail: [{ ...p }],
        };
        this.el.setPointerCapture(e.pointerId);
        this.onAim(this.aim);
    }
    move(e) {
        if (e.pointerId !== this.id) return;
        if (!this.enabled()) {
            this.cancel();
            return;
        }
        e.preventDefault(); // Native pointermove may carry the threshold-crossing samples only in its batch.
        // Consume supplied order (chronological per PointerEvent), then the final event
        // unless it is already represented. Pointerup and synthetic events need no batch.
        const samples = typeof e.getCoalescedEvents === 'function' ? e.getCoalescedEvents() : [];
        for (const sample of samples || []) {
            if (sample.pointerId !== undefined && sample.pointerId !== this.id) continue;
            const p = this.point(sample);
            if (Number.isFinite(p.x) && Number.isFinite(p.y)) this.aim = gestureAim(this.aim, p);
        }
        const p = this.point(e),
            last = this.aim.current;
        if (Number.isFinite(p.x) && Number.isFinite(p.y) && (p.x !== last.x || p.y !== last.y))
            this.aim = gestureAim(this.aim, p);
        this.onAim(this.aim);
    }
    up(e) {
        if (e.pointerId !== this.id) return;
        if (this.enabled()) {
            this.move(e);
            const a = this.aim;
            if (a?.power > 0) this.onLaunch(a.ballId, a.vx, a.vy, a.spin);
        }
        this.cancel();
    }
    cancel() {
        const id = this.id;
        this.id = null;
        this.aim = null;
        this.onAim(null);
        if (id !== null && this.el.hasPointerCapture?.(id)) this.el.releasePointerCapture(id);
    }
    key(e) {
        if (e.key === 'Escape') {
            this.cancel();
            return;
        }
        if (!this.enabled() || this.id !== null) return;
        const held = this.getBoss() ? this.getBalls().find((b) => b.ready && b.held) : null;
        if (held) this.selected = held.id;
        if (['1', '2', '3'].includes(e.key)) {
            if (!this.getBoss()) this.selected = +e.key - 1;
            e.preventDefault();
        } else if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
            this.keyAngle += e.key === 'ArrowLeft' ? -0.1 : 0.1;
            e.preventDefault();
        } else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
            this.keyPower = clamp(this.keyPower + (e.key === 'ArrowUp' ? 0.1 : -0.1), 0.2, 1);
            e.preventDefault();
        } else if ((e.key === ' ' || e.key === 'Enter') && !e.repeat) {
            e.preventDefault();
            const speed = 250 + 830 * this.keyPower;
            this.onLaunch(
                this.selected,
                Math.cos(this.keyAngle) * speed,
                Math.sin(this.keyAngle) * speed,
                0,
            );
            this.onAim(null);
            return;
        } else return;
        const b = this.getBalls().find((b) => b.id === this.selected && b.ready);
        if (b) {
            const p = this.project(b.x, b.y),
                speed = 250 + 830 * this.keyPower,
                ghost = worldVectorToScreen(
                    Math.cos(this.keyAngle) * 100 * this.keyPower,
                    Math.sin(this.keyAngle) * 100 * this.keyPower,
                );
            this.onAim({
                ballId: b.id,
                start: p,
                current: { x: p.x + ghost.x, y: p.y + ghost.y },
                vx: Math.cos(this.keyAngle) * speed,
                vy: Math.sin(this.keyAngle) * speed,
                power: this.keyPower,
                spin: 0,
                locked: false,
                anchor: null,
            });
        } else this.onAim(null);
    }
}
