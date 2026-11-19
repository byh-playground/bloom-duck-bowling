import { nextRandom } from './random.mjs';

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
        const { seed, value } = nextRandom(this.#state);
        this.#state = seed;
        return value;
    }
    snapshot() {
        return { seed: this.#state, last: this.#last ?? null, remaining: [...this.#remaining] };
    }
    restore({ seed, last, remaining }) {
        this.#state = seed;
        this.#last = last;
        this.#remaining = [...remaining];
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
