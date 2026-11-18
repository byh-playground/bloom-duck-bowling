import { ARENA } from '../domain/arena.mjs';
// Fixed portrait framing keeps all three entrances and the lower rail in view.
export const CAMERA = Object.freeze({
    yaw: (-4 * Math.PI) / 180,
    pitch: (38 * Math.PI) / 180,
    scale: 0.74,
    worldCenter: Object.freeze({ x: ARENA.centerX, y: ARENA.centerY }),
    screenAnchor: Object.freeze({ x: 320, y: 371 }),
    width: 640,
    height: 720,
});
const cy = Math.cos(CAMERA.yaw),
    sy = Math.sin(CAMERA.yaw),
    sp = Math.sin(CAMERA.pitch),
    cp = Math.cos(CAMERA.pitch);
export function worldVectorToScreen(dx, dy) {
    return { x: CAMERA.scale * (dx * cy + dy * sy), y: CAMERA.scale * (-dx * sy + dy * cy) * sp };
}
export function screenVectorToWorld(dx, dy) {
    const u = dx / CAMERA.scale,
        v = dy / (CAMERA.scale * sp);
    return { x: u * cy - v * sy, y: u * sy + v * cy };
}
export function project(x, y, z = 0) {
    const p = worldVectorToScreen(x - CAMERA.worldCenter.x, y - CAMERA.worldCenter.y);
    return {
        x: CAMERA.screenAnchor.x + p.x,
        y: CAMERA.screenAnchor.y + p.y - CAMERA.scale * z * cp,
    };
}
export function unproject(sx, sy, z = 0) {
    const p = screenVectorToWorld(
        sx - CAMERA.screenAnchor.x,
        sy - CAMERA.screenAnchor.y + CAMERA.scale * z * cp,
    );
    return { x: p.x + CAMERA.worldCenter.x, y: p.y + CAMERA.worldCenter.y };
}
export function cameraDepth(x, y, z = 0) {
    return (-(x - CAMERA.worldCenter.x) * sy + (y - CAMERA.worldCenter.y) * cy) * cp + z * sp;
}
