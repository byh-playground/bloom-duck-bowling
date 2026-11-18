// One draw per actual player shot. Independent of the campaign's enemy RNG.
export class BallBag {
    #types;
    #remaining = [];
    #last;
    #state;
    constructor(seed, spinner) {
        this.#types = spinner
            ? ['basic', 'heavy', 'rubber', 'spinner']
            : ['basic', 'heavy', 'rubber'];
        this.#state = seed >>> 0;
    }
    #random() {
        // Mulberry32: mix adjacent run seeds before each Fisher–Yates draw.
        let n = (this.#state = (this.#state + 0x6d2b79f5) >>> 0);
        n = Math.imul(n ^ (n >>> 15), n | 1);
        n ^= n + Math.imul(n ^ (n >>> 7), n | 61);
        return ((n ^ (n >>> 14)) >>> 0) / 4294967296;
    }
    draw() {
        const bag = this.#remaining;
        if (!bag.length) {
            bag.push(...this.#types);
            for (let j = bag.length - 1; j > 0; j--) {
                const k = Math.floor(this.#random() * (j + 1));
                [bag[j], bag[k]] = [bag[k], bag[j]];
            }
            // Avoid a repeat at the join without favoring any other profile.
            if (bag[bag.length - 1] === this.#last) {
                const k = Math.floor(this.#random() * (bag.length - 1));
                [bag[k], bag[bag.length - 1]] = [bag[bag.length - 1], bag[k]];
            }
        }
        return (this.#last = bag.pop());
    }
}
