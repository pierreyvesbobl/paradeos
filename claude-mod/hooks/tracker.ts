/**
 * Compteur de temps d'attention, pur (aucune dépendance au moteur) : le
 * mod lui passe les instants des prompts et des fins de tour, il en déduit
 * des segments début-fin à pousser dans Parade OS.
 *
 * Règles :
 *  1. Un segment court du premier prompt à la dernière réponse, tant que
 *     les silences entre une réponse et le prompt suivant restent sous
 *     `pauseMs` (30 min par défaut). Au-delà, c'est une pause : nouveau
 *     segment au prompt suivant.
 *  2. Un tour qui dépasse `capMs` (5 min) est plafonné : Claude travaille
 *     seul au-delà, l'humain fait autre chose. Le segment se ferme à
 *     prompt + cap. Si l'humain revient dans les `pauseMs` qui suivent la
 *     fin réelle du tour, le segment suivant démarre à cette fin réelle :
 *     le temps de lecture de la réponse compte, pas le temps machine.
 *  3. Les tours des sous-agents et les sessions sans personne devant
 *     l'écran sont filtrés en amont par le mod.
 */
export type Segment = {
  /** Numéro dans la session, sert de `source_ref` côté Parade OS. */
  no: number;
  start: number;
  end: number;
  /** Faux tant que la dernière version du segment n'a pas été poussée. */
  flushed: boolean;
};

export type TrackerState = {
  segments: Segment[];
  promptAt: number | null;
  resumeAt: number | null;
};

export type TrackerOptions = {
  pauseMs: number;
  capMs: number;
};

const KEPT_FLUSHED = 20;

export class Tracker {
  private readonly opts: TrackerOptions;
  private segments: Segment[] = [];
  private promptAt: number | null = null;
  private resumeAt: number | null = null;

  constructor(opts: TrackerOptions, state?: TrackerState | null) {
    this.opts = opts;
    if (state) {
      this.segments = state.segments.map((s) => ({ ...s }));
      this.promptAt = state.promptAt;
      this.resumeAt = state.resumeAt;
    }
  }

  state(): TrackerState {
    return {
      segments: this.segments.map((s) => ({ ...s })),
      promptAt: this.promptAt,
      resumeAt: this.resumeAt,
    };
  }

  private current(): Segment | null {
    return this.segments[this.segments.length - 1] ?? null;
  }

  private open(start: number): Segment {
    const no = (this.current()?.no ?? 0) + 1;
    const seg = { no, start, end: start, flushed: true };
    this.segments.push(seg);
    this.trim();
    return seg;
  }

  private trim() {
    const flushed = this.segments.filter((s) => s.flushed);
    if (flushed.length <= KEPT_FLUSHED) return;
    const dropCount = flushed.length - KEPT_FLUSHED;
    let dropped = 0;
    this.segments = this.segments.filter((s) => {
      if (dropped < dropCount && s.flushed && s !== this.current()) {
        dropped++;
        return false;
      }
      return true;
    });
  }

  /** L'humain envoie un prompt à l'instant `now`. */
  onPrompt(now: number): void {
    const cur = this.current();
    if (this.resumeAt != null) {
      // Le tour précédent a dépassé le plafond : on repart de sa fin
      // réelle si l'humain revient vite, sinon c'était une pause.
      const start = now - this.resumeAt <= this.opts.pauseMs ? this.resumeAt : now;
      this.resumeAt = null;
      this.open(start);
    } else if (!cur || now - cur.end > this.opts.pauseMs) {
      this.open(now);
    }
    this.promptAt = now;
  }

  /** Le tour principal se termine à l'instant `now`. */
  onTurnComplete(now: number): void {
    const cur = this.current();
    if (this.promptAt == null || !cur) return;
    const countedEnd = Math.min(now, this.promptAt + this.opts.capMs);
    if (countedEnd > cur.end) {
      cur.end = countedEnd;
      cur.flushed = false;
    }
    if (now - this.promptAt > this.opts.capMs) this.resumeAt = now;
    this.promptAt = null;
  }

  /** Segments dont la dernière version n'a pas encore été poussée. */
  pending(): Segment[] {
    return this.segments.filter((s) => !s.flushed && s.end > s.start).map((s) => ({ ...s }));
  }

  /** Numéro du segment en cours, pour distinguer un segment déjà fermé. */
  currentNo(): number | null {
    return this.current()?.no ?? null;
  }

  markFlushed(no: number): void {
    const seg = this.segments.find((s) => s.no === no);
    if (seg) seg.flushed = true;
  }

  /** Total compté sur la session, en millisecondes. */
  totalMs(): number {
    return this.segments.reduce((acc, s) => acc + Math.max(0, s.end - s.start), 0);
  }
}
