// The pieces every page is built from: the door, the wall of doors, a band of the board.
import { showDay } from "../core/dates";
import type { FullRow } from "../list/store";

/** One letter for a verdict, as the wall and the styles know it: a lit, s dim, z out, u could not tell. */
export const LETTER: Record<string, string> = { alive: "a", "slowing down": "s", zombie: "z", "could not tell": "u" };

/** The mark: a small door with its light above it. */
export function Mark() {
  return (
    <svg width="18" height="30" viewBox="0 0 18 30" role="img" aria-label="Knock">
      <rect x="0" y="0" width="18" height="5" fill="#f7941d" />
      <rect x="0" y="6" width="18" height="24" fill="#fff" />
      <circle cx="9" cy="17" r="3" fill="none" stroke="#1f2b4d" stroke-width="2" />
    </svg>
  );
}

const LIGHT: Record<string, string> = { a: "#f7941d", s: "#8b93ad", z: "#2a3558", u: "#6f6a5f", ".": "#c9c6bf" };
const SAYS: Record<string, string> = { a: "A door with its light on", s: "A door with its light dimming", z: "A door with its light out", u: "A door, and no telling whether anyone is home", ".": "A door that has not been knocked on yet" };

/** A door drawn large. Its light says what answered: on, dimming, out, or nobody could tell. */
export function Door({ light }: { light: string }) {
  return (
    <svg width="150" height="300" viewBox="0 0 150 300" role="img" aria-label={SAYS[light] ?? SAYS["."]}>
      <rect x="0" y="0" width="150" height="48" fill={LIGHT[light] ?? LIGHT["."]} />
      <rect x="0" y="57" width="150" height="243" fill="#1f2b4d" />
      <rect x="24" y="76" width="102" height="73" fill="#2a3558" />
      <rect x="24" y="183" width="102" height="87" fill="#2a3558" />
      <circle cx="75" cy="166" r="8" fill="none" stroke="#fff" stroke-width="3" />
    </svg>
  );
}

/** The wall: one door for each row of a list, in the sheet's order. `wall` holds one letter a row. */
export function Cells({ wall, label, lights }: { wall: string; label: string; lights?: boolean }) {
  return (
    <div class={lights ? "cells lights" : "cells"} role="img" aria-label={label} data-ui>
      {[...wall].map((c) => (
        <i class={c === "." ? undefined : c}></i>
      ))}
    </div>
  );
}

/** One band of the departure board: the name, when it was last seen, the sentence, and the verdict on its block. */
export function Band({ listId, row }: { listId: string; row: FullRow }) {
  const letter = row.verdict ? (LETTER[row.verdict] ?? "u") : ".";
  return (
    <a class="row" href={`/l/${listId}/r/${row.n + 1}`}>
      <b>{row.name}</b>
      <span class="seen">{row.lastSeen ? `last seen ${showDay(row.lastSeen)}` : row.verdict ? "no date found" : ""}</span>
      <span class="because">{row.why ?? "Not knocked on yet."}</span>
      <em class={letter}>{row.verdict ?? "not yet"}</em>
    </a>
  );
}
