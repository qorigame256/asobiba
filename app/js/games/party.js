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
export function scoreChips(o, scores, { turn = null, won = [], extra = null, steady = false } = {}) {
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

// 残り時間の帯。ms 後に空になる。帯の要素が画面から外れたら勝手に止まる
// secs = true なら、帯の下に残りの秒数も数字で出す（2026-10-26 本人の依頼。難読漢字）。そのときは帯と数字を包んだ要素を返す
export function timeBar(key, limit, { secs = false } = {}) {
  const bar = document.createElement('div');
  bar.className = 'pt-timebar';
  const fill = document.createElement('div');
  bar.append(fill);
  const num = secs ? document.createElement('div') : null;
  if (num) num.className = 'pt-secs';
  const tick = () => {
    if (!bar.isConnected && bar.dataset.started) return;
    bar.dataset.started = '1';
    const left = Math.max(0, 1 - since(key) / limit);
    fill.style.width = (left * 100).toFixed(1) + '%';
    bar.classList.toggle('low', left < 0.3);
    if (num) {
      num.textContent = `残り ${Math.ceil((left * limit) / 1000)}秒`;
      num.classList.toggle('low', left < 0.3);
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

// 席ごとの色（10人ぶん。最初の4つは --p0〜--p3 と同じ）。迷路早抜け・すごろくのコマ。どのスキンでも変えない
export const SEAT_COLORS = ['#d9643a', '#2f6fb3', '#2e9a52', '#8a4fc0', '#d4a20c', '#d24a8c', '#1a9aa0', '#7a5a3a', '#5a6470', '#9acd32'];
export { esc };
