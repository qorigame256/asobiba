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
// 連続で正解している人に炎（2026-11-24 本人の選択。UI・UX の11回目。quick-games.md）: 問題ごとの記録（log。各回の solved）を渡すと、
// いちばん新しい回から続けて正解している数が2以上の人の札に「🔥2」を付ける。数が変わったときだけふくらむ。
export function streakOf(log, p) {
  let k = 0;
  for (let i = (log?.length ?? 0) - 1; i >= 0 && log[i].solved?.[p] != null; i--) k++;
  return k;
}
const fireSeen = new Map(); // 席 → 前に出した数（描き直しのたびにふくらませないため）

// みんなの答えが選択肢に並ぶ（2026-11-24 本人の選択。UI・UX の11回目。quick-games.md）: 答えを出している間、選択肢のボタンの中に、
// それを選んだ人の名前を並べる。落ちてくる動きは、その答えの組を初めて描いたときだけ。
let pickSig = ''; let pickAt = 0;
export function pickedBy(btn, said, c, me, o) {
  const who = said.map((v, p) => (v === c ? p : -1)).filter((p) => p >= 0);
  if (!who.length) return;
  const sig = said.join('|');
  if (sig !== pickSig) { pickSig = sig; pickAt = performance.now(); }
  const fresh = performance.now() - pickAt < 300;
  const row = document.createElement('span');
  row.className = 'pk-who';
  who.forEach((p, i) => {
    const t = document.createElement('span');
    t.className = 'pk-tok' + (p === me ? ' me' : '') + (fresh ? ' drop' : '');
    t.style.animationDelay = (i * 0.12) + 's';
    t.textContent = p === me && !o.watching ? 'あなた' : String(o.names?.[p] ?? '').slice(0, 6); // 観戦で見ている人は、印だけ付けて名前で出す（scoreChips と同じ。2026-11-24 の2回目の Codex の点検）
    row.append(t);
  });
  btn.append(row);
}

export function scoreChips(o, scores, { turn = null, won = [], extra = null, steady = false, gain = true, gainDelay = 0, log = null } = {}) {
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
      // 札の下の行は、中身が無いときも空の行として必ず置く（2026-11-22 本人の依頼「名前の四角に『正解』などが足されると、下のボタンがずれて押し間違える」。
      // 前は中身があるときだけ足していたので、札が高くなった瞬間に下のボタンが押し下げられた。高さは style.css の .pt-extra の min-height）
      const x = extra(p);
      {
        const e = document.createElement('div');
        e.className = 'pt-extra';
        e.innerHTML = x;
        chip.append(e);
      }
    }
    if (log) {
      const k = streakOf(log, p);
      if (k >= 2) {
        const f = tag('pt-fire' + (fireSeen.get(p) !== k ? ' pop' : ''), '🔥' + k);
        chip.append(f);
      }
      fireSeen.set(p, k);
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
// 名前の札から札への矢印の形（開票の矢印と、話し合いの間の指さしで使う）。r0 は矢印を描く入れ物の場所。線と頭の2つの path を返す（札が無ければ null）
function arrowShape(r0, from, to) {
  const a = from?.getBoundingClientRect(), z = to?.getBoundingClientRect();
  if (!a || !z) return null;
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
  const g = Math.atan2(ey - my, ex - mx), s = 8;
  const h = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  h.setAttribute('d', `M${ex.toFixed(1)} ${ey.toFixed(1)} L${(ex - s * Math.cos(g - 0.45)).toFixed(1)} ${(ey - s * Math.sin(g - 0.45)).toFixed(1)} L${(ex - s * Math.cos(g + 0.45)).toFixed(1)} ${(ey - s * Math.sin(g + 0.45)).toFixed(1)}Z`);
  return [p, h];
}

// 話し合いの間の指さし（2026-11-18 本人の選択。room.md「UI・UX の9回目」・party-games.md の「UI・UX の9回目」）: ワードウルフ・人狼の話し合いの間、
// ほかの人の名前の札を押すと「この人が怪しい」の矢印がみんなの画面に出る。投票には数えない。何度でも向け直せて、同じ札をもう一度押すと下ろす。
// 手の一覧に入れず、送りっぱなし（o.stream）で { pt: key, to }（to = -1 は下ろした）を送る。届かないことがあるので、話し合いを初めて描いた端末は
// { pt: key, ask: 1 } を送り、受け取った人は自分の向きをもう一度送る。key（どの話し合いか）が替わったら全部消す（投票が始まると呼ばれなくなり、矢印も消える）。
// Claude の判断: 矢印は投票の赤と見分けるため点線で、指した人ごとの色にしない（人の色を持たないゲームのため）。入れられた人の札に 👉 と数。
// 動きを減らす設定の端末でも矢印は出す（引く動きだけ止める）
const point = { key: null, to: new Map(), draw: null, asked: null, me: null, o: null, can: null };
// 指さしの矢印の形: 札の上のふちから出て、札の上を越える弧で相手の札の上のふちに下りる（名前の札は横に並んでとなりどうしが多く、
// 開票の矢印のように横のふちから出すと、すき間が狭くてほとんど見えないため）。右へ向かう矢印と左へ向かう矢印は高さと出る位置をずらす
function pointShape(r0, from, to) {
  const a = from?.getBoundingClientRect(), z = to?.getBoundingClientRect();
  if (!a || !z) return null;
  const right = z.left > a.left;
  const shift = right ? 6 : -6;
  const sx = a.left + a.width / 2 + shift - r0.left, sy = a.top - r0.top + 2;
  const ex = z.left + z.width / 2 - shift - r0.left, ey = z.top - r0.top - 1;
  const lift = 18 + Math.min(40, Math.abs(ex - sx) * 0.12) + (right ? 0 : 10);
  const mx = (sx + ex) / 2, my = Math.min(sy, ey) - lift;
  const p = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  p.setAttribute('d', `M${sx.toFixed(1)} ${sy.toFixed(1)} Q${mx.toFixed(1)} ${my.toFixed(1)} ${ex.toFixed(1)} ${ey.toFixed(1)}`);
  const g = Math.atan2(ey - my, ex - mx), s = 8;
  const h = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  h.setAttribute('d', `M${ex.toFixed(1)} ${ey.toFixed(1)} L${(ex - s * Math.cos(g - 0.45)).toFixed(1)} ${(ey - s * Math.sin(g - 0.45)).toFixed(1)} L${(ex - s * Math.cos(g + 0.45)).toFixed(1)} ${(ey - s * Math.sin(g + 0.45)).toFixed(1)}Z`);
  return [p, h];
}
export function pointTalk(key, me, o, box, chips, canPoint) {
  if (point.key !== key) Object.assign(point, { key, to: new Map(), draw: null });
  Object.assign(point, { me, o, can: canPoint });
  for (const [p, to] of point.to) if (!canPoint(p) || !canPoint(to)) point.to.delete(p); // 部屋を出た・やられた人の矢印は外す
  box.classList.add('va-box');
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('class', 'va-svg pt-svg');
  svg.setAttribute('aria-hidden', 'true');
  box.append(svg);
  const drawn = new Map(); // 前に描いた矢印（向きが変わった矢印だけ引く動きを付ける）
  const draw = () => {
    if (!svg.isConnected) return;
    const r0 = box.getBoundingClientRect();
    if (!r0.width) return;
    svg.setAttribute('viewBox', `0 0 ${r0.width} ${r0.height}`);
    svg.innerHTML = '';
    const count = new Map();
    for (const [from, to] of point.to) {
      count.set(to, (count.get(to) ?? 0) + 1);
      const shape = pointShape(r0, chips[from], chips[to]);
      if (!shape) continue;
      const [p, h] = shape;
      p.setAttribute('class', 'va-line pt-line' + (from === me ? ' mine' : ''));
      h.setAttribute('class', 'va-head pt-head' + (from === me ? ' mine' : ''));
      svg.append(p, h);
      if (drawn.get(from) !== to && !matchMedia('(prefers-reduced-motion: reduce)').matches) {
        p.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 220, easing: 'ease-out' });
        h.animate([{ opacity: 0, transform: 'scale(.4)' }, { opacity: 1, transform: 'none' }], { duration: 220, easing: 'ease-out' });
      }
    }
    drawn.clear();
    for (const [from, to] of point.to) drawn.set(from, to);
    chips.forEach((c, p) => {
      c.querySelector('.pt-cnt')?.remove();
      const n = count.get(p);
      if (!n) return;
      const b = document.createElement('span');
      b.className = 'pt-cnt';
      b.textContent = `👉${n}`;
      c.append(b);
    });
  };
  point.draw = draw;
  for (const [p, c] of chips.entries()) {
    if (p === me || me === null || !canPoint(me) || !canPoint(p)) continue;
    c.classList.add('pt-can');
    c.tabIndex = 0;
    c.setAttribute('role', 'button');
    c.setAttribute('aria-label', `${c.querySelector('.cc-opp-name')?.textContent ?? ''}を指さす（投票には数えない）`);
    const go = (e) => {
      if (e.target.closest('button')) return; // 札の中のボタン（人狼の推理のメモ）は今までどおり
      const on = point.to.get(me) !== p;
      if (on) point.to.set(me, p); else point.to.delete(me);
      o.stream?.({ pt: key, to: on ? p : -1 });
      draw();
    };
    c.addEventListener('click', go);
    c.addEventListener('keydown', (e) => { if ((e.key === 'Enter' || e.key === ' ') && e.target === c) { e.preventDefault(); go(e); } });
  }
  draw();
  requestAnimationFrame(draw);
  let w = box.clientWidth;
  const ro = new ResizeObserver(() => { if (!svg.isConnected) { ro.disconnect(); return; } if (box.clientWidth !== w) { w = box.clientWidth; draw(); } });
  ro.observe(box);
  // あとから来た・読み込み直した人は、いまの向きを聞く（読み込み直した直後はまだ中継サーバーにつながっていないことがあるので、少しあとに2回聞き直す）
  if (point.asked !== key) {
    point.asked = key;
    for (const ms of [0, 1500, 4000]) setTimeout(() => { if (point.key === key) point.o?.stream?.({ pt: key, ask: 1 }); }, ms);
  }
}
// 届いた指さし（ゲームの onStream から呼ぶ）。指さしの知らせなら true
export function pointStream(d, from) {
  if (typeof d?.pt !== 'string') return false;
  if (d.pt !== point.key || !point.can) return true;
  const ok = (p) => Number.isInteger(p) && p >= 0 && point.can(p);
  if (d.ask) { // 聞かれたら（観戦の人からでも）、知っている矢印を全部送る（聞いた人が読み込み直す前に指していた矢印も、それで戻る）
    if (point.to.size) point.o?.stream?.({ pt: point.key, all: [...point.to] });
    return true;
  }
  if (Array.isArray(d.all)) { // 聞いた答え: まだ知らない人の矢印だけ足す（自分で知っている新しい向きを古い答えで上書きしない）
    for (const x of d.all.slice(0, 20)) if (Array.isArray(x) && ok(x[0]) && ok(x[1]) && x[0] !== x[1] && !point.to.has(x[0])) point.to.set(x[0], x[1]);
    point.draw?.();
    return true;
  }
  if (!ok(from) || !Number.isInteger(d.to) || d.to === from || (d.to >= 0 && !ok(d.to))) return true;
  if (d.to < 0) point.to.delete(from); else point.to.set(from, d.to);
  point.draw?.();
  return true;
}

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
      const shape = arrowShape(r0, chips[from], chips[to]);
      if (!shape) return;
      const [p, h] = shape;
      p.setAttribute('class', 'va-line');
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

// 役とお題は、押している間だけ見える（2026-11-24 本人の選択。UI・UX の11回目。party-games.md）: 同じ部屋に集まって遊ぶとき、となりの人に見えないように。
// 端末ごとの設定（localStorage の bg-hold-see。最初は今までどおり出したまま）。札の右上のボタンで切り替える。
// 札は描き直しのたびに作り直されるので、押している最中かどうかはここで覚える（押したまま描き直されても見えたままにする）。
const HOLD_KEY = 'bg-hold-see';
let holdOn = (() => { try { return typeof localStorage !== 'undefined' && localStorage.getItem(HOLD_KEY) === '1'; } catch { return false; } })();
let holding = false;
let holdPid = null; // 札を押している指の番号（ほかの指を離しても隠さない。2026-11-24 の2回目の Codex の点検）
let holdCard = null;
if (typeof window !== 'undefined') {
  for (const k of ['pointerup', 'pointercancel', 'blur']) {
    window.addEventListener(k, (e) => {
      if (k !== 'blur' && holding && e.pointerId !== holdPid) return;
      holding = false;
      holdPid = null;
      if (holdCard?.isConnected && holdOn) holdCard.classList.add('hold-shut');
    });
  }
}
export function holdToSee(card) {
  const tgl = document.createElement('button');
  tgl.type = 'button';
  tgl.className = 'hold-tgl';
  const tip = document.createElement('div');
  tip.className = 'hold-tip';
  tip.textContent = '押している間だけ見えます';
  const set = () => {
    tgl.textContent = holdOn ? '👁 いつも見せる' : '🙈 かくす';
    card.classList.toggle('hold', holdOn);
    card.classList.toggle('hold-shut', holdOn && !holding);
  };
  tgl.onpointerdown = (e) => e.stopPropagation();
  tgl.onclick = (e) => {
    e.stopPropagation();
    holdOn = !holdOn;
    try { localStorage.setItem(HOLD_KEY, holdOn ? '1' : '0'); } catch { /* 覚えられなくても遊べる */ }
    set();
  };
  card.addEventListener('pointerdown', (e) => { if (!holdOn) return; holding = true; holdPid = e.pointerId; card.classList.remove('hold-shut'); });
  card.addEventListener('contextmenu', (e) => { if (holdOn) e.preventDefault(); }); // 長押しのメニューを出さない
  card.append(tip, tgl);
  holdCard = card;
  set();
}

// だれかが脱落したら「のこり◯人」（2026-11-24 本人の選択「文字を透過させる」。UI・UX の11回目。action-games.md・quick-games.md）: 生き残りを競う遊びで、
// 生きている人の数が減った瞬間に、盤のまん中へ半透明の大きな字を1秒ほど出す。最後の1人（決着）では出さない。途中から開いた画面は、最初の1回は覚えるだけ。
// 盤は描き直しで中身が消えるので、字は body に置いて盤のまん中の位置に重ねる。
const leftSeen = new Map(); // 対局の鍵 → 前に見た数（いまの対局の分だけ持つ）
let leftEl = null; // いま出ている「のこり◯人」の字
export function leftFlash(host, key, alive) {
  const prev = leftSeen.get(key);
  leftSeen.clear();
  leftSeen.set(key, alive);
  if (prev === undefined || alive >= prev || alive < 2 || typeof document === 'undefined') return;
  const r = host.getBoundingClientRect();
  if (!r.width) return;
  leftEl?.remove(); // 続けて減ったら前の字は消して、新しい数だけ出す（重なっていた。2026-11-24 の2回目の Codex の点検）
  const d = document.createElement('div');
  leftEl = d;
  d.className = 'left-flash';
  d.textContent = 'のこり ' + alive + '人';
  d.style.left = (r.left + r.width / 2) + 'px';
  d.style.top = Math.max(60, Math.min(window.innerHeight - 60, r.top + r.height / 2)) + 'px';
  document.body.append(d);
  setTimeout(() => d.remove(), 1300);
}

// 始まる前に名前の札がチームへ分かれる（2026-11-24 本人の選択「2回光る演出のみ消す」。UI・UX の11回目。action-games.md）: チームで分かれる遊びの「よーい」の間、
// 全員の名前の札がまん中から自分のチームの側へ滑り、チームの色になる（味方を光らせる動きは付けない）。対局ごとに1回だけ。
// 盤は描き直しで中身が消えるので、札は body に置いて盤の上に重ねる（押せない。2.6秒で消える）。点数の札に重ならないよう、盤の上から3割ほど下げる。
const TEAM_INTRO = [['#e04b3c', '#fff', '赤'], ['#f4f4f4', '#333', '白'], ['#2f6fb3', '#fff', '青']];
let introKey = null;
export function teamIntro(host, key, o, n, teamOf, k) {
  if (introKey === key || typeof document === 'undefined') return;
  introKey = key;
  requestAnimationFrame(() => {
    const r = host.getBoundingClientRect();
    if (!r.width) return;
    const box = document.createElement('div');
    box.className = 'team-intro';
    box.style.cssText = 'left:' + r.left + 'px;top:' + (Math.max(0, r.top) + Math.min(r.height * 0.3, 170)) + 'px;width:' + r.width + 'px;';
    const rows = Array(k).fill(0);
    const chips = [];
    for (let p = 0; p < n; p++) {
      const t = teamOf(p);
      const c = document.createElement('div');
      c.className = 'team-chip';
      c.textContent = p === o.me && !o.watching ? 'あなた' : String(o.names?.[p] ?? '').slice(0, 8);
      c.style.top = (rows[t] * 34) + 'px';
      c.style.left = '50%';
      rows[t] += 1;
      box.append(c);
      chips.push([c, t]);
    }
    box.style.height = (Math.max(...rows) * 34) + 'px';
    document.body.append(box);
    setTimeout(() => {
      for (const [c, t] of chips) {
        c.style.left = (((t + 0.5) / k) * 100) + '%';
        c.style.background = TEAM_INTRO[t][0];
        c.style.color = TEAM_INTRO[t][1];
        c.dataset.team = TEAM_INTRO[t][2];
      }
    }, 350);
    setTimeout(() => box.classList.add('bye'), 2300);
    setTimeout(() => box.remove(), 2650);
  });
}
