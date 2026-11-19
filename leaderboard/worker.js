const GAME_ORIGIN = "https://dylberg.github.io";
const BANK = /* BANK */ {};
const ROUND_COUNTS = {F: 5, D: 4, B: 5, M: 1};
const ANSWER_MS = {F: 20000, D: 40000, B: 60000, M: 45000};
const EXPIRY_MS = 2 * 60 * 60 * 1000;
const BANK_REVISION = "/* BANK_REVISION */";
const FINISH_REASONS = new Set(["win", "miss", "timeout", "dip-timeout", "walk"]);
const TIMEOUTS = new Set(["timeout", "dip-timeout"]);

function json(data, status = 200) {
  return Response.json(data, {status, headers: {
    "Access-Control-Allow-Origin": GAME_ORIGIN,
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff"
  }});
}

async function readJson(request) {
  if (!/^application\/json(?:\s*;|$)/i.test(request.headers.get("Content-Type") ?? "")) return null;
  const reader = request.body?.getReader();
  if (!reader) return null;
  const decoder = new TextDecoder();
  let length = 0;
  let text = "";
  try {
    while (true) {
      const {done, value} = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > 16000) {
        await reader.cancel();
        return null;
      }
      text += decoder.decode(value, {stream: true});
    }
    return JSON.parse(text + decoder.decode());
  } catch {
    return null;
  }
}

function makeDeck() {
  return Object.entries(ROUND_COUNTS).flatMap(([tier, count]) => {
    const ids = Object.keys(BANK).filter((id) => id.startsWith(tier));
    for (let i = 0; i < count; i += 1) {
      const random = crypto.getRandomValues(new Uint32Array(1))[0];
      const selected = i + random % (ids.length - i);
      [ids[i], ids[selected]] = [ids[selected], ids[i]];
    }
    return ids.slice(0, count);
  });
}

async function startRun(db, body) {
  if (body?.revision !== BANK_REVISION) return json({error: "Reload the game to get the current question bank."}, 409);
  const now = Date.now();
  const id = crypto.randomUUID();
  const deck = makeDeck();
  const inserted = await db.prepare(
    `INSERT INTO ranked_sessions (id, issued_at, deck)
     SELECT ?, ?, ? WHERE (SELECT count(*) FROM ranked_sessions WHERE issued_at >= ?) < 120`
  ).bind(id, now, JSON.stringify(deck), now - 60000).run();
  if (inserted.meta.changes !== 1) return json({error: "The game is busy. Try again in a minute."}, 429);
  if (Math.random() < 0.05) {
    await db.prepare("DELETE FROM ranked_sessions WHERE issued_at < ?").bind(now - EXPIRY_MS).run();
  }
  return json({id, deck}, 201);
}

function verifyRun(session, answers, reason, now) {
  const deck = JSON.parse(session.deck);
  if (!Array.isArray(answers) || !answers.length || answers.length > deck.length || !FINISH_REASONS.has(reason)) return null;
  let correct = 0;
  let elapsed = 0;
  let bank = 0;
  for (const [index, answer] of answers.entries()) {
    const id = deck[index];
    const choices = BANK[id];
    const ms = answer?.milliseconds;
    const last = index === answers.length - 1;
    const limit = ANSWER_MS[id[0]] + (id[0] === "M" ? bank : 0);
    if (answer?.id !== id || !Number.isSafeInteger(ms) || ms < 0 || ms > limit + 16) return null;
    const matches = answer.choice === choices[0];
    if (answer.choice !== null && !choices.includes(answer.choice)) return null;
    if (!last && !matches) return null;
    if (last) {
      if (reason === "win" && (!matches || answers.length !== deck.length)) return null;
      if (reason === "miss" && (matches || answer.choice === null)) return null;
      if (TIMEOUTS.has(reason) && (answer.choice !== null || ms < limit - 16)) return null;
      if (reason === "walk" && (answer.choice !== null && (!matches || answers.length >= deck.length))) return null;
    }
    elapsed += ms;
    if (matches) {
      correct += 1;
      bank += Math.max(0, limit - ms);
    }
  }
  if (elapsed > now - session.issued_at + 1000) return null;
  return {correct, elapsed};
}

async function finishRun(db, body) {
  const id = body?.id;
  const name = typeof body?.displayName === "string" ? body.displayName.trim().normalize("NFC") : "";
  if (typeof id !== "string" || !/^[0-9a-f-]{36}$/.test(id) || !/^[\p{L}\p{N} ._'’-]{1,24}$/u.test(name)) {
    return json({error: "Use 1–24 characters for initials or a nickname."}, 400);
  }
  const now = Date.now();
  const session = await db.prepare("SELECT issued_at, deck FROM ranked_sessions WHERE id = ?").bind(id).first();
  if (!session || now - session.issued_at > EXPIRY_MS) return json({error: "This Pro run has expired."}, 410);
  const score = verifyRun(session, body.answers, body.reason, now);
  if (!score) return json({error: "This run could not be verified."}, 400);
  const result = await db.prepare(
    `INSERT INTO ranked_scores (run_id, name, correct, elapsed, recorded_at)
     VALUES (?, ?, ?, ?, ?) ON CONFLICT (run_id) DO NOTHING`
  ).bind(id, name, score.correct, score.elapsed, now).run();
  return json({saved: true}, result.meta.changes === 1 ? 201 : 200);
}

export default {
  async fetch(request, env) {
    const path = new URL(request.url).pathname;
    try {
      if (request.method === "GET" && path === "/") return json({service: "TraffiCalm Technician shared high scores"});
      if (request.method === "GET" && path === "/api/scores") {
        const list = await env.DB.prepare(
          "SELECT name, correct, elapsed FROM ranked_scores ORDER BY correct DESC, elapsed ASC, recorded_at ASC, run_id ASC LIMIT 10"
        ).all();
        return json({scores: list.results});
      }
      if (path === "/api/runs" || path === "/api/runs/finish") {
        if (request.headers.get("Origin") !== GAME_ORIGIN) return json({error: "Unsupported game origin."}, 403);
        if (request.method === "OPTIONS") return json({});
        if (request.method !== "POST") return json({error: "Method not allowed."}, 405);
        const body = await readJson(request);
        if (!body) return json({error: "Invalid request."}, 400);
        return await (path === "/api/runs" ? startRun(env.DB, body) : finishRun(env.DB, body));
      }
      return json({error: "Not found."}, 404);
    } catch (error) {
      console.error("Leaderboard request failed", path, error?.name);
      return json({error: "Shared scores are temporarily unavailable."}, 503);
    }
  }
};
