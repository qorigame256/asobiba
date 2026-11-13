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
// 相手の迷いが見える（2026-11-11 本人の選択。room.md「UI・UX の4回目」）: オンラインで、番の人がつまんでいる駒・1回目に押した所を、ほかの人の画面に点線で出す。
// 送りっぱなし（stream）で、勝ち負けに関わらない。送る・出すのは main.js（o.peek と o.peekIn）。PEEK_SETTING は駒を選んで動かすゲーム、TAP_PEEK_SETTING は「2回押して置く」のゲーム
export const PEEK_SETTING = {
  key: 'peek', label: '相手の迷いを見せる', desc: 'オンラインで、番の人がいまつまんでいる駒（PC ではねらっているマスも）が、ほかの人の画面に点線で見える', def: 'on',
  choices: [['on', '見せる'], ['off', '見せない']],
};
export const TAP_PEEK_SETTING = {
  ...PEEK_SETTING, desc: 'オンラインで、「2回押して置く」（ホームの 👓 見やすさ）を使っている人が1回目に押した所が、ほかの人の画面に点線で見える',
};

// 駒のマスに相手の選び（点線）を付け、PC で行き先にのせたら自分のねらいを知らせる。sel = () => いまの自分の選び { f, d }
export function peekMark(e, i, o, isTarget, sel) {
  if (o.peekIn?.f === i) e.classList.add('peek');
  if (o.peekIn?.a === i) e.classList.add('peek-aim');
  if (isTarget && o.peek) {
    e.addEventListener('pointerenter', (ev) => { if (ev.pointerType === 'mouse') o.peek({ ...sel(), a: i }); });
    e.addEventListener('pointerleave', (ev) => { if (ev.pointerType === 'mouse') o.peek({ ...sel(), a: null }); });
  }
}

// あぶない所の知らせ（2026-11-12 本人の選択。board-games.md）: 自分のターンのあいだ、ほかの人が次の一手で勝てる所に赤い「！」を出す。
// マルバツ（3×3・広い盤・消える）・四目並べ・五目並べ・立体四目並べ。ゲームは render の o.rules（main.js が渡す詳細設定の値）で見る。
// 好みの設定なので、おまかせでは抽選しない（main.js の KEEP_KEYS に danger）
export const DANGER_SETTING = {
  key: 'danger', label: 'あぶない所の知らせ', desc: 'ありなら自分のターンのあいだ、ほかの人が次の一手で勝てる所に赤い「！」を出す', def: 'off',
  choices: [['off', 'なし'], ['on', 'あり']],
};
// s の番の人から見て、ほかの人（席 0〜seats−1）が次の一手で勝てる手の一覧（Set）。s.turn をその人に入れ替え、cands(局面) の手を当てて勝つかを見る
// （どのゲームも apply が s.turn の人の手として当てるので使える）
export function dangerMoves(game, s, seats, cands) {
  const out = new Set();
  for (let q = 0; q < seats; q++) {
    if (q === s.turn) continue;
    const t = { ...s, turn: q };
    for (const m of cands(t)) {
      let nx = null;
      try { nx = game.apply(t, m); } catch { nx = null; }
      const r = nx && game.result(nx);
      if (r && r.winner === q) out.add(m);
    }
  }
  return out;
}
export const dangerOn = (o) => o.canMove && o.rules?.danger === 'on';

export const CPU_SETTING = {
  key: 'cpu', label: 'CPU の強さ', desc: 'CPU と対局するときの強さ', def: 'weak',
  choices: [['weak', 'よわい'], ['normal', 'ふつう'], ['strong', 'つよい']],
};

// 何手先まで読んで手を選ぶ（ネガマックス法＋アルファベータ法）。
// legal(局面) → 打てる手の一覧、score(局面, p) → 決着前の局面の p から見た点数（勝ち負けより十分小さく）。
// opts = { depth: { weak, normal, strong }, mistake: { weak, normal, strong } }。mistake は適当に打つ割合。
// CPU はホストの端末だけで動くので Math.random を使ってよい。
const WIN = 1e6;
// s を who の番から depth 手先まで読んだ who から見た点数（boardCpu と boardJudge が使う）
function negamax(game, legal, score, s, depth, alpha, beta, who) {
  const res = game.result(s);
  if (res) return res.winner === null ? 0 : res.winner === who ? WIN + depth : -WIN - depth;
  if (depth === 0) return score(s, who);
  let best = -Infinity;
  for (const m of legal(s)) {
    const child = game.apply(s, m);
    const next = game.result(child) ? who : game.turn(child);
    const v = next === who ? negamax(game, legal, score, child, depth - 1, alpha, beta, who) : -negamax(game, legal, score, child, depth - 1, -beta, -alpha, next);
    if (v > best) best = v;
    if (best > alpha) alpha = best;
    if (alpha >= beta) break;
  }
  return best;
}

export function boardCpu(game, st, rules, legal, score, opts) {
  const level = opts.depth[rules?.cpu] !== undefined ? rules.cpu : 'weak';
  const moves = legal(st);
  if (moves.length === 1) return moves[0];
  if (Math.random() < opts.mistake[level]) return moves[Math.floor(Math.random() * moves.length)];
  const nega = (s, depth, alpha, beta, who) => negamax(game, legal, score, s, depth, alpha, beta, who);
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

// 形勢（2026-11-12 本人の選択。room.md「UI・UX の5回目」の「形勢の帯」「ふりかえりの分かれ目」）: 2人の盤のゲームの judge(局面) が使う。
// 1番目の席（席 0）から見た優勢の度合いを −100〜100 の整数で返す（100 = 席 0 の勝ち・決まった勝ち、0 = 互角）。数えられない局面は null。
// CPU と同じ読み（negamax）を depth 手先まで読み、点数を scale で割って tanh で −1〜1 に縮める（scale はそのゲームの点数の「はっきり差がある」くらいの大きさ。Claude の判断）。
// Math.random を使わないので、どの端末でも同じ局面なら同じ数になる
export function boardJudge(game, st, legal, score, depth, scale) {
  const res = game.result(st);
  if (res) return res.winner === null ? 0 : res.winner === 0 ? 100 : -100;
  const me = game.turn(st);
  if ((me !== 0 && me !== 1) || !legal(st).length) return null;
  // 読みの切れ目で「次に打つ側」が得に見えて1手ごとに上下にゆれる（四目並べで3手に2回ほど）ので、depth と depth − 1 の読みを平均する
  const read = (d) => { const v = negamax(game, legal, score, st, d, -Infinity, Infinity, me); return me === 0 ? v : -v; };
  const a = read(depth);
  if (depth < 2 || !Number.isFinite(a) || Math.abs(a) >= WIN) return judgeOf(a, scale);
  const b = read(depth - 1);
  return judgeOf(!Number.isFinite(b) || Math.abs(b) >= WIN ? b : (a + b) / 2, scale);
}
// 席 0 から見た点数 → −100〜100（決まった勝ち負けは ±100）
export function judgeOf(v0, scale) {
  if (!Number.isFinite(v0) || Math.abs(v0) >= WIN) return v0 > 0 ? 100 : -100;
  return Math.round(100 * Math.tanh(v0 / scale));
}

// 参りました（2026-11-12 本人の選択。room.md「UI・UX の5回目」）: 2人で打つ盤のゲームで、手 { give: true } を打った手番の人の負けにする。
// ゲームのファイルは変えず、ここで apply と result を包む（index.js の GIVE_UP）。局面に gave（参った人の席の番号）を足すだけで、盤はそのまま。
// 打てるのは手番の人だけ（盤のゲームの手には打った人が入らないため。将棋の投了と同じ。Claude の判断）。
// 3人以上の盤では main.js がボタンを出さない（ここでは手番が 0・1 かだけ見る）
export function withGiveUp(def) {
  const { apply, result } = def;
  def.giveUp = true;
  def.apply = function (s, m) {
    if (s && s.gave !== undefined) return null;
    if (m && typeof m === 'object' && m.give === true) {
      if (!s || result.call(this, s)) return null;
      const t = this.turn(s);
      return t === 0 || t === 1 ? { ...s, gave: t } : null;
    }
    return apply.call(this, s, m);
  };
  def.result = function (s) {
    if (s && s.gave !== undefined) return { winner: 1 - s.gave, cells: [], gave: s.gave };
    return result.call(this, s);
  };
  return def;
}

// 続けて遊ぶ間は、その人の色と形を変えない（2026-11-13 本人の決定。room.md「UI・UX の6回目」）。
// 盤のゲームのもう一回で先手と後手が入れ替わっても、その人の ○× や石の色は前の対局のまま。そのため、席の番号（ゲームの中のプレイヤー番号。0 が先手）と
// 色の番号（.p0〜.p3 の見た目と game.players の名前）がずれることがある。main.js が描く前に setSeatColors で「席の番号 → 色の番号」を入れ、
// ゲームは描くとき（render・info）だけ col(席) で色の番号に直す。**apply・CPU・結果では使わない**（局面は席の番号のまま。全員の端末で同じ局面を作る決まり）。
// 入れるのは keepColor を持つゲームのオンラインの対局だけ。ほかは入れない（col は席の番号をそのまま返す）
let seatColors = null;
export function setSeatColors(a) { seatColors = Array.isArray(a) ? a : null; }
export const col = (p) => (seatColors && Number.isInteger(p) && Number.isInteger(seatColors[p]) ? seatColors[p] : p);

// あと一歩の人に印（2026-11-13 本人の選択。room.md「UI・UX の6回目」）: ゲームが自分で描く点の欄に付ける赤い小さな印（順番の帯の印は main.js の addReach）
export function reachTag(text) {
  const t = document.createElement('span');
  t.className = 'reach-tag';
  t.textContent = text;
  return t;
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
