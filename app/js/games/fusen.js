// 風船ふくらまし。全員が同時に自分の風船をふくらませる。押すたびに点が増え、「やめる」で決まり、割れたらその回は0点。2〜10人・足りない分は CPU（弱め）。
// 2026-11-05 本人の決定（Claude が出した案から本人が選んだ。分かれ目はすべて Claude の推奨を本人が承認）:
//   - 風船はその回の全員で同じ強さ（何回目で割れるかは隠れている）。ほかの人の様子はその回が終わるまで見えない（.claude/rules/party-games.md）。
//   - 5回の合計で勝負。
// Claude の判断:
//   - 1回押すと1点。割れる回数は 3〜20回目（回ごとに種から決める。全員同じ）。割れる回数は全員の端末が知っている（手札と同じ簡易の隠し方）。
//     風船の大きさ・揺れ方は押した回数だけで決め、割れる回数を手がかりにしない。
//   - 1回20秒。押した回数はその人の端末の中だけで数え、「やめる」か割れたときに1回だけ手にして送る。時間が来たら、その時の回数で自動で決める。
//     手が届かないまま締め切った人は0点（手の送り直しは0.5秒ごと。届いていない間だけ）。
//   - 回の途中は、ほかの人が決めたかどうかも名前の札に出さない（割れた人は早く決まるので、決めた早さで割れる回数の見当が付いてしまうため）。
//   - 全員が決めたら0.8秒で見せる。見せる間は4.5秒（みんなの風船と、何回目で割れたかを読む時間）。同じ点の人は同じ順位。
//   - CPU は 3〜12回のどれかを目当てにし、0.35〜0.6秒に1回押す（割れる回数は見ない）。
// 進行（ホストが時間を計って p = -1 の手を足す）: ready → next → open → close → shown → next … → end
// 手: { p: -1, t: 'next' | 'close' } / { p, t: 'stop', r: 何回目（0 から）, k: 押した回数（割れたときは割れる回数そのもの） }
//   r が今の回と同じで、その人がまだ決めていないときだけ受け付けるので、同じ手が2回届いても2回目は反則になる。

import { mulberry32 } from './util.js';
import { since, scoreChips, leaders, winnersText, timeBar, SEAT_COLORS } from './party.js';
import { play } from '../sound.js';

export const ROUNDS = 5;
export const MIN_POP = 3;
export const MAX_POP = 20;
const LIMIT = 20000;
const READY_MS = 3000;
const SHOWN_MS = 4500;
const GRACE_MS = 800;
const LATE_MS = 1500;

// その回の風船が何回目で割れるか（種と何回目かから。全員同じ）
export function popOf(seed, r) {
  const rnd = mulberry32((seed * 977 + r * 131 + 11) >>> 0);
  rnd();
  return MIN_POP + Math.floor(rnd() * (MAX_POP - MIN_POP + 1));
}
// 押した回数 k の点（割れたら0）
export const pointsOf = (k, pop) => (k === null || k >= pop ? 0 : k);

const rKey = (s, r = s.r) => `fusen:${s.seed}:${r}`;
const clone = (s) => ({ ...s, scores: s.scores.slice(), stops: s.stops.slice() });
const cpuPlan = new Map();
const ui = {}; // いま画面に出しているもの（同じ局面なら作り直さない。羽根つきと同じ）
const local = new Map(); // この端末で押した回数（描き直しても消えないように回ごとに覚える）: { k, popped, sent }

// 風船の絵（svg の文字）。k = 押した回数。popped なら割れた絵
export function balloonSvg(k, color, { popped = false, small = false } = {}) {
  const r = Math.min(134, 34 + k * 5);
  const cx = 160;
  const cy = 170 - r * 0.15;
  if (popped) {
    const bits = [...Array(9)].map((_, i) => {
      const a = (i / 9) * Math.PI * 2 + 0.3;
      const d = 48 + (i % 3) * 22;
      return `<path d="M${cx + Math.cos(a) * d} ${cy + Math.sin(a) * d} l${8 + (i % 2) * 6} ${-6 + (i % 3) * 5} l${-4} ${10}z" fill="${color}"/>`;
    }).join('');
    return `<svg class="fs-svg${small ? ' small' : ''}" viewBox="0 0 320 340" aria-hidden="true">${bits}<text x="${cx}" y="${cy + 14}" text-anchor="middle" font-size="44" font-weight="900" fill="#c0392b">パン！</text>`
      + `<path d="M${cx} 300 q-8 16 0 32" stroke="#888" stroke-width="3" fill="none"/></svg>`;
  }
  const bottom = cy + r * 1.08;
  return `<svg class="fs-svg${small ? ' small' : ''}" viewBox="0 0 320 340" aria-hidden="true">`
    + `<path d="M${cx} ${bottom} Q${cx - 10} ${(bottom + 330) / 2} ${cx} 332" stroke="#888" stroke-width="3" fill="none"/>`
    + `<ellipse cx="${cx}" cy="${cy}" rx="${r}" ry="${r * 1.08}" fill="${color}"/>`
    + `<path d="M${cx - 7} ${bottom + 9} L${cx + 7} ${bottom + 9} L${cx} ${bottom - 2}z" fill="${color}"/>`
    + `<ellipse cx="${cx - r * 0.38}" cy="${cy - r * 0.42}" rx="${r * 0.16}" ry="${r * 0.26}" fill="#fff" opacity=".45" transform="rotate(-25 ${cx - r * 0.38} ${cy - r * 0.42})"/>`
    + `</svg>`;
}

export default {
  id: 'fusen',
  name: '風船ふくらまし',
  icon: '🎈',
  desc: '押すたびに点が増える。割れる前に「やめる」で決めよう。風船はみんな同じ強さ',
  ready: true,
  multi: true,
  realtime: true,
  minPlayers: 2,
  maxPlayers: 10,

  init(n, seed) {
    return {
      n, seed, total: ROUNDS, pops: [...Array(ROUNDS)].map((_, r) => popOf(seed, r)), r: -1, phase: 'ready',
      stops: Array(n).fill(null), scores: Array(n).fill(0), last: null, log: [], step: 0,
    };
  },

  turn() { return null; },
  canAct(s, p) { return s.phase === 'open' && s.stops[p] === null; },
  result(s) {
    if (s.phase !== 'end') return null;
    return { winners: leaders(s.scores), scores: s.scores };
  },
  sound(a, b, m) {
    if (m.p === -1) return m.t === 'next' ? 'question' : m.t === 'close' ? 'card' : null;
    return null; // 押した音・割れた音は自分の端末で鳴らす。ほかの人の手の音は鳴らさない（決めたことが分からないように）
  },
  resultText(res, me, pn) { return winnersText(res.winners, me, pn); },
  phaseText(s) {
    if (s.phase === 'ready') return 'まもなく始まります…';
    return `${s.r + 1}回目 / ${s.total}`;
  },

  referee(s) {
    if (s.phase === 'ready') return { key: 'ready', ms: READY_MS, move: { t: 'next' } };
    if (s.phase === 'open') {
      if (s.stops.every((v) => v !== null)) return { key: 'all' + s.r, ms: GRACE_MS, move: { t: 'close' } };
      return { key: 'open' + s.r, ms: LIMIT + LATE_MS, move: { t: 'close' } };
    }
    if (s.phase === 'shown') return { key: 'shown' + s.r, ms: SHOWN_MS, move: { t: 'next' } };
    return null;
  },

  apply(s0, m) {
    if (!m) return null;
    if (m.p === -1) {
      if (m.t === 'next' && (s0.phase === 'ready' || s0.phase === 'shown')) {
        const s = clone(s0);
        s.step += 1;
        if (s.r + 1 >= s.total) { s.phase = 'end'; return s; }
        s.r += 1;
        s.phase = 'open';
        s.stops = Array(s.n).fill(null);
        return s;
      }
      if (m.t === 'close' && s0.phase === 'open') {
        const s = clone(s0);
        s.step += 1;
        s.phase = 'shown';
        const pop = s.pops[s.r];
        const pts = s.stops.map((k) => pointsOf(k, pop));
        pts.forEach((v, p) => { s.scores[p] += v; });
        s.last = { pts };
        s.log = [...s0.log, { pop, stops: s.stops.slice(), pts }];
        return s;
      }
      return null;
    }
    if (m.t !== 'stop' || s0.phase !== 'open' || m.r !== s0.r || !Number.isInteger(m.p) || m.p < 0 || m.p >= s0.n || s0.stops[m.p] !== null) return null;
    if (!Number.isInteger(m.k) || m.k < 0 || m.k > s0.pops[s0.r]) return null;
    const s = clone(s0);
    s.step += 1;
    s.stops[m.p] = m.k;
    return s;
  },

  cpuDelay(s) { return s.phase === 'open' ? 200 : 500; },
  cpu(s, p) {
    if (s.phase !== 'open' || s.stops[p] !== null) return null;
    const key = rKey(s) + ':' + p;
    let plan = cpuPlan.get(key);
    if (!plan) {
      plan = { aim: 3 + Math.floor(Math.random() * 10), gap: 350 + Math.random() * 250, start: 600 + Math.random() * 900 };
      cpuPlan.set(key, plan);
      if (cpuPlan.size > 300) cpuPlan.delete(cpuPlan.keys().next().value);
    }
    const pop = s.pops[s.r];
    const k = Math.min(plan.aim, pop); // 割れる回数に届いたら、そこで割れる
    return since(rKey(s)) >= plan.start + k * plan.gap ? { t: 'stop', r: s.r, k } : null;
  },

  render(root, s, o) {
    // CPU が決めるまでの間、ホストの端末は CPU の予約のたびに描き直しを呼ぶ（main.js の scheduleCpu）。局面も見る人も変わっていなければそのまま残す
    const same = `${s.seed}:${s.step}:${o.me}:${o.canMove}:${o.watching}:${o.names.join('|')}:${JSON.stringify(o.away)}:${JSON.stringify(o.sub ?? null)}`;
    if (ui.root === root && ui.same === same && ui.wrap && root.contains(ui.wrap)) return;
    const me = o.me >= 0 && !o.watching ? o.me : null;
    const won = s.phase === 'end' ? leaders(s.scores) : [];
    const extra = (p) => {
      if (s.phase !== 'shown' || !s.last) return '';
      const k = s.stops[p];
      if (k === null) return '<span class="pt-ng">―</span>';
      return s.last.pts[p] ? `<span class="pt-ok">+${s.last.pts[p]}</span>` : '<span class="pt-ng">💥 0</span>';
    };
    root.innerHTML = '';
    root.className = 'board kj fs';
    const wrap = document.createElement('div');
    wrap.className = 'kj-wrap';
    wrap.append(scoreChips(o, s.scores, { won, extra, steady: true }));
    root.append(wrap);
    Object.assign(ui, { root, same, wrap });
    if (s.phase === 'end') { wrap.append(this.review(s, me, o)); return; }
    const card = document.createElement('div');
    card.className = 'kj-card';
    wrap.append(card);
    if (s.phase === 'ready') {
      card.innerHTML = `<div class="kj-word small">よーい…</div><div class="kj-sub">押すたびに1点。割れたらその回は0点。風船はみんな同じ強さ・全${s.total}回</div>`;
      return;
    }
    card.insertAdjacentHTML('beforeend', `<div class="kj-num">${s.r + 1}回目 / ${s.total}</div>`);
    if (s.phase === 'shown') { card.append(this.reveal(s, me, o)); return; }

    const key = rKey(s);
    const pop = s.pops[s.r];
    since(key);
    card.append(timeBar(key, LIMIT, { secs: true }));
    const color = me !== null ? SEAT_COLORS[me % SEAT_COLORS.length] : '#e05a6a';
    const lk = key + ':' + me;
    if (me !== null && !local.has(lk)) {
      local.set(lk, { k: 0, popped: false, sent: s.stops[me] !== null });
      if (local.size > 60) local.delete(local.keys().next().value);
    }
    const loc = me !== null ? local.get(lk) : null;
    const done = () => loc.sent || s.stops[me] !== null;
    const stage = document.createElement('div');
    stage.className = 'fs-stage';
    const count = document.createElement('div');
    count.className = 'fs-count';
    card.append(stage, count);
    const pump = document.createElement('button');
    pump.type = 'button';
    pump.className = 'btn primary fs-pump';
    pump.textContent = '💨 プシュッ';
    const stop = document.createElement('button');
    stop.type = 'button';
    stop.className = 'btn secondary fs-stop';
    const note = document.createElement('p');
    note.className = 'cc-log';
    const move = () => ({ t: 'stop', r: s.r, k: loc.popped ? pop : loc.k });
    // 届くまで0.5秒ごとに送り直す（ゲストの手はホストの手の一覧とすれ違って消えることがある。2色爆弾サバイバルと同じわけ）。
    // 届けば描き直しでこの stage が画面から外れるので止まる
    const again = () => {
      if (!stage.isConnected) return;
      o.onMove(move());
      setTimeout(again, 500);
    };
    const send = () => {
      if (!loc || loc.sent) return;
      loc.sent = true;
      o.onMove(move());
      setTimeout(again, 500);
    };
    const paint = () => {
      if (!loc) {
        stage.innerHTML = balloonSvg(0, color);
        count.textContent = '';
        note.textContent = '観戦中（みんなの風船は、その回が終わると見えます）';
        pump.disabled = stop.disabled = true;
        stop.textContent = 'やめる';
        return;
      }
      stage.innerHTML = balloonSvg(loc.k, color, { popped: loc.popped });
      count.innerHTML = loc.popped ? '<span class="pt-ng">割れた！ この回は0点</span>' : `<b>${loc.k}</b> 点`;
      const open = !done() && since(key) < LIMIT;
      pump.disabled = !open;
      stop.disabled = !open;
      stop.textContent = loc.popped ? '割れた…' : done() ? `${loc.k}点で決めた` : `✋ やめる（${loc.k}点で決める）`;
      note.textContent = done() ? 'ほかの人が決めるのを待っています…' : 'どこでやめるかは自分しだい。割れたら0点';
    };
    const hitPump = (e) => {
      if (!loc || done() || !o.canMove || since(key) >= LIMIT) return;
      e.preventDefault();
      loc.k += 1;
      if (loc.k >= pop) {
        loc.popped = true;
        loc.k = pop;
        play('boom', 0.8);
        paint();
        send();
        return;
      }
      play('line', 0.4);
      stage.classList.remove('bump');
      void stage.offsetWidth; // 揺れの動きをやり直す（ここは描き直しの途中ではないので測ってよい）
      stage.classList.add('bump');
      paint();
    };
    const hitStop = (e) => {
      if (!loc || done() || !o.canMove) return;
      e.preventDefault();
      play('chip', 0.6);
      send();
      paint();
    };
    pump.onpointerdown = hitPump;
    pump.onclick = (e) => { if (e.detail === 0) hitPump(e); }; // キーボードで押したとき
    stop.onpointerdown = hitStop;
    stop.onclick = (e) => { if (e.detail === 0) hitStop(e); };
    const row = document.createElement('div');
    row.className = 'fs-btns';
    row.append(pump, stop);
    wrap.append(row, note);
    paint();
    if (loc && !done()) {
      // 時間が来たら、その時の回数で決める
      setTimeout(() => {
        if (!stage.isConnected || done()) return;
        send();
        paint();
      }, Math.max(0, LIMIT - 150 - since(key)));
    } else if (loc && loc.sent && s.stops[me] === null) {
      setTimeout(again, 500); // 送ったのにまだ届いていない（ほかの人の手で描き直された）なら送り直しを続ける
    }
  },

  // 見せる場面: みんなの風船を並べる
  reveal(s, me, o) {
    const box = document.createElement('div');
    box.className = 'fs-reveal';
    const pop = s.pops[s.r];
    const head = document.createElement('div');
    head.className = 'kj-sub fs-pop';
    head.textContent = `この回の風船は ${pop}回目で割れる風船でした（${pop - 1}点がいちばん上）`;
    box.append(head);
    const list = document.createElement('div');
    list.className = 'fs-all';
    s.stops.forEach((k, p) => {
      const item = document.createElement('div');
      item.className = 'fs-one';
      item.innerHTML = balloonSvg(k ?? 0, SEAT_COLORS[p % SEAT_COLORS.length], { popped: k !== null && k >= pop, small: true });
      const name = document.createElement('div');
      name.className = 'fs-name';
      name.textContent = p === me ? 'あなた' : o.names[p];
      const v = document.createElement('div');
      v.className = 'fs-v';
      v.textContent = k === null ? '決めなかった' : k >= pop ? '💥 0点' : `${k}点`;
      item.append(name, v);
      list.append(item);
    });
    box.append(list);
    return box;
  },

  review(s, me, o) {
    const box = document.createElement('details');
    box.className = 'kj-review mk-review';
    box.open = true;
    const sum = document.createElement('summary');
    sum.textContent = `📝 ふりかえり（全${s.log.length}回）`;
    const list = document.createElement('ol');
    s.log.forEach((x, r) => {
      const li = document.createElement('li');
      const n = document.createElement('span');
      n.className = 'mk-rv-n';
      n.textContent = String(r + 1);
      const body = document.createElement('span');
      body.className = 'kb-rv';
      body.textContent = `${x.pop}回目で割れる ／ ` + x.stops.map((k, p) => `${p === me ? 'あなた' : o.names?.[p] ?? ''} ${k === null ? '―' : k >= x.pop ? '💥' : k}`).join('　');
      li.append(n, body);
      list.append(li);
    });
    box.append(sum, list);
    return box;
  },
};
