export function createReflector(
    { x, y, length, width, angleRad, height },
    originX = 0,
    originY = 0,
) {
    const centerX = x + originX;
    const centerY = y + originY;
    if (
        ![centerX, centerY, length, width, angleRad, height].every(Number.isFinite) ||
        length <= 0 ||
        width <= 0 ||
        height <= 0
    ) {
        throw new RangeError('Invalid reflector dimensions or position');
    }
    const cos = Math.cos(angleRad);
    const sin = Math.sin(angleRad);
    const halfLength = length / 2;
    const halfWidth = width / 2;
    const corner = (along, across) =>
        Object.freeze({
            x: centerX + along * cos - across * sin,
            y: centerY + along * sin + across * cos,
        });
    return Object.freeze({
        x: centerX,
        y: centerY,
        length,
        width,
        angleRad,
        height,
        cos,
        sin,
        halfLength,
        halfWidth,
        corners: Object.freeze([
            corner(-halfLength, -halfWidth),
            corner(halfLength, -halfWidth),
            corner(halfLength, halfWidth),
            corner(-halfLength, halfWidth),
        ]),
    });
}

function resolveReflector(body, rock, restitution, velocity) {
    const { cos, sin, halfLength, halfWidth } = rock;
    const dx = body.x - rock.x;
    const dy = body.y - rock.y;
    const along = dx * cos + dy * sin;
    const across = -dx * sin + dy * cos;
    const excessAlong = Math.abs(along) - halfLength;
    const excessAcross = Math.abs(across) - halfWidth;
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
    if (!reflectors?.length) return false;
    let reflected = false;
    for (const rock of reflectors) {
        if (bottom < rock.height && resolveReflector(body, rock, restitution, velocity)) {
            reflected = true;
        }
    }
    return reflected;
}
