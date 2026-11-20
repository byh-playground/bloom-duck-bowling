export const LARGE_PIN_FORMATION = 15;
export const PIN_GAP = 34;
export const PIN_DEPTH = 31;

export function pinSlots(count, rack) {
    const slots = [];
    for (let row = 0; slots.length < count; row++) {
        for (let col = 0; col <= row; col++) {
            const across = (col - row / 2) * PIN_GAP;
            const back = row * PIN_DEPTH;
            slots.push({
                x: rack.x - rack.nx * back + rack.ny * across,
                y: rack.y - rack.ny * back - rack.nx * across,
            });
        }
    }
    return slots;
}
