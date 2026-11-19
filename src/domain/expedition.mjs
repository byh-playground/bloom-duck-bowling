import { DEFAULT_ROUTE, routeDefinition } from './arena.mjs';
import { manualBounds } from './locomotion.mjs';

const GATE_WIDTH = 220;
const directions = Object.freeze([
    { direction: 'north', col: 0, row: -1, axis: 'y', sign: -1, key: 'minY' },
    { direction: 'west', col: -1, row: 0, axis: 'x', sign: -1, key: 'minX' },
    { direction: 'east', col: 1, row: 0, axis: 'x', sign: 1, key: 'maxX' },
]);
function edgeAt(index, origin, sizeAt) {
    if (index >= 0) {
        let edge = origin;
        for (let n = 0; n < index; n++) edge += sizeAt(n);
        return edge;
    }
    let edge = origin;
    for (let n = -1; n >= index; n--) edge -= sizeAt(n);
    return edge;
}
const idFor = (col, row) => `${col},${row}`;
function makeRoom(col, row, index, route) {
    const { arena: base, trail, widths, depths } = routeDefinition(route);
    const column = (i) => (i === 0 ? base.width : widths[(Math.abs(i) - 1) % widths.length]);
    const rowDepth = (i) => (i === 0 ? base.height : depths[(Math.abs(i) - 1) % depths.length]);
    const left = edgeAt(col, base.left, column),
        top = edgeAt(row, base.top, rowDepth),
        width = column(col),
        height = rowDepth(row),
        info = trail[index];
    const arena = Object.freeze({
        left,
        top,
        right: left + width,
        bottom: top + height,
        width,
        height,
        centerX: left + width * 0.5,
        centerY: top + height * 0.5,
        enclosedPins: true,
    });
    return Object.freeze({
        id: idFor(col, row),
        col,
        row,
        index,
        arena,
        name: info.title,
        centerX: arena.centerX,
        centerY: arena.centerY,
        originX: arena.centerX - base.centerX,
        originY: arena.top - base.top,
        ...info,
    });
}
function visibleGates(state) {
    const { room, visited } = state,
        a = room.arena;
    if (room.index === state.roomCount - 1) return [];
    // The last trail converges at the heart instead of branching again.
    const forward = room.index === state.roomCount - 2 ? directions.slice(0, 1) : directions;
    return forward.flatMap((d) => {
        const col = room.col + d.col,
            row = room.row + d.row,
            id = idFor(col, row);
        if (visited.some((r) => r.id === id) || state.closed.includes(id)) return [];
        return [
            {
                id: `${room.id}:${d.direction}`,
                direction: d.direction,
                width: GATE_WIDTH,
                open: false,
                x: d.axis === 'x' ? (d.sign < 0 ? a.left : a.right) : room.centerX,
                y: d.axis === 'y' ? a.top : room.centerY,
                to: makeRoom(col, row, room.index + 1, state.route),
            },
        ];
    });
}
export function createExpedition(route = DEFAULT_ROUTE) {
    const room = makeRoom(0, 0, 0, route);
    const state = {
        route,
        phase: 'combat',
        room,
        cameraX: room.centerX,
        cameraY: room.centerY,
        visited: [room],
        closed: [],
        gates: [],
        entryGate: null,
        roomCount: routeDefinition(route).trail.length,
        packetsSent: 0,
        packetTarget: room.packets,
    };
    state.gates = visibleGates(state);
    return state;
}

export function enterExpeditionRoom(state, gate) {
    for (const other of state.gates) if (other !== gate) state.closed.push(other.to.id);
    state.room = gate.to;
    state.entryGate = { ...gate, open: true };
    state.visited.push(state.room);
    state.phase = 'combat';
    state.packetsSent = 0;
    state.packetTarget = state.room.packets;
    state.gates = visibleGates(state);
}

export function openExpeditionGates(state) {
    state.phase = 'gates';
    for (const gate of state.gates) gate.open = true;
}

const gateAxis = (gate) => (gate.direction === 'north' ? 'y' : 'x');
const gateSign = (gate) => (gate.direction === 'east' ? 1 : -1);
const otherAxis = (axis) => (axis === 'x' ? 'y' : 'x');
const boundKey = (axis, sign) => (sign < 0 ? 'min' : 'max') + axis.toUpperCase();
const fitsGate = (boss, gate) =>
    Math.abs(boss[otherAxis(gateAxis(gate))] - gate[otherAxis(gateAxis(gate))]) <=
    gate.width * 0.5 - boss.r + 1;
const trimCrossAxis = (w, boss, gate) => {
    const across = otherAxis(gateAxis(gate)),
        half = gate.width * 0.5 - boss.r;
    w[boundKey(across, -1)] = gate[across] - half;
    w[boundKey(across, 1)] = gate[across] + half;
};
export function expeditionDuckBounds(state, boss) {
    const w = manualBounds(state.room.arena),
        entry = state.entryGate;
    if (entry?.open) {
        const axis = gateAxis(entry),
            key = boundKey(axis, -gateSign(entry));
        const padBoundary = w[key];
        if ((boss[axis] - padBoundary) * gateSign(entry) < 0) {
            w[key] = entry[axis];
            trimCrossAxis(w, boss, entry);
            return w;
        }
    }
    for (const gate of state.gates) {
        if (!gate.open || !fitsGate(boss, gate)) continue;
        const axis = gateAxis(gate),
            sign = gateSign(gate),
            key = boundKey(axis, sign);
        const boundary = w[key];
        w[key] = gate[axis];
        if ((boss[axis] - boundary) * sign >= -5) trimCrossAxis(w, boss, gate);
    }
    return w;
}

export function advanceExpeditionCamera(state, boss, dt) {
    const room = state.room,
        entry = state.entryGate;
    let targetX = room.centerX,
        targetY = room.centerY;
    if (entry?.open) {
        const axis = gateAxis(entry),
            sign = gateSign(entry),
            depth = (boss[axis] - entry[axis]) * sign;
        const release = axis === 'x' ? room.centerX : room.centerY;
        const target = boss[axis] + sign * 240;
        if (depth >= (axis === 'x' ? 65 : 75)) entry.open = false;
        if (axis === 'x')
            targetX = sign > 0 ? Math.min(release, target) : Math.max(release, target);
        else targetY = sign > 0 ? Math.min(release, target) : Math.max(release, target);
    } else if (state.phase === 'gates') {
        // Keep the room stable at range; reveal more of the adjacent canopy near an open gate.
        const gate = state.gates.reduce(
            (best, g) =>
                !best ||
                Math.hypot(g.x - boss.x, g.y - boss.y) <
                    Math.hypot(best.x - boss.x, best.y - boss.y)
                    ? g
                    : best,
            null,
        );
        if (gate) {
            const fraction = Math.max(0, 1 - Math.hypot(gate.x - boss.x, gate.y - boss.y) / 300);
            if (gateAxis(gate) === 'x') targetX += gateSign(gate) * fraction * 240;
            else targetY -= fraction * 300;
        }
    }
    const ease = 1 - Math.exp(-7 * dt);
    state.cameraX += (targetX - state.cameraX) * ease;
    state.cameraY += (targetY - state.cameraY) * ease;
}

export function crossedExpeditionGate(state, boss) {
    if (state.phase !== 'gates') return null;
    return (
        state.gates.find(
            (g) =>
                g.open &&
                fitsGate(boss, g) &&
                (boss[gateAxis(g)] - g[gateAxis(g)]) * gateSign(g) >= 0,
        ) ?? null
    );
}

export function expeditionSnapshot(state) {
    if (!state) return null;
    const {
        phase,
        room,
        cameraX,
        cameraY,
        visited,
        gates,
        entryGate,
        roomCount,
        packetsSent,
        packetTarget,
    } = state;
    return {
        phase,
        room,
        cameraX,
        cameraY,
        visited: [...visited],
        gates: gates.map((g) => ({ ...g })),
        entryGate,
        roomCount,
        packetsSent,
        packetTarget,
    };
}
