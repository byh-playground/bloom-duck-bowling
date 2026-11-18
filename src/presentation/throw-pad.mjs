import { worldVectorToScreen } from './camera.mjs';
const TAU = Math.PI * 2;
// Independent, transparent input HUD; no game-world pixels or physics are drawn here.
export function renderThrowPad(
    c,
    aim,
    {
        width,
        height,
        available = true,
        paused = false,
        airborne = false,
        delivering = false,
        ready = 3,
        keyboard = false,
        doubleArmed = false,
    } = {},
) {
    c.clearRect(0, 0, width, height);
    if (!available && !paused) return;
    c.save();
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    c.lineCap = 'round';
    c.lineJoin = 'round';
    const text = (s, x, y, size, color = '#45634e') => {
        c.fillStyle = color;
        c.font = `700 ${size}px system-ui`;
        c.fillText(s, x, y);
    };
    const circle = (p, r, fill, stroke) => {
        c.beginPath();
        c.arc(p.x, p.y, r, 0, TAU);
        if (fill) {
            c.fillStyle = fill;
            c.fill();
        }
        if (stroke) {
            c.strokeStyle = stroke;
            c.lineWidth = 3;
            c.stroke();
        }
    };
    const line = (points, color, w = 3) => {
        c.beginPath();
        points.forEach((p, i) => (i ? c.lineTo(p.x, p.y) : c.moveTo(p.x, p.y)));
        c.strokeStyle = color;
        c.lineWidth = w;
        c.stroke();
    };
    if (paused) text('일시정지', width / 2, height * 0.5, 28);
    else if (airborne) text('착지 후 굴리기', width / 2, height * 0.5, 28);
    else if (delivering) {
        const beforeRelease = delivering !== 'follow';
        text('굴리는 중', width / 2, height * (beforeRelease ? 0.39 : 0.5), 28);
        if (beforeRelease) text('대시로 취소', width / 2, height * 0.64, 17);
    } else if (ready === 0) text('공 회수 대기', width / 2, height * 0.5, 28);
    else if (aim) {
        text(
            `힘 ${Math.round((aim.power || 0) * 100)}% · ${Math.abs(aim.spin || 0) > 0.01 ? (aim.spin < 0 ? '↶ 왼훅 ' : '오른훅 ↷ ') + Math.round(Math.abs(aim.spin) * 100) + '%' : '직선'}`,
            width / 2,
            23,
            21,
        );
        if (keyboard) {
            const v = worldVectorToScreen(aim.vx, aim.vy),
                n = Math.hypot(v.x, v.y) || 1,
                p = { x: width / 2, y: height * 0.58 },
                q = { x: p.x + (v.x / n) * 45, y: p.y + (v.y / n) * 45 };
            line([p, q], '#c19345', 6);
            circle(q, 6, '#c19345');
            text('방향키 조준 · Enter로 굴리기', width / 2, height - 22, 16);
        } else {
            if (aim.trail?.length > 1) line(aim.trail, '#b68a42', 5);
            if (aim.start) circle(aim.start, 9, '#b68a42');
            if (aim.locked && aim.anchor) {
                const a = aim.anchor,
                    side = { x: -aim.axis.y, y: aim.axis.x };
                c.setLineDash([4, 7]);
                line(
                    [
                        { x: a.x - side.x * 60, y: a.y - side.y * 60 },
                        { x: a.x + side.x * 60, y: a.y + side.y * 60 },
                    ],
                    '#82916b',
                    2,
                );
                c.setLineDash([]);
                circle(a, 13, null, '#a8b789');
            }
            if (aim.current) circle(aim.current, 19, '#e5c97b55', '#97763f');
            text('놓으면 굴리기 · 대시로 취소', width / 2, height - 16, 14);
        }
        if (doubleArmed) text('더블샷 준비', width / 2, 48, 16, '#778568');
    } else {
        text('밀어서 굴리기', width / 2, height * 0.39, 28);
        text('끝을 휘면 훅', width / 2, height * 0.6, 17);
        if (doubleArmed) text('더블샷 준비', width / 2, height * 0.8, 16, '#778568');
    }
    c.restore();
}
