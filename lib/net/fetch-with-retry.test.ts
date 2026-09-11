import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchWithRetry } from "./fetch-with-retry";

const noSleep = async () => {};

function responses(...statuses: number[]) {
  const queue = [...statuses];
  return vi.fn(async () => new Response("x", { status: queue.shift() ?? 200 }));
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("fetchWithRetry", () => {
  it("rejoue sur 503 puis renvoie la réponse qui réussit", async () => {
    const f = responses(503, 503, 200);
    vi.stubGlobal("fetch", f);
    const res = await fetchWithRetry("https://x", { sleep: noSleep });
    expect(res.status).toBe(200);
    expect(f).toHaveBeenCalledTimes(3);
  });

  it("ne rejoue pas un 400", async () => {
    const f = responses(400, 200);
    vi.stubGlobal("fetch", f);
    const res = await fetchWithRetry("https://x", { sleep: noSleep });
    expect(res.status).toBe(400);
    expect(f).toHaveBeenCalledTimes(1);
  });

  it("abandonne après le nombre de tentatives et renvoie la dernière réponse", async () => {
    const f = responses(429, 429, 429, 200);
    vi.stubGlobal("fetch", f);
    const res = await fetchWithRetry("https://x", { sleep: noSleep, attempts: 3 });
    expect(res.status).toBe(429);
    expect(f).toHaveBeenCalledTimes(3);
  });

  it("respecte Retry-After en secondes", async () => {
    const f = vi
      .fn()
      .mockResolvedValueOnce(new Response("x", { status: 429, headers: { "retry-after": "2" } }))
      .mockResolvedValueOnce(new Response("ok", { status: 200 }));
    vi.stubGlobal("fetch", f);
    const waits: number[] = [];
    await fetchWithRetry("https://x", {
      sleep: async (ms) => {
        waits.push(ms);
      },
    });
    expect(waits).toEqual([2000]);
  });

  it("ne rejoue pas un POST sauf si demandé", async () => {
    const f = responses(503, 200);
    vi.stubGlobal("fetch", f);
    const res = await fetchWithRetry("https://x", { method: "POST", sleep: noSleep });
    expect(res.status).toBe(503);
    expect(f).toHaveBeenCalledTimes(1);

    const g = responses(503, 200);
    vi.stubGlobal("fetch", g);
    const res2 = await fetchWithRetry("https://x", {
      method: "POST",
      retryNonIdempotent: true,
      sleep: noSleep,
    });
    expect(res2.status).toBe(200);
  });

  it("rejoue une erreur réseau puis propage la dernière", async () => {
    const f = vi.fn().mockRejectedValue(new Error("ECONNRESET"));
    vi.stubGlobal("fetch", f);
    await expect(fetchWithRetry("https://x", { sleep: noSleep })).rejects.toThrow("ECONNRESET");
    expect(f).toHaveBeenCalledTimes(3);
  });
});
