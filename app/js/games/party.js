// パーティーゲーム（旗揚げ・難読漢字・的の早押し・石取り・ウミガメのスープ）で共通に使う小道具。
//
// 速さの測り方: 問題や的が「この端末の画面に出た時刻」を since(key) で覚え、押すまでの時間を手に入れて送る。
// 通信の遅れは「画面に出るのが遅れる」だけなので、ゲストが不利にならない。ホストはこの値を比べて順位を決める。
// CPU の速さも、ホストの画面に出てからの経過時間で表す（cpu() はホストの端末だけで動くので、ここの時計を使ってよい）。

import { esc } from './util.js';

const shownAt = new Map();
// key が初めて渡されてからの経過ミリ秒。描き直しのたびに呼んでよい（最初の1回の時刻が残る）
export function since(key) {
  const now = performance.now();
  if (!shownAt.has(key)) {
    shownAt.set(key, now);
    if (shownAt.size > 400) shownAt.delete(shownAt.keys().next().value); // 古いものから捨てる
  }
  return now - shownAt.get(key);
}
export const seen = (key) => shownAt.has(key);

// 答え合わせ用に文字をそろえる: 全角半角・カタカナ→ひらがな・空白や記号を取る
export function kana(text) {
  return String(text ?? '')
    .normalize('NFKC')
    .replace(/[ァ-ヶ]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0x60))
    .replace(/[\s、。・,.!?！？「」『』（）()]/g, '')
    .toLowerCase();
}

// 点数の順位。同じ点は同じ順位。返り値は各プレイヤーの順位（1 から）
export function ranks(scores) {
  return scores.map((v) => 1 + scores.filter((w) => w > v).length);
}

// いちばん点の高い人たち
export function leaders(scores) {
  const top = Math.max(...scores);
  return scores.map((v, p) => (v === top ? p : -1)).filter((p) => p >= 0);
}

// 結果の文。winners が1人ならその人の勝ち、2人以上なら同点
export function winnersText(winners, me, pn) {
  if (winners.length === 1) return winners[0] === me ? 'あなたの勝ち！🎉' : `${pn(winners[0])}の勝ち！`;
  const mine = winners.includes(me);
  return `${winners.map(pn).join('・')}が同点で1位！${mine ? '🎉' : ''}`;
}

// 参加者の札（名前と点数）を並べる。extra(p) で名前の下に足す HTML（esc 済みのもの）を返せる
// steady = true: 札を1列に並べ（はみ出したら横に送る）、extra の行をいつも1行ぶん取っておく。札に字が入っても札の高さと段の数が変わらず、
//   下のボタンが押し下げられない（2026-10-30 本人の依頼。ぴったりストップ・色ちがい早押し・ことわざかるた・ビンゴ）
// gain = false: 点が増えても「+3」を出さない（数が点でないゲーム。綱引き連打の回数・ミニゴルフの打数・羽根つきの墨・玉入れの玉）
// 逆転の知らせ・勝ちまでの見通し（2026-11-13）は 2026-11-14 本人の依頼でやめた（「逆転！」と「1位まで あと◯点」「2位と◯点差」）
// gainDelay = 「+3」を何 ms 遅らせて出すか（一斉に裏返す場面で、札が返る前に点が分からないように。2026-11-16）
export function scoreChips(o, scores, { turn = null, won = [], extra = null, steady = false, gain = true, gainDelay = 0 } = {}) {
  if (gain) noteGains(o, scores, gainDelay);
  const box = document.createElement('div');
  box.className = 'cc-opps' + (steady ? ' cc-steady' : '');
  scores.forEach((v, p) => {
    const chip = document.createElement('div');
    chip.className = 'cc-opp' + (p === turn ? ' turn' : '') + (won.includes(p) ? ' won' : '') + (p === o.me ? ' me' : '');
    const name = document.createElement('div');
    name.className = 'cc-opp-name';
    name.textContent = p === o.me && !o.watching ? 'あなた' : o.names[p]; // 観戦で見ている人の札は、印だけ付けて名前で出す
    const val = document.createElement('div');
    val.className = 'pt-score';
    val.innerHTML = `${v}<small>点</small>`;
    chip.append(name, val);
    if (gain) showGain(chip, val, p, v);
    if (extra) {
      const x = extra(p);
      if (x || steady) {
        const e = document.createElement('div');
        e.className = 'pt-extra';
        e.innerHTML = x;
        chip.append(e);
      }
    }
    if (o.away[p]) chip.append(tag('away', '応答なし'));
    else if (o.sub?.[p]) chip.append(tag('away', 'CPU が代わりに'));
    box.append(chip);
  });
  return box;
}

function tag(cls, text) {
  const t = document.createElement('span');
  t.className = 'cc-tag ' + cls;
  t.textContent = text;
  return t;
}

// 点が入ったら「+3」（2026-11-06 の UI・演出・アニメーションの案。本人が決めたことは party-games.md）:
// 新しく届いた手（o.fresh）で点が増えた人の札に、増えた数を飛び出させ、数字をくるくる増やす（GAIN_MS の間）。
// 札は描き直しのたびに作り直されるので、増えた時刻を覚えておき、その間に描き直したら続きから出す（将棋の王手の知らせと同じ考え方）。
// 「+3」は札の中に出す（横に送れる札の段 .cc-steady は、はみ出した所が切れるため）。動きを減らす設定の端末では出さない。
// どの札の組かは名前の並びと人数で見分ける（次の対局で点が0に戻ったときは、増えていないので出ない）。
const GAIN_MS = 900;
const COUNT_MS = 500;
const gains = { key: '', vals: [], at: [], from: [] };
function noteGains(o, scores, delay = 0) {
  const key = (o.names || []).join('\u0001') + '#' + scores.length;
  if (gains.key !== key) { Object.assign(gains, { key, vals: scores.slice(), at: [], from: [] }); return; }
  const now = Date.now();
  scores.forEach((v, p) => {
    const was = gains.vals[p];
    if (o.fresh && Number.isFinite(v) && Number.isFinite(was) && v > was) { gains.at[p] = now + delay; gains.from[p] = was; }
    else if (!(v >= was)) delete gains.at[p]; // 点が減った（同じ顔ぶれのもう一回で0に戻った など）ら、前の「+3」の続きを出さない（「+-5」になるため）
    gains.vals[p] = v;
  });
}
const quiet = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
function showGain(chip, val, p, v) {
  const t = Date.now() - (gains.at[p] ?? -Infinity);
  if (t >= GAIN_MS || quiet()) return;
  const from = gains.from[p];
  const plus = document.createElement('span');
  plus.className = 'pt-plus';
  plus.textContent = '+' + Math.round((v - from) * 10) / 10;
  plus.style.animationDelay = `${-t}ms`; // 描き直したときは続きから（遅らせて出すときは t が負で、その分待つ）
  chip.classList.add('gain');
  chip.style.animationDelay = `${-t}ms`;
  chip.append(plus);
  // 「12」の字（後ろの <small>点</small> はそのまま）。札を受け取ったあとで .pt-score の中身を書き直すゲーム（価値観ならべの「クリア」など）があるので、字は毎回探し直す
  const put = (x) => { const n = [...val.childNodes].find((c) => c.nodeType === 3); if (n) n.nodeValue = String(x); };
  const whole = Number.isInteger(v) && Number.isInteger(from);
  const start = Date.now() - t;
  let first = true; // 最初の1回は札がまだ画面に付いていない（scoreChips の中で呼ぶため）
  const step = () => {
    const k = Math.max(0, Math.min(1, (Date.now() - start) / COUNT_MS)); // 遅らせて出すときは、始まるまで前の数のまま
    if (k >= 1 || (!first && !val.isConnected)) return put(v); // 描き直しで外れた札は止める
    first = false;
    const x = from + (v - from) * (1 - (1 - k) ** 3);
    put(whole ? Math.round(x) : Math.round(x * 10) / 10);
    requestAnimationFrame(step);
  };
  step();
  setTimeout(() => put(v), Math.max(0, COUNT_MS - t) + 50); // 裏のタブで描き替えが止まっても、数は必ず正しい値に戻す
}

// 残り時間の帯。ms 後に空になる。帯の要素が画面から外れたら勝手に止まる
// secs = true なら、帯の下に残りの秒数も数字で出す（2026-10-26 本人の依頼。難読漢字）。そのときは帯と数字を包んだ要素を返す
export function timeBar(key, limit, { secs = false } = {}) {
  const bar = document.createElement('div');
  bar.className = 'pt-timebar';
  const fill = document.createElement('div');
  bar.append(fill);
  const num = secs ? document.createElement('div') : null;
  if (num) num.className = 'pt-secs';
  // 前と同じ値は書かない（毎回書くと、長い帯（15パズル早解きの3分など）でも1秒に60回ページの組み直しが起き、遅いスマホで重くなる。
  // 2026-11-14 本人の報告「15パズルで友人の動作がとても重い」から。Claude の判断）
  let was = '';
  const tick = () => {
    if (!bar.isConnected && bar.dataset.started) return;
    bar.dataset.started = '1';
    const left = Math.max(0, 1 - since(key) / limit);
    // 残り時間の帯の終わり（2026-11-09 本人の選択。本人の指示で控えめに）: 残り5秒で帯がゆっくり小さく脈打ち、帯の右上に秒の数字を小さく出す。
    // 8秒より短い帯は、ほとんどの間ずっと脈打ってしまうので出さない（Claude の判断）。秒を字で出す帯（secs）は数字を重ねない
    const leftMs = left * limit;
    const hurry = limit >= 8000 && left > 0 && leftMs <= 5000;
    const w = (left * 100).toFixed(1);
    const sec = Math.ceil(leftMs / 1000);
    const now = `${w}|${sec}|${hurry}`;
    if (now !== was) {
      was = now;
      fill.style.width = w + '%';
      bar.classList.toggle('low', left < 0.3);
      bar.classList.toggle('hurry', hurry);
      if (!num) bar.dataset.sec = hurry ? String(sec) : '';
      if (num) {
        num.textContent = `残り ${sec}秒`;
        num.classList.toggle('low', left < 0.3);
      }
    }
    if (left > 0) requestAnimationFrame(tick);
  };
  tick();
  if (!num) return bar;
  const box = document.createElement('div');
  box.append(bar, num);
  return box;
}

// だれかが解いたあと「after ミリ秒で締め切る」ゲーム（迷路早抜け・15パズル早解き）の帯と、ホストが締め切るまでの時間。
// どちらも「after」と「もとの制限時間 limit までの残り」の短いほう（制限時間を過ぎた答えは受け付けないので、帯が残っていても着けなくなっていた。
// 2026-10-29 Codex の点検の指摘。本人承認）。key は問題の since の鍵。残りは同じ速さで減るので、どちらの帯を出すかは途中で入れ替わらない
export function afterBar(key, limit, after) {
  return after - since(key + ':after') <= limit - since(key) ? timeBar(key + ':after', after, { secs: true }) : timeBar(key, limit, { secs: true });
}
export const afterMs = (key, limit, after, grace) => Math.round(Math.min(after, Math.max(0, limit + grace - since(key))));

export const secText = (ms) => (ms / 1000).toFixed(2) + '秒';

// 早押しの速さの線（2026-11-17 本人の選択。room.md「UI・UX の8回目」）: 1問ごとの答えを見せる場面で、正解した人の押した速さ（各自の端末で測った ms）を
// 1本の線の上に点で並べる。正解しなかった人（まちがえた・押さなかった）は線の右の外に点線の丸で並べる（理由の字は出さない）。
// solved[p] = 正解した人の ms（ほかは null）。key = その問題の since の鍵（描き直しても点が出る動きを続きから見せる）。
// Claude の判断: 線の長さは「いちばん遅い正解の 1.2倍」を 0.5秒単位で切り上げた長さ（最短1秒。制限時間にすると点が左に固まるため）。
// 点が出る順は速い順で、出るまでの間は押した速さに比例（最後の点が 0.9秒ごろ）。名前は上下交互に出して重なりを減らす。
// 置き場所は各ゲームの下の段の一番下（ボタンを押し下げないように）。動きを減らす設定の端末では出た形で出す
export function speedLine(o, solved, key) {
  const box = document.createElement('div');
  box.className = 'speed-line';
  const hits = solved.map((ms, p) => ({ p, ms })).filter((x) => typeof x.ms === 'number').sort((a, b) => a.ms - b.ms || a.p - b.p);
  const outs = solved.map((ms, p) => (typeof ms === 'number' ? -1 : p)).filter((p) => p >= 0);
  const span = Math.max(1000, Math.ceil(((hits.at(-1)?.ms ?? 0) * 1.2) / 500) * 500);
  const name = (p) => (p === o.me && !o.watching ? 'あなた' : o.names?.[p] ?? `プレイヤー${p + 1}`);
  const still = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const t = since(key + ':speed');
  const axis = document.createElement('div');
  axis.className = 'sl-axis';
  for (const v of [0, span / 2, span]) {
    const tick = document.createElement('span');
    tick.className = 'sl-tick';
    tick.style.left = (v / span) * 100 + '%';
    tick.textContent = (v / 1000).toFixed(1) + '秒';
    axis.append(tick);
  }
  const last = hits.at(-1)?.ms || 1;
  hits.forEach((x, i) => {
    const pin = document.createElement('span');
    pin.className = 'sl-pin ' + (i % 2 ? 'down' : 'up') + (i === 0 ? ' first' : '');
    pin.style.left = (x.ms / span) * 100 + '%';
    pin.style.background = SEAT_COLORS[x.p % SEAT_COLORS.length];
    if (!still) pin.style.animationDelay = `${(x.ms / last) * 900 - t}ms`;
    const nm = document.createElement('span');
    nm.className = 'sl-nm';
    nm.textContent = `${name(x.p)} ${(x.ms / 1000).toFixed(2)}`;
    pin.append(nm);
    axis.append(pin);
  });
  box.append(axis);
  if (outs.length) {
    const rest = document.createElement('div');
    rest.className = 'sl-outs';
    for (const p of outs) {
      const s = document.createElement('span');
      s.className = 'sl-out';
      s.style.setProperty('--c', SEAT_COLORS[p % SEAT_COLORS.length]);
      s.textContent = name(p);
      rest.append(s);
    }
    box.append(rest);
  }
  return box;
}

// 席ごとの色（10人ぶん。最初の4つは --p0〜--p3 と同じ）。迷路早抜け・すごろくのコマ。どのスキンでも変えない
export const SEAT_COLORS = ['#d9643a', '#2f6fb3', '#2e9a52', '#8a4fc0', '#d4a20c', '#d24a8c', '#1a9aa0', '#7a5a3a', '#5a6470', '#9acd32'];
export { esc };

// 開票を1票ずつ見せる（2026-11-16 の UI・UX の7回目。本人の選択で、見本より速く。party-games.md の「ワードウルフ」「人狼」）。
// box = 名前の札が並んだ要素（.cc-opps）、chips[p] = p の札、votes = [[入れた人, 入れられた人], …]（この順に1本ずつ引く）。
// 札から札へ曲がった矢印を引き、矢印が届くたびに入れられた人の札の右上の数が1つ増える。
// 盤は描き直しのたびに作り直されるので、引き始めた時刻を key ごとに覚え、引いている間に描き直したら続きから引く（cards.js の turnUp と同じ考え）。
// fresh = 新しく届いた手で開票になった（読み込み直し・あとから見た人には引き終わった形で出す）。矢印は開票の結果を見せている間ずっと残す。
// 札に当たらない票（ワードウルフの「ウルフはいない」）は呼ぶ側で除く。動きを減らす設定の端末では引き終わった形で出す
const VOTE_STEP = 330; // 1票ごとの間（見本は 800ms。本人の「もっとはやく」から Claude が決めた）
const VOTE_DRAW = 260; // 1本の矢印を引く長さ
const voteAt = new Map();
export function voteArrows(box, chips, votes, key, fresh) {
  const now = Date.now();
  if (fresh && !voteAt.has(key) && !matchMedia('(prefers-reduced-motion: reduce)').matches) {
    voteAt.set(key, now);
    if (voteAt.size > 50) voteAt.delete(voteAt.keys().next().value);
  }
  const start = voteAt.get(key) ?? -Infinity;
  box.classList.add('va-box');
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('class', 'va-svg');
  svg.setAttribute('aria-hidden', 'true');
  box.append(svg);
  // 入れられた人の札の数
  const badge = new Map();
  votes.forEach(([, to], i) => {
    if (!chips[to]) return;
    if (!badge.has(to)) {
      const b = document.createElement('span');
      b.className = 'va-cnt';
      chips[to].append(b);
      badge.set(to, { b, at: [] });
    }
    badge.get(to).at.push(i * VOTE_STEP + VOTE_DRAW);
  });
  const t = now - start;
  for (const { b, at } of badge.values()) {
    const put = (n, bump) => {
      b.textContent = n;
      b.hidden = !n;
      if (bump) { b.classList.remove('bump'); void b.offsetWidth; b.classList.add('bump'); }
    };
    put(at.filter((x) => x <= t).length, false);
    at.filter((x) => x > t).forEach((x, k, rest) => setTimeout(() => { if (b.isConnected) put(at.length - rest.length + k + 1, true); }, x - t));
  }
  const draw = () => {
    const t = Date.now() - start;
    const r0 = box.getBoundingClientRect();
    if (!r0.width) return;
    svg.setAttribute('viewBox', `0 0 ${r0.width} ${r0.height}`);
    svg.innerHTML = '';
    votes.forEach(([from, to], i) => {
      const a = chips[from]?.getBoundingClientRect(), z = chips[to]?.getBoundingClientRect();
      if (!a || !z) return;
      const x1 = a.left + a.width / 2 - r0.left, y1 = a.top + a.height / 2 - r0.top;
      const x2 = z.left + z.width / 2 - r0.left, y2 = z.top + z.height / 2 - r0.top;
      const dx = x2 - x1, dy = y2 - y1, L = Math.hypot(dx, dy) || 1, ux = dx / L, uy = dy / L;
      // 札の真ん中からでなく、ふちのあたりから出してふちのあたりで止める（横に並んだ札が多いので、横は札の幅の半分ほど）
      const cut = (r) => Math.min(Math.abs(ux) > 0.01 ? r.width / 2 / Math.abs(ux) : Infinity, Math.abs(uy) > 0.01 ? r.height / 2 / Math.abs(uy) : Infinity) * 0.8;
      const sx = x1 + ux * cut(a), sy = y1 + uy * cut(a), ex = x2 - ux * (cut(z) + 2), ey = y2 - uy * (cut(z) + 2);
      const bend = Math.min(60, L * 0.28); // 右へ向かう矢印は上へ、左へ向かう矢印は下へふくらむ（行き違いの2本が重ならない）
      const mx = (sx + ex) / 2 + uy * bend, my = (sy + ey) / 2 - ux * bend;
      const p = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      p.setAttribute('d', `M${sx.toFixed(1)} ${sy.toFixed(1)} Q${mx.toFixed(1)} ${my.toFixed(1)} ${ex.toFixed(1)} ${ey.toFixed(1)}`);
      p.setAttribute('class', 'va-line');
      const g = Math.atan2(ey - my, ex - mx), s = 8;
      const h = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      h.setAttribute('d', `M${ex.toFixed(1)} ${ey.toFixed(1)} L${(ex - s * Math.cos(g - 0.45)).toFixed(1)} ${(ey - s * Math.sin(g - 0.45)).toFixed(1)} L${(ex - s * Math.cos(g + 0.45)).toFixed(1)} ${(ey - s * Math.sin(g + 0.45)).toFixed(1)}Z`);
      h.setAttribute('class', 'va-head');
      svg.append(p, h);
      const d = i * VOTE_STEP - t; // この矢印を引き始めるまで（負なら引き始めてからの時間）
      if (d + VOTE_DRAW <= 0) return; // もう引き終わった
      const len = p.getTotalLength();
      p.style.cssText = `stroke-dasharray:${len};--len:${len};animation-delay:${d}ms`;
      p.classList.add('va-anim');
      h.style.animationDelay = `${d + VOTE_DRAW}ms`;
      h.classList.add('va-anim');
    });
  };
  // 札が並び終わってから測る（呼ぶ側が box を画面に入れたあとに呼ぶ。入れる前に呼ばれても、次の描き替えで測り直す）
  draw();
  if (!svg.childNodes.length) requestAnimationFrame(draw);
  let w = box.clientWidth;
  const ro = new ResizeObserver(() => { if (!svg.isConnected) { ro.disconnect(); return; } if (box.clientWidth !== w) { w = box.clientWidth; draw(); } });
  ro.observe(box);
}

// 一斉に裏返して見せる（2026-11-16 の UI・UX の7回目。本人の選択。かぶったら0点・以心伝心・兵の振り分け）。
// 全員が決めて見せ合う場面になったら、伏せた札が少し間をおいて同時にぱたっと返り、そのあとで結果（点・まとまり）が出る。
// flipTimes(root, key, fresh) が始めた時刻を key ごとに覚え（描き直しても続きから。読み込み直し・あとから見た人には返し終わった形）、
// root に CSS の変数 --fd（札が返り始めるまで）・--fa（結果を出すまで）を置く。返す物は flipCard で作り、あとで出す物には class="flip-after" を付ける。
// 秒数は Claude の判断（伏せたまま見せる 0.35秒・返すのに 0.45秒）。動きを減らす設定の端末では style.css が止める
const FLIP_WAIT = 350;
const FLIP_TURN = 450;
export const FLIP_AFTER = FLIP_WAIT + FLIP_TURN; // 結果を出すまで（点数の札の gainDelay に渡す）
const flipAt = new Map();
export function flipTimes(root, key, fresh) {
  const now = Date.now();
  if (fresh && !flipAt.has(key)) {
    flipAt.set(key, now);
    if (flipAt.size > 50) flipAt.delete(flipAt.keys().next().value);
  }
  const t = Math.min(1e7, now - (flipAt.get(key) ?? -Infinity));
  root.style.setProperty('--fd', `${FLIP_WAIT - t}ms`);
  root.style.setProperty('--fa', `${FLIP_WAIT + FLIP_TURN - t}ms`);
}
// 伏せた札1枚。face = 表の字、name = 下に出す名前、dup = かぶった（返ったあとで揺れる）
export function flipCard(face, name, dup = false) {
  const d = document.createElement('div');
  d.className = 'flip-card' + (dup ? ' dup' : '');
  d.innerHTML = '<div class="fc-in"><div class="fc-face fc-back"></div><div class="fc-face fc-front"></div></div><div class="fc-name"></div>';
  d.querySelector('.fc-front').textContent = face;
  d.querySelector('.fc-name').textContent = name;
  return d;
}
