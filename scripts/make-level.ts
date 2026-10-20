/**
 * Level generator: writes public/map.csv.
 *
 * Gap positions follow a bounded random walk, so each gap is reachable from
 * the previous one instead of jumping randomly from top to bottom.
 * Gaps also shrink slightly over the course of the level to ramp difficulty.
 *
 * Usage:  npm run level -- [pipeCount] [seed]
 */

import { writeFileSync } from "node:fs";

type Row = Readonly<{ gapY: number; gapH: number; time: number }>;

/** Small seeded PRNG (mulberry32) so levels are reproducible. */
const prng = (seed: number) => () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};

const clamp = (lo: number, hi: number) => (x: number) => Math.min(hi, Math.max(lo, x));

const makeLevel = (count: number, seed: number): ReadonlyArray<Row> => {
    const rand = prng(seed);
    const keepInside = clamp(0.25, 0.75);
    const MAX_STEP = 0.25; // largest change in gap centre between pipes
    const FIRST_PIPE_AT = 2; // seconds
    const SPACING = 2; // seconds between pipes

    return Array.from({ length: count }).reduce<ReadonlyArray<Row>>((rows, _, i) => {
        const prevY = rows.length ? rows[rows.length - 1].gapY : 0.5;
        const gapY = keepInside(prevY + (rand() * 2 - 1) * MAX_STEP);
        const progress = count > 1 ? i / (count - 1) : 0;
        const gapH = 0.3 - 0.08 * progress + rand() * 0.03; // ~0.33 down to ~0.22
        return [...rows, { gapY, gapH, time: FIRST_PIPE_AT + i * SPACING }];
    }, []);
};

const toCsv = (rows: ReadonlyArray<Row>) =>
    ["gap_y,gap_height,time", ...rows.map(r => `${r.gapY.toFixed(4)},${r.gapH.toFixed(4)},${r.time}`)].join(
        "\n",
    );

const [count = "20", seed = String(Date.now())] = process.argv.slice(2);
const out = new URL("../public/map.csv", import.meta.url);
writeFileSync(out, toCsv(makeLevel(Number(count), Number(seed))) + "\n");
console.log(`Wrote ${count} pipes to public/map.csv (seed ${seed})`);
