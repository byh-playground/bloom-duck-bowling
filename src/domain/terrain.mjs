import { nextRandom } from './random.mjs';

export function createReflector(
    { positions, length, width, angleRad, height, respawnMs },
    originX,
    originY,
    seed,
) {
    if (
        !Array.isArray(positions) ||
        !positions.length ||
        ![length, width, angleRad, height].every(Number.isFinite) ||
        length <= 0 ||
        width <= 0 ||
        height <= 0 ||
        !Number.isSafeInteger(respawnMs) ||
        respawnMs <= 0
    ) {
        throw new RangeError('Invalid reflector dimensions or position');
    }
    const shape = {
        height,
        cos: Math.cos(angleRad),
        sin: Math.sin(angleRad),
        halfLength: length / 2,
        halfWidth: width / 2,
    };
    const slots = Object.freeze(
        positions.map(({ x, y }) => {
            if (!Number.isFinite(x) || !Number.isFinite(y)) {
                throw new RangeError('Invalid reflector position');
            }
            const centerX = x + originX;
            const centerY = y + originY;
            const { cos, sin, halfLength, halfWidth } = shape;
            const corner = (along, across) =>
                Object.freeze({
                    x: centerX + along * cos - across * sin,
                    y: centerY + along * sin + across * cos,
                });
            return Object.freeze({
                ...shape,
                x: centerX,
                y: centerY,
                corners: Object.freeze([
                    corner(-halfLength, -halfWidth),
                    corner(halfLength, -halfWidth),
                    corner(halfLength, halfWidth),
                    corner(-halfLength, halfWidth),
                ]),
            });
        }),
    );
    if (new Set(slots.map(({ x, y }) => x + ',' + y)).size !== slots.length) {
        throw new RangeError('Reflector positions must not repeat');
    }
    const initial = nextRandom(seed >>> 0);
    const lifecycle = {
        returnAtMs: null,
        slotIndex: Math.floor(initial.value * slots.length),
        seed: initial.seed,
    };
    return Object.freeze({
        ...shape,
        length,
        width,
        angleRad,
        respawnMs,
        lifecycle,
        slots,
        get x() {
            return slots[lifecycle.slotIndex].x;
        },
        get y() {
            return slots[lifecycle.slotIndex].y;
        },
        get corners() {
            return slots[lifecycle.slotIndex].corners;
        },
    });
}

export const reflectorIsActive = (rock) => rock.lifecycle.returnAtMs === null;

export function breakReflector(rock, nowMs) {
    rock.lifecycle.returnAtMs = nowMs + rock.respawnMs;
}

function reflectorOffset(body, rock) {
    const dx = body.x - rock.x;
    const dy = body.y - rock.y;
    const along = dx * rock.cos + dy * rock.sin;
    const across = -dx * rock.sin + dy * rock.cos;
    return {
        along,
        across,
        excessAlong: Math.abs(along) - rock.halfLength,
        excessAcross: Math.abs(across) - rock.halfWidth,
    };
}

export function reflectorOverlaps(body, rock, bottom = 0) {
    if (bottom >= rock.height) return false;
    const { excessAlong, excessAcross } = reflectorOffset(body, rock);
    return Math.hypot(Math.max(0, excessAlong), Math.max(0, excessAcross)) < body.r;
}

export function restoreReflector(rock, nowMs, occupied) {
    const { returnAtMs } = rock.lifecycle;
    if (returnAtMs === null || nowMs < returnAtMs) return false;
    const available = rock.slots.flatMap((slot, index) =>
        (rock.slots.length > 1 && index === rock.lifecycle.slotIndex) || occupied(slot)
            ? []
            : [index],
    );
    if (!available.length) return false;

    const { seed, value } = nextRandom(rock.lifecycle.seed);
    rock.lifecycle.seed = seed;
    rock.lifecycle.slotIndex = available[Math.floor(value * available.length)];
    rock.lifecycle.returnAtMs = null;
    return true;
}

function resolveReflector(body, rock, restitution, velocity) {
    const { cos, sin } = rock;
    const { along, across, excessAlong, excessAcross } = reflectorOffset(body, rock);
    const radius = body.r;
    if (excessAlong >= radius || excessAcross >= radius) return false;

    const signAlong = along < 0 ? -1 : 1;
    const signAcross = across < 0 ? -1 : 1;
    let normalAlong;
    let normalAcross;
    let correction;
    if (excessAlong > 0 || excessAcross > 0) {
        const nearestAlong = Math.max(0, excessAlong) * signAlong;
        const nearestAcross = Math.max(0, excessAcross) * signAcross;
        const distance = Math.hypot(nearestAlong, nearestAcross);
        if (distance >= radius) return false;
        normalAlong = nearestAlong / distance;
        normalAcross = nearestAcross / distance;
        correction = radius - distance;
    } else if (excessAlong >= excessAcross) {
        // Centers inside the footprint leave through the nearest face.
        normalAlong = signAlong;
        normalAcross = 0;
        correction = radius - excessAlong;
    } else {
        normalAlong = 0;
        normalAcross = signAcross;
        correction = radius - excessAcross;
    }

    const nx = normalAlong * cos - normalAcross * sin;
    const ny = normalAlong * sin + normalAcross * cos;
    body.x += nx * correction;
    body.y += ny * correction;
    const normalSpeed = velocity ? velocity.vx * nx + velocity.vy * ny : 0;
    if (normalSpeed >= 0) return false;
    const impulse = (1 + restitution) * normalSpeed;
    velocity.vx -= impulse * nx;
    velocity.vy -= impulse * ny;
    return restitution > 0;
}

export function resolveReflectors(body, reflectors, bottom = 0, restitution = 0, velocity = body) {
    if (!reflectors?.length) return null;
    for (const rock of reflectors) {
        if (
            reflectorIsActive(rock) &&
            bottom < rock.height &&
            resolveReflector(body, rock, restitution, velocity)
        )
            return rock;
    }
    return null;
}
