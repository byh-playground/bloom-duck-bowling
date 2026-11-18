import { screenVectorToWorld } from '../presentation/camera.mjs';
// Separate pointer ownership from BowlingInput: never listens for canvas pointers or cancels a throw.
export const STICK = { radius: 64, deadzone: 4, dashThreshold: 6 };
const editable = (target) =>
    !!(
        target?.isContentEditable ||
        target?.closest?.('input,textarea,select,[contenteditable="true"],[contenteditable=""]') ||
        ['INPUT', 'TEXTAREA', 'SELECT'].includes(target?.tagName)
    );
const moveKey = (e) =>
    ({ KeyW: 'w', KeyA: 'a', KeyS: 's', KeyD: 'd' })[e.code] ||
    (['w', 'a', 's', 'd'].includes(e.key?.toLowerCase()) ? e.key.toLowerCase() : null);
export function stickVector(dx, dy, radius = STICK.radius) {
    if (!Number.isFinite(dx) || !Number.isFinite(dy) || !Number.isFinite(radius) || radius <= 0)
        return { x: 0, y: 0, px: 0, py: 0 };
    const distance = Math.hypot(dx, dy),
        visualScale = Math.min(1, radius / (distance || 1));
    const scaled =
        distance <= STICK.deadzone
            ? 0
            : Math.min(1, (distance - STICK.deadzone) / Math.max(1, radius - STICK.deadzone)) **
              1.2;
    const world = screenVectorToWorld(dx, dy),
        n = Math.hypot(world.x, world.y) || 1;
    return {
        x: (world.x / n) * scaled,
        y: (world.y / n) * scaled,
        px: dx * visualScale,
        py: dy * visualScale,
    };
}
export class MovementInput {
    constructor({
        stick,
        onMove = () => {},
        onDash = () => {},
        enabled = () => true,
        onChange = () => {},
        keyboardTarget = globalThis.window,
        documentTarget = globalThis.document,
    }) {
        this.stick = stick;
        this.onMove = onMove;
        this.onDash = onDash;
        this.enabled = enabled;
        this.onChange = onChange;
        this.keyboardTarget = keyboardTarget;
        this.documentTarget = documentTarget;
        this.pointerId = null;
        this.pointerArmed = false;
        this.keys = new Set();
        this.vector = { x: 0, y: 0, px: 0, py: 0 };
        this.listeners = [];
        this.destroyed = false;
        this.listen(stick, 'pointerdown', (e) => this.down(e));
        this.listen(stick, 'pointermove', (e) => this.move(e));
        for (const name of ['pointerup', 'pointercancel', 'lostpointercapture'])
            this.listen(stick, name, (e) => this.end(e));
        this.listen(keyboardTarget, 'keydown', (e) => this.key(e, true));
        this.listen(keyboardTarget, 'keyup', (e) => this.key(e, false));
        this.listen(keyboardTarget, 'blur', () => this.reset());
        this.listen(documentTarget, 'visibilitychange', () => {
            if (documentTarget.hidden || documentTarget.visibilityState === 'hidden') this.reset();
        });
        this.publish();
    }
    get dashArmed() {
        return this.pointerId !== null ? this.pointerArmed : this.keys.size === 0;
    }
    listen(target, type, handler) {
        if (!target?.addEventListener) return;
        target.addEventListener(type, handler);
        this.listeners.push([target, type, handler]);
    }
    ready() {
        if (this.destroyed) return false;
        if (!this.enabled()) {
            this.reset();
            return false;
        }
        return true;
    }
    refresh() {
        return this.ready();
    }
    repeatDash() {
        if (!this.ready()) return false;
        const held =
            this.pointerId !== null
                ? !this.pointerArmed && Math.hypot(this.vector.x, this.vector.y) > 0.001
                : this.keys.has('a') !== this.keys.has('d') ||
                  this.keys.has('w') !== this.keys.has('s');
        return (
            held &&
            this.onDash({ source: this.pointerId !== null ? 'pointer-hold' : 'keyboard-hold' })
        );
    }
    release(target, id) {
        if (id !== null && target?.hasPointerCapture?.(id)) {
            try {
                target.releasePointerCapture(id);
            } catch {
                /* A browser may already have revoked capture. */
            }
        }
    }
    down(e) {
        if (!this.ready() || this.pointerId !== null || e.button > 0) return;
        e.preventDefault();
        e.stopPropagation();
        this.pointerId = e.pointerId;
        this.pointerArmed = true;
        this.stick.setPointerCapture?.(e.pointerId);
        // Every fresh directional touch dashes immediately; a neutral touch only arms.
        this.updatePointer(e, true);
    }
    move(e) {
        if (e.pointerId !== this.pointerId || !this.ready()) return;
        e.preventDefault();
        e.stopPropagation();
        this.updatePointer(e, true);
    }
    updatePointer(e, allowDash) {
        const box = this.stick.getBoundingClientRect(),
            radius = Math.min(box.width, box.height) / 2,
            dx = e.clientX - box.left - box.width / 2,
            dy = e.clientY - box.top - box.height / 2;
        if (!Number.isFinite(dx) || !Number.isFinite(dy) || radius <= 0) return;
        const distance = Math.hypot(dx, dy);
        this.vector = stickVector(dx, dy, radius);
        if (distance <= STICK.deadzone) this.pointerArmed = true;
        const attempt = allowDash && this.pointerArmed && distance >= STICK.dashThreshold;
        // A fresh directional edge attempts once; repeats only run while direction is still held.
        if (this.pointerArmed && !attempt) {
            this.vector.x = 0;
            this.vector.y = 0;
        }
        if (attempt) this.pointerArmed = false;
        this.publish(); // Deliver the direction before attempting the dash.
        if (attempt) this.onDash({ source: 'pointer', eventTimeStamp: e.timeStamp });
    }
    end(e) {
        if (e.pointerId !== this.pointerId) return;
        e.preventDefault();
        const id = this.pointerId;
        this.pointerId = null;
        this.pointerArmed = false;
        this.vector = { x: 0, y: 0, px: 0, py: 0 };
        this.release(this.stick, id);
        this.publish();
    }
    key(e, down) {
        const key = moveKey(e);
        if (!down && key && this.keys.has(key)) {
            this.keys.delete(key);
            this.publish();
            return;
        }
        if (editable(e.target) || !this.ready() || !key || e.ctrlKey || e.metaKey || e.altKey)
            return;
        e.preventDefault();
        // An OS repeat after blur/pause is not a fresh intentional press.
        if (!down || e.repeat || this.keys.has(key)) return;
        const attempt = this.pointerId === null;
        this.keys.add(key);
        this.publish();
        if (attempt) this.onDash({ source: 'keyboard', eventTimeStamp: e.timeStamp });
    }
    publish() {
        let { x, y, px, py } = this.vector;
        if (this.pointerId === null) {
            x = Number(this.keys.has('d')) - Number(this.keys.has('a'));
            y = Number(this.keys.has('s')) - Number(this.keys.has('w'));
            const n = Math.hypot(x, y) || 1;
            x /= n;
            y /= n;
            px = x * STICK.radius;
            py = y * STICK.radius;
            const world = screenVectorToWorld(x, y),
                wn = Math.hypot(world.x, world.y) || 1;
            x = world.x / wn;
            y = world.y / wn;
        }
        // Visual knob travel is independent of the input radius and world-vector sensitivity.
        // The 44px knob stays inside the enlarged surface; onset remains 6 CSS pixels.
        const box = this.stick?.getBoundingClientRect?.(),
            visualRadius = box ? Math.max(0, Math.min(box.width, box.height) / 2 - 22) : 42;
        const visualLength = Math.hypot(px, py),
            visualScale = Math.min(1, visualRadius / (visualLength || 1));
        px *= visualScale;
        py *= visualScale;
        this.stick?.style?.setProperty('--stick-x', `${px}px`);
        this.stick?.style?.setProperty('--stick-y', `${py}px`);
        this.onMove(x, y);
        this.onChange({
            x,
            y,
            px,
            py,
            active: Math.hypot(x, y) > 0,
            pointerId: this.pointerId,
            dashArmed: this.dashArmed,
            dashState:
                this.pointerId !== null
                    ? this.pointerArmed
                        ? 'ready'
                        : 'return-center'
                    : this.keys.size === 0
                      ? 'ready'
                      : 'release-keys',
        });
    }
    reset() {
        const id = this.pointerId;
        this.pointerId = null;
        this.pointerArmed = false;
        this.keys.clear();
        this.vector = { x: 0, y: 0, px: 0, py: 0 };
        this.release(this.stick, id);
        this.publish();
    }
    destroy() {
        if (this.destroyed) return;
        this.reset();
        for (const [target, type, handler] of this.listeners)
            target.removeEventListener(type, handler);
        this.listeners = [];
        this.destroyed = true;
    }
}
