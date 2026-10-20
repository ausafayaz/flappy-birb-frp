import { describe, expect, it } from "vitest";
import {
    BIRD_X,
    BirdSize,
    Game,
    Physics,
    PipeSize,
    World,
    circleHit,
    collidesPipe,
    flap,
    ghostYAtTime,
    initial,
    parseCsv,
    restart,
    spawnPipe,
    tick,
    type Pipe,
} from "../src/game";

const pipeAt = (x: number, gapY = 0.5, gapH = 0.3): Pipe => ({ id: 0, x, gapY, gapH, passed: false });

describe("parseCsv", () => {
    it("skips the header and sorts rows by time", () => {
        const rows = parseCsv("gap_y,gap_height,time\n0.4,0.2,6\n0.6,0.25,2\n");
        expect(rows).toEqual([
            { gapY: 0.6, gapH: 0.25, time: 2 },
            { gapY: 0.4, gapH: 0.2, time: 6 },
        ]);
    });
});

describe("collidesPipe", () => {
    const overlappingX = BIRD_X - PipeSize.W / 2;

    it("ignores pipes that are not level with the bird", () => {
        expect(collidesPipe(0, pipeAt(World.WIDTH))).toBeNull();
    });
    it("passes through the middle of the gap", () => {
        expect(collidesPipe(World.HEIGHT / 2, pipeAt(overlappingX))).toBeNull();
    });
    it("detects the top and bottom pipe", () => {
        expect(collidesPipe(BirdSize.H, pipeAt(overlappingX))).toBe("top");
        expect(collidesPipe(World.HEIGHT - BirdSize.H, pipeAt(overlappingX))).toBe("bottom");
    });
});

describe("circleHit", () => {
    it("is true when circles touch and false when apart", () => {
        expect(circleHit(0, 0, 5, 10, 0, 5)).toBe(true);
        expect(circleHit(0, 0, 5, 11, 0, 5)).toBe(false);
    });
});

describe("ghostYAtTime", () => {
    const path = [
        { t: 0, y: 100 },
        { t: 1, y: 200 },
    ];
    it("interpolates between samples", () => expect(ghostYAtTime(path, 0.5)).toBe(150));
    it("returns null after the run ends", () => expect(ghostYAtTime(path, 2)).toBeNull());
    it("returns null for an empty path", () => expect(ghostYAtTime([], 0)).toBeNull());
});

describe("reducers", () => {
    const s0 = initial(parseCsv("gap_y,gap_height,time\n0.5,0.3,2\n"));

    it("flap sets an upward velocity", () => {
        expect(flap(s0).vy).toBe(Physics.FLAP_VY);
    });

    it("tick applies gravity and records the trail", () => {
        const s1 = tick(0.1)(s0);
        expect(s1.vy).toBeCloseTo(Physics.GRAVITY * 0.1);
        expect(s1.y).toBeGreaterThan(s0.y);
        expect(s1.trail).toHaveLength(1);
    });

    it("scores once when a pipe is passed", () => {
        const behind = { ...spawnPipe(s0.schedule[0])(s0), pipes: [pipeAt(BIRD_X - PipeSize.W - 1)] };
        const s1 = tick(0.001)(behind);
        const s2 = tick(0.001)(s1);
        expect(s1.score).toBe(1);
        expect(s2.score).toBe(1);
    });

    it("ends the round when lives run out", () => {
        const lastLife = { ...s0, lives: 1, y: 1 }; // touching the ceiling
        expect(tick(0.016)(lastLife).running).toBe(false);
    });

    it("restart resets the run and keeps the old one as a ghost", () => {
        const played = tick(0.1)(tick(0.1)(s0));
        const fresh = restart(played);
        expect(fresh.lives).toBe(Game.START_LIVES);
        expect(fresh.ghosts).toHaveLength(1);
        expect(fresh.trail).toHaveLength(0);
    });
});
