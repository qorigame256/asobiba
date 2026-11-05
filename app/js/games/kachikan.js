// 価値観ならべ（「ito」風。元の商品名は使わない）。協力ゲーム。全員に1〜100の数字がひそかに配られ、お題に合わせて自分の数字を言葉で書き、
// 小さい順だと思う順に1人ずつ出していく。2〜10人・足りない分は CPU（弱め）。
// 2026-11-05 本人の決定（Claude が出した案から本人が選んだ。分かれ目はすべて Claude の推奨を本人が承認）:
//   - 協力ゲーム。まちがえたら（まだ出していない人に小さい数字が残っていたら）ライフが1つ減る。ライフは3つ。いくつのお題を続けて成功できたかを競う。
//   - 書く言葉は自由に打つ言葉なので、汚い言葉のふるいを2か所とも通す（main.js の FREE_TEXT と、出すときの filter.js の shown）。
//   - CPU を入れる: お題ごとの「小さい→大きい」の言葉の列（kachikan-data.js）から、自分の数字に近い場所の言葉を出す。
// Claude の判断:
//   - お題は最大10こ。ライフが0になるか、10こ終えたら終わり。ライフが残ったまま全部出し終えたお題を「クリア」と数える。
//     10こ全部クリアしたら全員の勝ち、それより前にライフが0になったら「◯こクリア」で引き分け（協力なので、だれか1人の勝ちにしない）。
//   - まちがえたとき: 出した人より小さい数字を持っていた人の札は、その場で全部めくって捨てる（ライフは1回のまちがいで1つだけ減る）。
//   - 言葉を書く時間は60秒（全員が書いたら1.5秒で次へ）。書かなかった人は言葉なしのまま出す場面へ。書き直しはなし。言葉は20文字まで。
//   - 出す場面に時間の決まりはない（相談はできないので、言葉を見比べて「たぶん自分が一番小さい」と思ったら出す）。
//   - 数字は全員の端末が知っている（手札と同じ簡易の隠し方）。画面には自分の数字と、出た札の数字だけを出す。
//   - CPU は、言葉の列の数字の場所から ±1 ずれた所の言葉を使うことがある（弱め）。出すのは「前の札が出てから 1.2秒 ＋ (自分の数字 − 前の札の数字) × 0.09秒」たったとき。
// 進行（ホストが時間を計って p = -1 の手を足す）: ready → next → write → close → play →（全部出た）→ done → next … → end
// 手: { p: -1, t: 'next' | 'close' } / { p, t: 'word', r: 何こ目のお題か, text } / { p, t: 'play', r }

import { mulberry32, shuffle, esc } from './util.js';
import { since, kana, scoreChips, timeBar } from './party.js';
import { TOPICS } from './kachikan-data.js';
import { shown as filtered } from '../filter.js';

export const MAX_ROUNDS = 10;
export const LIVES = 3;
const READY_MS = 3000;
const WRITE_MS = 60000;
const GRACE_MS = 1500;
const DONE_MS = 4500;
const MAX_TEXT = 20;

// その回の数字（1〜100 から人数ぶん、重ならないように）。種と何こ目のお題かで決まるので全員同じ
export function numbersOf(seed, r, n) {
  const rnd = mulberry32((seed * 613 + r * 97 + 3) >>> 0);
  return shuffle([...Array(100)].map((_, i) => i + 1), rnd).slice(0, n);
}
// CPU の言葉（数字 v に近い場所の言葉。shift で ±1 ずらす）
export function cpuWord(topic, v, shift = 0) {
  const list = topic[3];
  const i = Math.round(((v - 1) / 99) * (list.length - 1)) + shift;
  return list[Math.max(0, Math.min(list.length - 1, i))];
}
const rKey = (s) => `kachikan:${s.seed}:${s.r}`;
const pKey = (s) => `${rKey(s)}:p${s.order.length}`; // 出す場面の時計（札が1枚出るたびに替える）
const clone = (s) => ({ ...s, words: s.words.slice(), state: s.state.slice(), order: s.order.slice() });
const handOf = (s) => s.state.map((x, p) => (x === 'hand' ? p : -1)).filter((p) => p >= 0);
const cpuPlan = new Map();
let ui = null; // { mount, wrap, chips, note, input }

export default {
  id: 'kachikan',
  name: '価値観ならべ',
  icon: '🔢',
  desc: '協力ゲーム。ひみつの数字をお題に合わせた言葉で伝え、みんなで小さい順に出す',
  ready: true,
  multi: true,
  realtime: true,
  minPlayers: 2,
  maxPlayers: 10,

  init(n, seed) {
    const topics = shuffle([...TOPICS.keys()], mulberry32(seed)).slice(0, MAX_ROUNDS);
    return {
      n, seed, topics, r: -1, phase: 'ready', lives: LIVES, cleared: 0, perfect: 0, miss: 0,
      nums: Array(n).fill(0), words: Array(n).fill(null), state: Array(n).fill('hand'), order: [], log: [], step: 0, last: null,
    };
  },

  turn() { return null; },
  canAct(s, p) { return (s.phase === 'write' && s.words[p] === null) || (s.phase === 'play' && s.state[p] === 'hand'); },
  result(s) {
    if (s.phase !== 'end') return null;
    const all = s.cleared >= MAX_ROUNDS;
    return all ? { winners: [...Array(s.n).keys()], cleared: s.cleared, perfect: s.perfect } : { winners: [], draw: true, cleared: s.cleared, perfect: s.perfect };
  },
  sound(a, b, m) {
    if (m.p === -1) return m.t === 'next' ? 'question' : m.t === 'close' ? 'card' : null;
    if (m.t === 'play') return b.lives < a.lives ? 'wrong' : 'card';
    return null;
  },
  resultText(res) {
    if (res.cleared >= MAX_ROUNDS) return `${MAX_ROUNDS}こ全部クリア！ みんなの勝ち！🎉`;
    return `${res.cleared}このお題をクリア！（まちがえずに出せたのは ${res.perfect}こ）`;
  },
  phaseText(s) {
    if (s.phase === 'ready') return 'まもなく始まります…';
    return `お題 ${s.r + 1} / ${MAX_ROUNDS}　ライフ ${'❤️'.repeat(Math.max(0, s.lives))}${'🖤'.repeat(Math.max(0, LIVES - s.lives))}`;
  },

  referee(s) {
    if (s.phase === 'ready') return { key: 'ready', ms: READY_MS, move: { t: 'next' } };
    if (s.phase === 'write') {
      if (s.words.every((w) => w !== null)) return { key: 'all' + s.r, ms: GRACE_MS, move: { t: 'close' } };
      return { key: 'write' + s.r, ms: WRITE_MS + GRACE_MS, move: { t: 'close' } };
    }
    if (s.phase === 'done') return { key: 'done' + s.r, ms: DONE_MS, move: { t: 'next' } };
    return null;
  },

  apply(s0, m) {
    if (!m) return null;
    if (m.p === -1) {
      if (m.t === 'next' && (s0.phase === 'ready' || s0.phase === 'done')) {
        const s = clone(s0);
        s.step += 1;
        if (s.r + 1 >= MAX_ROUNDS || s.lives <= 0) { s.phase = 'end'; return s; }
        s.r += 1;
        s.phase = 'write';
        s.nums = numbersOf(s.seed, s.r, s.n);
        s.words = Array(s.n).fill(null);
        s.state = Array(s.n).fill('hand');
        s.order = [];
        s.miss = 0;
        s.last = null;
        return s;
      }
      if (m.t === 'close' && s0.phase === 'write') {
        const s = clone(s0);
        s.step += 1;
        s.words = s.words.map((w) => w ?? '');
        s.phase = 'play';
        return s;
      }
      return null;
    }
    if (!Number.isInteger(m.p) || m.p < 0 || m.p >= s0.n || m.r !== s0.r) return null;
    if (m.t === 'word') {
      if (s0.phase !== 'write' || s0.words[m.p] !== null || typeof m.text !== 'string') return null;
      const text = m.text.trim().slice(0, MAX_TEXT);
      if (!kana(text)) return null;
      const s = clone(s0);
      s.step += 1;
      s.words[m.p] = text;
      return s;
    }
    if (m.t !== 'play' || s0.phase !== 'play' || s0.state[m.p] !== 'hand') return null;
    const s = clone(s0);
    s.step += 1;
    const v = s.nums[m.p];
    const smaller = handOf(s0).filter((q) => s.nums[q] < v).sort((a, b) => s.nums[a] - s.nums[b]);
    for (const q of smaller) { s.state[q] = 'skip'; s.order.push(q); }
    s.state[m.p] = 'ok';
    s.order.push(m.p);
    s.last = { p: m.p, skipped: smaller };
    if (smaller.length) { s.lives -= 1; s.miss += 1; }
    if (s.lives <= 0) {
      s.log = [...s0.log, { topic: s.topics[s.r], nums: s.nums.slice(), words: s.words.slice(), order: s.order.slice(), ok: false }];
      s.phase = 'end';
      return s;
    }
    if (!handOf(s).length) {
      s.cleared += 1;
      if (!s.miss) s.perfect += 1;
      s.log = [...s0.log, { topic: s.topics[s.r], nums: s.nums.slice(), words: s.words.slice(), order: s.order.slice(), ok: true, miss: s.miss }];
      s.phase = 'done';
    }
    return s;
  },

  cpuDelay(s) { return s.phase === 'play' ? 150 : 400; },
  cpu(s, p) {
    const topic = TOPICS[s.topics[s.r]];
    if (s.phase === 'write' && s.words[p] === null) {
      const key = rKey(s) + ':w' + p;
      let plan = cpuPlan.get(key);
      if (!plan) {
        const r = Math.random();
        plan = { at: 3000 + Math.random() * 6000, text: cpuWord(topic, s.nums[p], r < 0.2 ? -1 : r > 0.8 ? 1 : 0) };
        cpuPlan.set(key, plan);
        if (cpuPlan.size > 300) cpuPlan.delete(cpuPlan.keys().next().value);
      }
      return since(rKey(s)) >= plan.at ? { t: 'word', r: s.r, text: plan.text } : null;
    }
    if (s.phase !== 'play' || s.state[p] !== 'hand') return null;
    const prev = s.order.length ? s.nums[s.order[s.order.length - 1]] : 0;
    const wait = 1200 + Math.max(0, s.nums[p] - prev) * 90;
    return since(pKey(s)) >= wait ? { t: 'play', r: s.r } : null;
  },

  render(root, s, o) {
    const me = o.me >= 0 && !o.watching ? o.me : null;
    // 書いている間は入力欄を残す（作り直すとスマホのキーボードが閉じる。以心伝心と同じ）
    const mount = `${s.seed}:${s.r}:${s.phase}:${me}:${me !== null && s.words[me] !== null}:${s.phase === 'write' ? '' : (o.hidden ?? []).join()}:${s.order.length}`;
    const extra = (p) => {
      if (s.phase === 'write') return s.words[p] !== null ? '<span class="pt-ok">書いた</span>' : '';
      if (s.phase === 'play' || s.phase === 'done') return s.state[p] === 'hand' ? '<span class="pt-extra">手札あり</span>' : s.state[p] === 'skip' ? '<span class="pt-ng">✗</span>' : '<span class="pt-ok">出した</span>';
      return '';
    };
    const chips = scoreChips(o, Array(s.n).fill(s.cleared), { extra, steady: true });
    chips.querySelectorAll('.pt-score').forEach((x) => { x.innerHTML = `${s.cleared}<small>クリア</small>`; });
    if (ui?.mount === mount && root.contains(ui.wrap)) {
      ui.chips.replaceWith(chips);
      ui.chips = chips;
      this.note(s, me, o);
      return;
    }
    root.innerHTML = '';
    root.className = 'board kj kc';
    const wrap = document.createElement('div');
    wrap.className = 'kj-wrap';
    ui = { mount, wrap, chips };
    wrap.append(chips);
    if (s.phase === 'end') {
      wrap.append(this.review(s, me, o));
      root.append(wrap);
      return;
    }
    const card = document.createElement('div');
    card.className = 'kj-card';
    wrap.append(card);
    if (s.phase === 'ready') {
      card.innerHTML = `<div class="kj-word small">よーい…</div><div class="kj-sub">みんなで協力！ ひみつの数字をお題に合わせた言葉で伝えて、小さい順に出そう</div>`;
      root.append(wrap);
      return;
    }
    const topic = TOPICS[s.topics[s.r]];
    card.innerHTML = `<div class="kj-num">お題 ${s.r + 1} / ${MAX_ROUNDS}</div><div class="kc-topic"></div><div class="kc-scale"><span>1 = </span><span>100 = </span></div>`;
    card.querySelector('.kc-topic').textContent = topic[0];
    const sc = card.querySelectorAll('.kc-scale span');
    sc[0].textContent = `1 = ${topic[1]}`;
    sc[1].textContent = `100 = ${topic[2]}`;
    if (me !== null) card.insertAdjacentHTML('beforeend', `<div class="kc-mine">あなたの数字 <b>${s.nums[me]}</b></div>`);
    const note = document.createElement('p');
    note.className = 'cc-log';
    ui.note = note;

    if (s.phase === 'write') {
      const key = rKey(s);
      since(key);
      card.append(timeBar(key, WRITE_MS, { secs: true }));
      if (me !== null && s.words[me] === null) {
        const form = document.createElement('form');
        form.className = 'kj-form';
        form.innerHTML = `<input type="text" autocomplete="off" autocapitalize="off" spellcheck="false" enterkeyhint="send" maxlength="${MAX_TEXT}" placeholder="数字の大きさが伝わる言葉"><button type="submit" class="btn primary">書く</button>`;
        const input = form.querySelector('input');
        form.onsubmit = (e) => {
          e.preventDefault();
          const text = input.value.trim();
          if (!text || since(key) >= WRITE_MS) return;
          if (!kana(text)) { note.textContent = '文字を入れてください'; return; }
          o.onMove({ t: 'word', r: s.r, text });
        };
        ui.input = input;
        wrap.append(form);
        setTimeout(() => {
          if (!form.isConnected) return;
          input.disabled = true;
          form.querySelector('button').disabled = true;
          note.textContent = '時間切れ！';
        }, Math.max(0, WRITE_MS - since(key)));
      }
      wrap.append(note);
      root.append(wrap);
      this.note(s, me, o);
      if (ui.input && !matchMedia('(pointer: coarse)').matches && document.activeElement?.tagName !== 'SELECT') ui.input.focus();
      return;
    }

    // 出す場面・お題の終わり: 出た札（出た順）と、まだ出ていない人の言葉
    since(pKey(s));
    const nameOf = (p) => (p === me ? 'あなた' : o.names?.[p] ?? `プレイヤー${p + 1}`);
    const wordOf = (p) => (s.words[p] ? filtered(s.words[p], o.hidden?.[p], 'short') : '（言葉なし）');
    const row = document.createElement('div');
    row.className = 'kc-line';
    if (!s.order.length) row.innerHTML = '<div class="kc-empty">まだだれも出していません</div>';
    for (const p of s.order) {
      const c = document.createElement('div');
      c.className = 'kc-card ' + (s.state[p] === 'skip' ? 'skip' : 'ok') + (s.last?.p === p ? ' new' : '');
      c.innerHTML = '<b></b><span class="kc-w"></span><span class="kc-n"></span>';
      c.querySelector('b').textContent = String(s.nums[p]);
      c.querySelector('.kc-w').textContent = wordOf(p);
      c.querySelector('.kc-n').textContent = nameOf(p);
      row.append(c);
    }
    wrap.append(row);
    const hand = handOf(s);
    if (hand.length) {
      const list = document.createElement('div');
      list.className = 'kc-hand';
      for (const p of hand) {
        const c = document.createElement('div');
        c.className = 'kc-card hand' + (p === me ? ' me' : '');
        c.innerHTML = '<b>？</b><span class="kc-w"></span><span class="kc-n"></span>';
        if (p === me) c.querySelector('b').textContent = String(s.nums[p]);
        c.querySelector('.kc-w').textContent = wordOf(p);
        c.querySelector('.kc-n').textContent = nameOf(p);
        list.append(c);
      }
      wrap.append(list);
    }
    if (s.phase === 'play' && me !== null && s.state[me] === 'hand') {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'btn primary kc-play';
      btn.textContent = `🃏 自分の札（${s.nums[me]}）を出す`;
      btn.disabled = !o.canMove;
      btn.onclick = () => {
        if (btn.dataset.sent) return;
        btn.dataset.sent = '1';
        btn.disabled = true;
        o.onMove({ t: 'play', r: s.r });
      };
      wrap.append(btn);
    }
    wrap.append(note);
    root.append(wrap);
    this.note(s, me, o);
  },

  note(s, me, o) {
    const note = ui?.note;
    if (!note) return;
    const nameOf = (p) => (p === me ? 'あなた' : o.names?.[p] ?? '');
    if (s.phase === 'write') {
      if (me === null) note.textContent = '観戦中';
      else if (s.words[me] !== null) note.textContent = `「${filtered(s.words[me], o.hidden?.[me], 'short')}」と書きました。ほかの人を待っています`;
      else if (!note.textContent) note.textContent = '自分の数字の大きさが伝わる言葉を1つ（数字そのものは書かないでね）';
    } else if (s.phase === 'play') {
      const l = s.last;
      if (l?.skipped.length) note.textContent = `💔 まちがい！ ${l.skipped.map(nameOf).join('・')} の方が小さかった（ライフ −1）`;
      else if (me !== null && s.state[me] === 'hand') note.textContent = '言葉を見比べて、自分が一番小さいと思ったら出そう';
      else note.textContent = 'ほかの人が出すのを待っています…';
    } else if (s.phase === 'done') {
      note.textContent = s.miss ? `クリア！（まちがい ${s.miss}回）` : '🎉 パーフェクト！ まちがえずに出せた';
    } else note.textContent = '';
  },

  review(s, me, o) {
    const box = document.createElement('details');
    box.className = 'kj-review mk-review';
    box.open = true;
    const sum = document.createElement('summary');
    sum.textContent = `📝 ふりかえり（${s.log.length}このお題）`;
    const list = document.createElement('ol');
    s.log.forEach((x, i) => {
      const topic = TOPICS[x.topic];
      const li = document.createElement('li');
      const cards = x.order.map((p) => `${x.nums[p]}「${filtered(x.words[p] || '―', o.hidden?.[p], 'short')}」`).join(' → ');
      li.innerHTML = `<span class="mk-rv-n">${i + 1}</span><span>${x.ok ? (x.miss ? '⭕' : '🌟') : '💔'}</span><span class="is-rv-topic">${esc(topic[0])}</span><span class="mk-rv-ex">${esc(cards)}</span>`;
      list.append(li);
    });
    box.append(sum, list);
    return box;
  },
};
