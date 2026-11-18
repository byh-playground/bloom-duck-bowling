function traceBill(c, at) {
    const base = at(0, 34, 110);
    const sideLeft = at(-17, 43, 104);
    const sideRight = at(17, 43, 104);
    const tip = at(0, 61, 101);
    const baseLeft = at(-10, 34, 110);
    const baseRight = at(10, 34, 110);
    const shoulderLeft = at(-17, 37, 107);
    const shoulderRight = at(17, 37, 107);
    const roundLeft = at(-19, 54, 101);
    const roundRight = at(19, 54, 101);
    const tipLeft = at(-11, 61, 101);
    const tipRight = at(11, 61, 101);

    c.beginPath();
    c.moveTo(base.x, base.y);
    c.bezierCurveTo(baseLeft.x, baseLeft.y, shoulderLeft.x, shoulderLeft.y, sideLeft.x, sideLeft.y);
    c.bezierCurveTo(roundLeft.x, roundLeft.y, tipLeft.x, tipLeft.y, tip.x, tip.y);
    c.bezierCurveTo(tipRight.x, tipRight.y, roundRight.x, roundRight.y, sideRight.x, sideRight.y);
    c.bezierCurveTo(shoulderRight.x, shoulderRight.y, baseRight.x, baseRight.y, base.x, base.y);
    c.closePath();
}

export function drawDuckBill(c, at) {
    const lit = at(0, 42, 114);
    const shade = at(0, 53, 97);
    const color = c.createLinearGradient(lit.x, lit.y, shade.x, shade.y);
    color.addColorStop(0, '#edb467');
    color.addColorStop(0.68, '#dc9443');
    color.addColorStop(1, '#bc8040');

    c.save();
    c.lineWidth = 1.8;
    c.lineJoin = 'round';
    c.strokeStyle = '#344f40';
    c.fillStyle = color;
    traceBill(c, at);
    c.fill();
    c.stroke();
    c.clip();

    const shineLeft = at(-7, 41, 107);
    const shineMiddle = at(0, 42, 109);
    const shineRight = at(4, 43, 107);
    c.beginPath();
    c.moveTo(shineLeft.x, shineLeft.y);
    c.quadraticCurveTo(shineMiddle.x, shineMiddle.y, shineRight.x, shineRight.y);
    c.strokeStyle = '#ffe2ad88';
    c.lineCap = 'round';
    c.stroke();
    c.restore();
}
