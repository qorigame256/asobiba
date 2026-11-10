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
export const esc = (t) => String(t).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// そろった列に筆の線を引く（2026-11-06 の UI・演出・アニメーションの案。マルバツ・四目並べ・五目並べ。本人が決めたことは board-games.md）。
// box（マスを並べた入れ物。style.css で position: relative にしてある）の上に SVG を重ね、
// cells（そろったマス・石の要素。並びの順でなくてよい。どれも一直線に並ぶ）のうち、いちばん離れた2つの真ん中を結ぶ（両端は少しはみ出す）。
// 盤は描き直しのたびに作り直されるので、引き始めた時刻を覚え、引いている間に描き直したら続きから引く。
// fresh = 新しく届いた手で決まった（読み込み直し・あとから見た人には引き終えた形で出す）。同じ key の fresh が3秒の間にまた来ても始め直さない
// （3秒より後なら、同じマスでそろった次の対局として始め直す）。delay = 何 ms 待ってから引くか（置いた印・コマの動きが終わるのを待つ）。
// 位置は描き終えてから測る（requestAnimationFrame。描き直しの途中で長さを読まない決まりに当たらないように）。動きを減らす設定の端末では伸ばさない
const LINE_MS = 410; // style.css の .win-line の2本（.34s と .05s 遅れの .36s）が引き終わるまで
let lineAt = { key: null, t: -Infinity };
// 決め手のスロー（2026-11-10。main.js の slowFinish）: 線を引き始めるのをこの時刻まで遅らせる（main.js が盤を描く前に決める）。
// finishLine はすぐ引き終えた形にする（押して飛ばしたとき）
export const lineHold = { until: 0 };
export function finishLine() {
  lineAt = { ...lineAt, t: Date.now() - 10000 };
  if (typeof document !== 'undefined') for (const p of document.querySelectorAll('svg.win-line path')) p.style.animation = 'none';
}
export function winLine(box, cells, fresh, key, delay = 160) {
  if (cells.length < 2 || typeof requestAnimationFrame !== 'function') return;
  const now = Date.now();
  if (fresh && !(lineAt.key === key && now - lineAt.t < 3000)) lineAt = { key, t: Math.max(now, lineHold.until) };
  requestAnimationFrame(() => {
    if (!box.isConnected || cells.some((c) => !c.isConnected)) return; // 描き直しで外れた
    const R = box.getBoundingClientRect();
    const ox = R.left + box.clientLeft;
    const oy = R.top + box.clientTop;
    const pts = cells.map((c) => {
      const r = c.getBoundingClientRect();
      return { x: r.left + r.width / 2 - ox, y: r.top + r.height / 2 - oy, w: Math.min(r.width, r.height) };
    });
    let a = pts[0];
    let b = pts[1];
    let far = -1;
    for (const p of pts) for (const q of pts) {
      const d = (p.x - q.x) ** 2 + (p.y - q.y) ** 2;
      if (d > far) { far = d; a = p; b = q; }
    }
    const len = Math.sqrt(far) || 1;
    const ux = (b.x - a.x) / len;
    const uy = (b.y - a.y) / len;
    const ext = a.w * 0.28;
    const x1 = a.x - ux * ext;
    const y1 = a.y - uy * ext;
    const x2 = b.x + ux * ext;
    const y2 = b.y + uy * ext;
    const bend = Math.min(6, len * 0.02); // 筆らしく、まん中を少しふくらませる
    const cx = (x1 + x2) / 2 - uy * bend;
    const cy = (y1 + y2) / 2 + ux * bend;
    const NS = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(NS, 'svg');
    svg.setAttribute('class', 'win-line');
    svg.setAttribute('aria-hidden', 'true');
    svg.setAttribute('viewBox', `0 0 ${box.clientWidth} ${box.clientHeight}`);
    svg.style.setProperty('--lw', `${Math.max(3, a.w * 0.1).toFixed(1)}px`);
    const d = `M${x1.toFixed(1)} ${y1.toFixed(1)} Q${cx.toFixed(1)} ${cy.toFixed(1)} ${x2.toFixed(1)} ${y2.toFixed(1)}`;
    const t = lineAt.key === key ? Date.now() - lineAt.t : Infinity;
    for (const [cls, late] of [['soft', 50], ['core', 0]]) {
      const p = document.createElementNS(NS, 'path');
      p.setAttribute('d', d);
      p.setAttribute('pathLength', '1');
      p.setAttribute('class', cls);
      if (t >= delay + LINE_MS) p.style.animation = 'none';
      else p.style.animationDelay = `${delay + late - t}ms`;
      svg.append(p);
    }
    for (const x of box.querySelectorAll(':scope > svg.win-line')) x.remove();
    box.append(svg);
  });
}
