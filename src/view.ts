/**
 * Rendering. This is the only place that touches the DOM: it receives each
 * State emitted by state$ and redraws the SVG to match it.
 */

import { BIRD_X, BirdSize, PipeSize, State, World, ghostYAtTime } from "./game";

const SVG_NS = "http://www.w3.org/2000/svg";

/** Create an SVG element with the given attributes. */
const svgEl = <K extends keyof SVGElementTagNameMap>(
    tag: K,
    attrs: Readonly<Record<string, string | number>> = {},
): SVGElementTagNameMap[K] => {
    const el = document.createElementNS(SVG_NS, tag);
    for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, String(v));
    return el;
};

/** A copy of the bird sprite defined in index.html (<symbol id="bird-sprite">). */
const birdUse = (extraClass: string) =>
    svgEl("use", {
        href: "#bird-sprite",
        class: extraClass,
        width: BirdSize.W,
        height: BirdSize.H,
    });

export const createRenderer = (): ((s: State) => void) => {
    const canvas = document.getElementById("canvas") as unknown as SVGSVGElement;
    const layer = document.getElementById("dynamic") as unknown as SVGGElement;
    const ghostLayer = document.getElementById("ghosts") as unknown as SVGGElement;
    const livesText = document.getElementById("lives");
    const scoreText = document.getElementById("score");
    const overlay = document.getElementById("overlay");
    const overlayTitle = document.getElementById("overlay-title");

    canvas.setAttribute("viewBox", `0 0 ${World.WIDTH} ${World.HEIGHT}`);

    const player = birdUse("bird");
    canvas.appendChild(player);

    return (s: State) => {
        // Pipes and power-ups are rebuilt every frame.
        layer.replaceChildren(
            ...s.pipes.flatMap(p => {
                const gapCenter = p.gapY * World.HEIGHT;
                const gapHalf = (p.gapH * World.HEIGHT) / 2;
                const topH = Math.max(0, gapCenter - gapHalf);
                const bottomY = gapCenter + gapHalf;
                return [
                    svgEl("rect", { class: "pipe", x: p.x, y: 0, width: PipeSize.W, height: topH }),
                    svgEl("rect", {
                        class: "pipe",
                        x: p.x,
                        y: bottomY,
                        width: PipeSize.W,
                        height: Math.max(0, World.HEIGHT - bottomY),
                    }),
                ];
            }),
            ...s.powerups.map(pu =>
                svgEl("circle", { class: "powerup", cx: pu.x, cy: pu.y, r: pu.r }),
            ),
        );

        // Ghosts: one translucent bird per previous run, kept in sync by count.
        while (ghostLayer.childElementCount > s.ghosts.length) ghostLayer.lastElementChild?.remove();
        while (ghostLayer.childElementCount < s.ghosts.length) ghostLayer.appendChild(birdUse("ghost"));

        s.ghosts.forEach((path, i) => {
            const el = ghostLayer.children[i] as SVGUseElement;
            const gy = ghostYAtTime(path, s.t);
            el.setAttribute("visibility", gy === null ? "hidden" : "visible");
            if (gy !== null) {
                el.setAttribute("x", String(BIRD_X - BirdSize.W / 2));
                el.setAttribute("y", String(gy - BirdSize.H / 2));
            }
        });

        // Player
        player.setAttribute("x", String(BIRD_X - BirdSize.W / 2));
        player.setAttribute("y", String(s.y - BirdSize.H / 2));

        // HUD
        if (livesText) livesText.textContent = String(s.lives);
        if (scoreText) scoreText.textContent = String(s.score);

        // End-of-round overlay
        if (overlay && overlayTitle) {
            overlay.hidden = s.running;
            overlayTitle.textContent = s.lives > 0 ? "You win!" : "Game over";
        }
    };
};
