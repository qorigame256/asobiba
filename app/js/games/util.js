// カードゲームで共通に使う小道具。
// シャッフルは「種（seed）」から毎回同じ並びを作る。全員の端末が同じ種から同じ山札を作るので、山札そのものは送らなくてよい。
// ルール（init / apply）の中では Math.random を使わないこと。CPU の考え（cpu）はホストだけが動かすので使ってよい。

export function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// 元の配列は変えず、混ぜた新しい配列を返す
export function shuffle(arr, rng) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/* ---------- 盤のゲームの CPU ---------- */

// 盤のゲームの詳細設定「CPU の強さ」
export const CPU_SETTING = {
  key: 'cpu', label: 'CPU の強さ', desc: 'CPU と対局するときの強さ', def: 'weak',
  choices: [['weak', 'よわい'], ['normal', 'ふつう'], ['strong', 'つよい']],
};

// 何手先まで読んで手を選ぶ（ネガマックス法＋アルファベータ法）。
// legal(局面) → 打てる手の一覧、score(局面, p) → 決着前の局面の p から見た点数（勝ち負けより十分小さく）。
// opts = { depth: { weak, normal, strong }, mistake: { weak, normal, strong } }。mistake は適当に打つ割合。
// CPU はホストの端末だけで動くので Math.random を使ってよい。
export function boardCpu(game, st, rules, legal, score, opts) {
  const level = opts.depth[rules?.cpu] !== undefined ? rules.cpu : 'weak';
  const moves = legal(st);
  if (moves.length === 1) return moves[0];
  if (Math.random() < opts.mistake[level]) return moves[Math.floor(Math.random() * moves.length)];
  const WIN = 1e6;
  const nega = (s, depth, alpha, beta, who) => {
    const res = game.result(s);
    if (res) return res.winner === null ? 0 : res.winner === who ? WIN + depth : -WIN - depth;
    if (depth === 0) return score(s, who);
    let best = -Infinity;
    for (const m of legal(s)) {
      const child = game.apply(s, m);
      const next = game.result(child) ? who : game.turn(child);
      const v = next === who ? nega(child, depth - 1, alpha, beta, who) : -nega(child, depth - 1, -beta, -alpha, next);
      if (v > best) best = v;
      if (best > alpha) alpha = best;
      if (alpha >= beta) break;
    }
    return best;
  };
  const me = game.turn(st);
  let best = -Infinity;
  let top = [];
  for (const m of moves) {
    const child = game.apply(st, m);
    const next = game.result(child) ? me : game.turn(child);
    const d = opts.depth[level] - 1;
    const v = next === me ? nega(child, d, -Infinity, Infinity, me) : -nega(child, d, -Infinity, Infinity, next);
    if (v > best) { best = v; top = [m]; } else if (v === best) top.push(m);
  }
  return top[Math.floor(Math.random() * top.length)]; // 同じ点数なら毎回違う手に
}

// 人の名前など、外から来た文字を HTML に埋め込むときに使う
// 4人のチーム戦（マルバツ・コネクトフォー・リバーシの詳細設定。2026-10-06 本人の決定）: 席 0・2 と 1・3 が味方（1つおき＝向かい合う2人）。
export const TEAM_SETTING = { key: 'team', label: 'チーム戦', desc: '4人のとき、1・3番目と2・4番目がチーム。どちらかが勝てばチームの勝ち', def: false };
export const teamOn = (rules) => rules?.team === true && rules?.players === 4;
export const isMate = (s, p, q) => !!s.team && p !== q && (p - q) % 2 === 0; // q が p の味方か
// 勝った人のチームの2人を winners に入れる（team = チームの番号 0 か 1）。引き分けはそのまま
export function teamResult(res) {
  if (!res || res.winner === null || res.winner === undefined) return res;
  const t = res.winner % 2;
  return { ...res, winners: [t, t + 2], team: t };
}

// おすすめの手（main.js。2026-10-06 本人の決定）: 盤のゲームの render に o.hint として渡る手と、m が同じ手か
export const hintIs = (o, m) => o?.hint !== undefined && o.hint !== null && JSON.stringify(o.hint) === JSON.stringify(m);
// 将棋の仲間の手（{ f, t } / { d, t }）で光らせるマス（動かす駒と行き先）
export const hintSquares = (o) => {
  const h = o?.hint;
  if (!h || typeof h !== 'object' || !Number.isInteger(h.t)) return new Set();
  return new Set(h.d ? [h.t] : [h.f, h.t]);
};

export const esc = (t) => String(t).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
