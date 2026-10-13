import { describe, expect, it } from "vitest";
import { Tracker } from "../../claude-mod/hooks/tracker";

const m = (min: number) => min * 60_000;
const opts = { pauseMs: m(30), capMs: m(5) };

describe("Tracker (mod Claude Code)", () => {
  it("compte entier un tour court et enchaîne les tours sous la pause", () => {
    const t = new Tracker(opts);
    t.onPrompt(m(0));
    t.onTurnComplete(m(2));
    t.onPrompt(m(10)); // 8 min de silence : on lit, on teste, ça compte
    t.onTurnComplete(m(12));
    expect(t.pending()).toEqual([{ no: 1, start: 0, end: m(12), flushed: false }]);
    expect(t.totalMs()).toBe(m(12));
  });

  it("ouvre un nouveau segment après 30 min de silence", () => {
    const t = new Tracker(opts);
    t.onPrompt(m(0));
    t.onTurnComplete(m(3));
    t.onPrompt(m(40));
    t.onTurnComplete(m(42));
    const segs = t.pending();
    expect(segs.map((s) => [s.no, s.start, s.end])).toEqual([
      [1, 0, m(3)],
      [2, m(40), m(42)],
    ]);
  });

  it("plafonne un tour autonome à 5 min et repart de sa fin réelle", () => {
    const t = new Tracker(opts);
    t.onPrompt(m(0));
    t.onTurnComplete(m(20)); // Claude a bossé seul 20 min
    t.onPrompt(m(25)); // l'humain lit la réponse 5 min puis relance
    t.onTurnComplete(m(26));
    expect(t.pending().map((s) => [s.no, s.start, s.end])).toEqual([
      [1, 0, m(5)],
      [2, m(20), m(26)],
    ]);
    expect(t.totalMs()).toBe(m(11));
  });

  it("après un tour long, un retour tardif est une pause", () => {
    const t = new Tracker(opts);
    t.onPrompt(m(0));
    t.onTurnComplete(m(20));
    t.onPrompt(m(60));
    t.onTurnComplete(m(61));
    expect(t.pending().map((s) => [s.no, s.start, s.end])).toEqual([
      [1, 0, m(5)],
      [2, m(60), m(61)],
    ]);
  });

  it("ignore une fin de tour sans prompt et les segments déjà poussés", () => {
    const t = new Tracker(opts);
    t.onTurnComplete(m(1));
    expect(t.pending()).toEqual([]);
    t.onPrompt(m(2));
    t.onTurnComplete(m(3));
    t.markFlushed(1);
    expect(t.pending()).toEqual([]);
    t.onPrompt(m(4));
    t.onTurnComplete(m(5));
    expect(t.pending().map((s) => s.end)).toEqual([m(5)]);
  });

  it("se restaure depuis son état sérialisé", () => {
    const t = new Tracker(opts);
    t.onPrompt(m(0));
    t.onTurnComplete(m(2));
    const t2 = new Tracker(opts, JSON.parse(JSON.stringify(t.state())));
    t2.onPrompt(m(5));
    t2.onTurnComplete(m(6));
    expect(t2.pending()).toEqual([{ no: 1, start: 0, end: m(6), flushed: false }]);
  });
});
