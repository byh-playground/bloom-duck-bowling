// Visual scoring only: no damage, collision, credit inventory, or stage rules are modified.
export class BowlingScore {
    constructor(effects) {
        this.effects = effects;
        this.shots = new Map();
        this.serial = 0;
        this.best = 0;
        this.strikes = 0;
        this.lastStrike = null;
    }
    begin(time) {
        const serial = ++this.serial;
        this.shots.set(serial, {
            at: time,
            released: false,
            targets: new Set(),
            shown: 0,
            pos: null,
            strikes: [],
        });
        return serial;
    }
    release(serial) {
        const shot = this.shots.get(serial);
        if (!shot) return;
        shot.released = true;
        this.publish(serial, shot);
    }
    advance(dt, time) {
        for (const e of this.effects) e.age += dt;
        for (let i = this.effects.length - 1; i >= 0; i--)
            if (this.effects[i].age >= this.effects[i].life) this.effects.splice(i, 1);
        for (const [serial, shot] of this.shots) if (time - shot.at > 9) this.shots.delete(serial);
    }
    damage(u, serial, { defeated = false, direct = false } = {}) {
        const shot = this.shots.get(serial);
        if (shot) {
            shot.targets.add(u.id);
            shot.pos = { x: u.x, y: u.y };
        }
        const rack = u.pinSlot?.rack.score;
        if (rack) {
            if (!shot || (rack.serial !== null && rack.serial !== serial)) rack.tainted = true;
            else if (rack.serial === null) rack.serial = serial;
            if (direct && shot && rack.serial === serial) rack.direct = true;
            if (defeated) {
                rack.down++;
                if (
                    !rack.tainted &&
                    rack.direct &&
                    rack.down === rack.size &&
                    shot &&
                    !rack.awarded
                ) {
                    rack.awarded = true;
                    shot.strikes.push({
                        x: u.pinSlot.rack.x,
                        y: u.pinSlot.rack.y,
                        count: rack.size,
                        serial,
                    });
                }
            }
        }
        if (shot?.released) this.publish(serial, shot);
    }
    publish(serial, shot) {
        const { targets, pos } = shot,
            count = targets.size;
        this.best = Math.max(this.best, count);
        if (count >= 2 && count > shot.shown && pos) {
            shot.shown = count;
            const common = { kind: 'combo', ...pos, count, shotSerial: serial, age: 0, life: 0.9 };
            const combo = this.effects.find((e) => e.kind === 'combo' && e.shotSerial === serial);
            if (!combo) this.effects.push(common);
            else if (combo.count < count) Object.assign(combo, common);
        }
        for (const strike of shot.strikes.splice(0)) {
            this.strikes++;
            this.lastStrike = { count: strike.count, shotSerial: serial };
            this.effects.push({
                kind: 'strike',
                x: strike.x,
                y: strike.y,
                count: strike.count,
                shotSerial: serial,
                age: 0,
                life: 1.65,
            });
        }
        if (this.effects.length > 6) this.effects.splice(0, this.effects.length - 6);
    }
}
