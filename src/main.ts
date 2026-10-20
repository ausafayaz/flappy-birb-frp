/**
 * Entry point: load the pipe schedule, wait for the player to start, then
 * subscribe the renderer to the game's state stream.
 */

import "./style.css";

import { defer, first, fromEvent, merge, switchMap } from "rxjs";
import { state$ } from "./game";
import { createRenderer } from "./view";

/** Pipe schedule, served from public/map.csv (works under any base path). */
const schedule$ = defer(async () => {
    const res = await fetch(`${import.meta.env.BASE_URL}map.csv`);
    if (!res.ok) throw new Error(`Could not load map.csv (HTTP ${res.status})`);
    return res.text();
});

/** First click on the page or first Space press starts the game. */
const start$ = merge(
    fromEvent(document, "pointerdown"),
    fromEvent<KeyboardEvent>(document, "keydown").pipe(first(e => e.code === "Space")),
).pipe(first());

const hint = document.getElementById("start-hint");

schedule$
    .pipe(
        switchMap(csv =>
            start$.pipe(
                switchMap(() => {
                    hint?.remove();
                    return state$(csv);
                }),
            ),
        ),
    )
    .subscribe({
        next: createRenderer(),
        error: err => {
            console.error(err);
            if (hint) hint.textContent = "Could not load the level file.";
        },
    });
