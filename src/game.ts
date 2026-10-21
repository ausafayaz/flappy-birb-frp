/**
 * Game model for Flappy Birb.
 *
 * Everything in this file is pure: the game state is an immutable value and
 * every event (a frame tick, a key press, a scheduled pipe) is turned into a
 * small "reducer" function State -> State. The reducers are merged into one
 * stream and folded with `scan`, which gives a single Observable<State>.
 * Rendering lives in view.ts and never feeds back into the model.
 */

import {
    Observable,
    filter,
    fromEvent,
    interval,
    map,
    merge,
    scan,
    startWith,
} from "rxjs";

/* ------------------------------------------------------------------ */
/* Configuration                                                       */
/* ------------------------------------------------------------------ */

/** World dimensions and frame timing. */
export const World = {
    WIDTH: 600,
    HEIGHT: 400,
    FRAME_MS: 16, // ~60 fps
    BIRD_X_RATIO: 0.3, // the bird stays at 30% of the canvas width
} as const;

/** Size of the bird's bounding box, in pixels. */
export const BirdSize = {
    W: 42,
    H: 30,
} as const;

/** Pipe geometry. */
export const PipeSize = {
    W: 50,
} as const;

/** Physics / gameplay tuning. */
export const Physics = {
    GRAVITY: 900, // pixels per second^2
    FLAP_VY: -300, // vertical kick in pixels per second
    PIPE_SPEED: 120, // how fast pipes/power-ups travel from right to left
} as const;

export const Game = {
    START_LIVES: 3,
    MAX_SCORE: 15, // win at this score
} as const;

export const Power = {
    RADIUS: 10, // orb size
    SCORE_BONUS: 3, // +3 score when collected
    LIFE_BONUS: 1, // +1 life when collected
    PERIOD_S: 8, // spawn every 8 seconds of game time
    SPEED: Physics.PIPE_SPEED,
} as const;

/** Horizontal centre of the bird, in pixels. */
export const BIRD_X = World.WIDTH * World.BIRD_X_RATIO;

/* ------------------------------------------------------------------ */
/* Types                                                               */
/* ------------------------------------------------------------------ */

export type CsvRow = Readonly<{ gapY: number; gapH: number; time: number }>;

export type Pipe = Readonly<{
    id: number;
    x: number; // pixels from left
    gapY: number; // 0..1 (centre of gap as fraction of canvas height)
    gapH: number; // 0..1 (gap height as fraction of canvas height)
    passed: boolean; // used to count score exactly once
}>;

export type PowerUp = Readonly<{
    id: number;
    x: number;
    y: number; // pixels from top
    r: number; // radius
}>;

export type Sample = Readonly<{ t: number; y: number }>;

export type State = Readonly<{
    // time
    t: number; // seconds since run started
    // bird
    y: number; // centre y of bird
    vy: number; // vertical velocity
    lives: number; // remaining lives
    // world
    pipes: ReadonlyArray<Pipe>;
    spawned: number; // how many CSV rows have been spawned
    score: number;
    running: boolean; // true while the round is ongoing
    // CSV
    schedule: ReadonlyArray<CsvRow>;
    // ghosts
    trail: ReadonlyArray<Sample>; // current run samples
    ghosts: ReadonlyArray<ReadonlyArray<Sample>>; // earlier runs
    // power-ups
    powerups: ReadonlyArray<PowerUp>;
    nextPowerId: number;
}>;

export type Reducer = (s: State) => State;

/* ------------------------------------------------------------------ */
/* Pure helpers                                                        */
/* ------------------------------------------------------------------ */

/**
 * Build the starting state from a CSV schedule.
 * Takes the list of ghosts so earlier runs can replay on the next one.
 */
export const initial = (
    schedule: ReadonlyArray<CsvRow>,
    ghosts: ReadonlyArray<ReadonlyArray<Sample>> = [],
): State => ({
    t: 0,
    y: World.HEIGHT / 2,
    vy: 0,
    lives: Game.START_LIVES,
    pipes: [],
    spawned: 0,
    score: 0,
    running: true as boolean,
    schedule,
    trail: [],
    ghosts,
    powerups: [],
    nextPowerId: 0,
});

/**
 * Turn the CSV text into a list of spawn instructions.
 * Each row says: "At second = time, create a pipe with gap (gapY, gapH)".
 */
export const parseCsv = (csvContents: string): ReadonlyArray<CsvRow> =>
    csvContents
        .trim()
        .split("\n")
        .slice(1)
        .map(row => {
            const [gapY, gapH, time] = row.split(",").map(Number);
            return { gapY, gapH, time } as CsvRow;
        })
        .sort((a, b) => a.time - b.time);

/**
 * Random bounce after a hit:
 *   - hitting a top surface sends the bird down (positive vy)
 *   - hitting a bottom surface sends the bird up (negative vy)
 */
export const bounce = (isTop: boolean, rand: () => number = Math.random) => {
    const mag = 150 + rand() * 200;
    return isTop ? +mag : -mag;
};

/**
 * Pipe collision test, treating the bird as an axis-aligned box.
 * Returns "top" if we hit the upper pipe, "bottom" for the lower one, else null.
 */
export const collidesPipe = (y: number, p: Pipe): "top" | "bottom" | null => {
    const halfH = BirdSize.H / 2;
    const withinX =
        BIRD_X + BirdSize.W / 2 > p.x && BIRD_X - BirdSize.W / 2 < p.x + PipeSize.W;
    if (!withinX) return null;

    const gapCenter = p.gapY * World.HEIGHT;
    const gapHpx = p.gapH * World.HEIGHT;
    const gapTop = gapCenter - gapHpx / 2;
    const gapBottom = gapCenter + gapHpx / 2;

    if (y - halfH < gapTop) return "top";
    if (y + halfH > gapBottom) return "bottom";
    return null;
};

/** Circle overlap test for power-ups. */
export const circleHit = (
    x1: number,
    y1: number,
    r1: number,
    x2: number,
    y2: number,
    r2: number,
) => {
    const dx = x1 - x2,
        dy = y1 - y2;
    return dx * dx + dy * dy <= (r1 + r2) * (r1 + r2);
};

/** Ghost position at time t, linearly interpolated (null once the run is over). */
export function ghostYAtTime(path: ReadonlyArray<Sample>, t: number): number | null {
    if (path.length === 0) return null;
    if (t <= path[0].t) return path[0].y;
    const last = path[path.length - 1];
    if (t > last.t) return null;
    for (let i = 0; i < path.length - 1; i++) {
        const a = path[i],
            b = path[i + 1];
        if (t >= a.t && t <= b.t) {
            const u = (t - a.t) / (b.t - a.t);
            return a.y + (b.y - a.y) * u;
        }
    }
    return last.y;
}

/**
 * Spawn every scheduled pipe whose time has come.
 *
 * Spawning is driven by game time (s.t), not by wall-clock timers, so a
 * restart replays the level from the beginning: the schedule index resets
 * with the rest of the state. The schedule is sorted by time, so we only
 * ever look at rows from `spawned` onwards.
 */
export const spawnDuePipes = (s: State): State => {
    if (!s.running || s.score >= Game.MAX_SCORE) return s;
    let spawned = s.spawned;
    const fresh: Pipe[] = [];
    while (spawned < s.schedule.length && s.schedule[spawned].time <= s.t) {
        const row = s.schedule[spawned];
        fresh.push({ id: spawned, x: World.WIDTH, gapY: row.gapY, gapH: row.gapH, passed: false });
        spawned++;
    }
    return fresh.length ? { ...s, pipes: [...s.pipes, ...fresh], spawned } : s;
};

/** Add a power-up every Power.PERIOD_S seconds of game time. */
export const spawnDuePower =
    (rand: () => number = Math.random) =>
    (s: State): State => {
        const due = (s.nextPowerId + 1) * Power.PERIOD_S;
        if (!s.running || s.score >= Game.MAX_SCORE || s.t < due) return s;
        const margin = 40;
        const y = margin + rand() * (World.HEIGHT - margin * 2);
        const pu: PowerUp = { id: s.nextPowerId, x: World.WIDTH, y, r: Power.RADIUS };
        return { ...s, powerups: [...s.powerups, pu], nextPowerId: s.nextPowerId + 1 };
    };

/* ------------------------------------------------------------------ */
/* Reducers                                                            */
/* ------------------------------------------------------------------ */

/** Space: give the bird an upward kick. */
export const flap: Reducer = s => (s.running ? { ...s, vy: Physics.FLAP_VY } : s);

/** One frame: advance the world, then spawn anything that is now due. */
export const tick =
    (dt: number, rand: () => number = Math.random): Reducer =>
    (s: State): State =>
        spawnDuePower(rand)(spawnDuePipes(advance(dt)(s)));

/** Physics, collisions, scoring and ghost recording for one frame. */
const advance =
    (dt: number): Reducer =>
    (s0: State): State => {
        if (!s0.running) return s0;

        const t = s0.t + dt;

        // Physics
        let vy = s0.vy + Physics.GRAVITY * dt;
        let y = s0.y + vy * dt;
        let lives = s0.lives;
        let score = s0.score;
        let running: boolean = s0.running;

        const birdR = Math.min(BirdSize.W, BirdSize.H) / 2;

        // Bounce off the ceiling / floor
        if (y - BirdSize.H / 2 <= 0) {
            y = BirdSize.H / 2;
            vy = bounce(true);
            lives--;
        } else if (y + BirdSize.H / 2 >= World.HEIGHT) {
            y = World.HEIGHT - BirdSize.H / 2;
            vy = bounce(false);
            lives--;
        }

        // Move pipes
        let pipes = s0.pipes
            .map(p => ({ ...p, x: p.x - Physics.PIPE_SPEED * dt }))
            .filter(p => p.x + PipeSize.W > 0);

        // Pipe collisions + scoring
        pipes = pipes.map(p => {
            const hit = collidesPipe(y, p);
            if (hit) {
                vy = bounce(hit === "top");
                lives--;
            }
            const crossed = !p.passed && BIRD_X > p.x + PipeSize.W;
            if (crossed) score++;
            return crossed ? { ...p, passed: true } : p;
        });

        // Move power-ups
        let powerups = s0.powerups
            .map(pu => ({ ...pu, x: pu.x - Power.SPEED * dt }))
            .filter(pu => pu.x + pu.r > 0);

        // Collect power-ups
        powerups = powerups.filter(pu => {
            const hit = circleHit(BIRD_X, y, birdR, pu.x, pu.y, pu.r);
            if (hit) {
                score += Power.SCORE_BONUS;
                lives += Power.LIFE_BONUS;
                return false;
            }
            return true;
        });

        // End conditions
        if (lives <= 0) running = false;
        if (score >= Game.MAX_SCORE) running = false;
        if (
            pipes.length === 0 &&
            s0.spawned >= s0.schedule.length &&
            s0.schedule.length > 0
        ) {
            running = false;
        }

        // Record ghost trail
        const trail = [...s0.trail, { t, y } as Sample];

        return { ...s0, t, y, vy, lives, pipes, powerups, score, running, trail };
    };

/** R: keep the finished run as a ghost and start over. */
export const restart: Reducer = s => {
    const ghosts = s.trail.length > 0 ? [...s.ghosts, s.trail] : s.ghosts;
    return initial(s.schedule, ghosts);
};

/* ------------------------------------------------------------------ */
/* State stream                                                        */
/* ------------------------------------------------------------------ */

/**
 * Wire inputs and timers to reducers, merge them, and fold into State.
 *
 *   tick       every frame        physics, collisions, scoring, and
 *                                 spawning pipes / power-ups on game time
 *   flap       Space              upward kick
 *   restart    R                  save ghost, reset (level replays from t = 0)
 */
export const state$ = (csvContents: string): Observable<State> => {
    const schedule = parseCsv(csvContents);

    const keydown$ = fromEvent<KeyboardEvent>(document, "keydown");
    const key$ = (code: string) => keydown$.pipe(filter(e => e.code === code));

    const reducers$ = merge(
        interval(World.FRAME_MS).pipe(map(() => tick(World.FRAME_MS / 1000))),
        key$("Space").pipe(map(() => flap)),
        key$("KeyR").pipe(map(() => restart)),
    );

    return reducers$.pipe(
        startWith<Reducer>(s => s), // emit the initial state immediately
        scan((s, reducer) => reducer(s), initial(schedule)),
    );
};
