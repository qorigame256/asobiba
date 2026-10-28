// 以心伝心。全員に同じお題（「赤い果物といえば？」など）が出て、みんなと同じになりそうな答えを1つ書く。
// 2026-10-27 本人の決定（Claude が出した案から本人が選んだ。分かれ目は Claude の問いに本人が答えた）:
//   点は「一番多かった答え」を書いた人だけに1点（本人の選択。Claude は同じ答えの人数ぶんの点を推した）。CPU を入れる（推奨を承認）。
// Claude の判断:
//   - 一番多い答えが並んだら、並んだ答えを書いた人は全員1点。一番多い答えでも1人だけ（全員ばらばら）なら、だれも点なし。
//   - 答えは1問に1回だけ（書き直しはなし）。全員が書いたら1.5秒で締め切り、書かなかった人は点なし。10問（5・15問も）・1問30秒（20・45秒も）。
//   - 同じ答えかどうか: ひらがな・カタカナ・全角半角・空白をそろえ（party.js の kana）、お題ごとに書いた「同じとみなす書き方」（ishin-data.js。林檎＝りんご など）もまとめる。
//     それ以外の言いかえ（「アップル」と「りんご」など）は別の答えになる。
//   - CPU は、お題のよくある答えから、前の方ほど選びやすく選ぶ（1つ目 45%・2つ目 25%・3つ目 15%・残りを等分）。
//   - 答えは締め切るまでほかの人に見せない（「書いた」印だけ）。手札と同じく簡易な隠し方（全員の端末は中身を知っている）。
//   - 書いた答えは人が打った文字なので、送る前に汚い言葉のふるいを通し（main.js の FREE_TEXT）、出すときも filter.js の shown を通す。
// 進行（ホストが時間を計って p = -1 の手を足す）: ready → next → open →（全員書いた1.5秒 / 制限時間）→ close → shown → next …
// 手: { p: -1, t: 'next' | 'close' } / { p, t: 'ans', q: 問題番号, text: 答え }

import { mulberry32, shuffle, esc } from './util.js';
import { since, kana, scoreChips, leaders, winnersText, timeBar } from './party.js';
import { TOPICS } from './ishin-data.js';
import { shown as filtered } from '../filter.js';

const ROUNDS = [[5, '5問'], [10, '10問'], [15, '15問']];
const READY_MS = 3000;
const SHOWN_MS = 6000; // 答えを見比べる時間
const GRACE_MS = 1500;
const MAX_TEXT = 20;
const CPU_PICK = [0.45, 0.25, 0.15]; // CPU がよくある答えの1つ目・2つ目・3つ目を選ぶ見込み（残りは等分）

const limitOf = (s) => Number(s.rules.time) * 1000;
const roundsOf = (r) => (ROUNDS.some(([v]) => v === r.rounds) ? r.rounds : 10);
const qKey = (s, q = s.q) => `ishin:${s.seed}:${q}`;
const clone = (s) => ({ ...s, scores: s.scores.slice(), said: s.said.slice() });

// 答えをまとめる鍵。お題の「同じとみなす書き方」に当たれば '\n何番目'、ほかは kana でそろえた文字
// （印は kana が必ず消す空白の文字にする。'#' だと「#3」と打った答えがお題の番号に化け、無い番号なら集計が止まった。2026-10-28 Codex の点検の指摘）
export function groupKey(topic, text) {
  const k = kana(text);
  if (!k) return '';
  const i = topic[1].findIndex((names) => names.some((x) => kana(x) === k));
  return i >= 0 ? '\n' + i : k;
}

// 締め切りのときの答えのまとまり。{ groups: [{ key, who: [席…], label }]（多い順）, top: 一番多いまとまりの鍵の一覧（1人だけなら空）, pts: 席ごとの点 }
export function tally(topic, said) {
  const map = new Map();
  said.forEach((text, p) => {
    const key = groupKey(topic, text);
    if (!key) return;
    if (!map.has(key)) map.set(key, { key, who: [], label: key[0] === '\n' ? topic[1][Number(key.slice(1))][0] : null });
    map.get(key).who.push(p);
  });
  const groups = [...map.values()].sort((a, b) => b.who.length - a.who.length || a.who[0] - b.who[0]);
  const max = groups.length ? groups[0].who.length : 0;
  const top = max >= 2 ? groups.filter((g) => g.who.length === max).map((g) => g.key) : [];
  const pts = said.map((text) => (top.includes(groupKey(topic, text)) ? 1 : 0));
  return { groups, top, pts };
}

let ui = null; // { mount, wrap, chips, note, input }
const cpuPlan = new Map();

export default {
  id: 'ishin',
  name: '以心伝心',
  icon: '💞',
  desc: 'お題にみんなと同じ答えを書けたら点。一番多い答えを当てよう',
  ready: true,
  multi: true,
  realtime: true,
  minPlayers: 2,
  maxPlayers: 10,
  settings: [
    { key: 'time', label: '制限時間', desc: '1問あたりの時間', def: '30', choices: [['20', '20秒'], ['30', '30秒'], ['45', '45秒']] },
    { key: 'rounds', label: '問題の数', desc: '1回の対局で出るお題の数', def: 10, choices: ROUNDS },
  ],

  init(n, seed, { rules = {} } = {}) {
    const r = { time: '30', rounds: 10, ...rules };
    const qs = shuffle(TOPICS.map((_, i) => i), mulberry32(seed)).slice(0, roundsOf(r));
    return { n, seed, rules: r, qs, q: -1, phase: 'ready', said: Array(n).fill(''), scores: Array(n).fill(0), last: null, log: [], step: 0 };
  },

  turn() { return null; },
  canAct(s) { return s.phase === 'open'; },
  result(s) { return s.phase === 'end' ? { winners: leaders(s.scores), scores: s.scores } : null; },
  sound(a, b, m, me) {
    if (m.p === -1) return m.t === 'next' ? 'question' : b.last.pts[me] ? 'correct' : 'pop';
    return m.p === me ? 'pop' : null;
  },
  resultText(res, me, pn) { return winnersText(res.winners, me, pn); },
  phaseText(s) {
    if (s.phase === 'ready') return 'まもなく始まります…';
    if (s.phase === 'open') return `第${s.q + 1}問 / ${s.qs.length}`;
    return `第${s.q + 1}問の答え`;
  },

  referee(s) {
    if (s.phase === 'ready') return { key: 'ready', ms: READY_MS, move: { t: 'next' } };
    if (s.phase === 'open') {
      if (s.said.every((x) => x)) return { key: 'all' + s.q, ms: GRACE_MS, move: { t: 'close' } };
      return { key: 'open' + s.q, ms: limitOf(s) + GRACE_MS, move: { t: 'close' } };
    }
    if (s.phase === 'shown') return { key: 'shown' + s.q, ms: SHOWN_MS, move: { t: 'next' } };
    return null;
  },

  apply(s0, m) {
    if (!m) return null;
    if (m.p === -1) {
      if (m.t === 'next' && (s0.phase === 'ready' || s0.phase === 'shown')) {
        const s = clone(s0);
        s.step += 1;
        if (s.q + 1 >= s.qs.length) { s.phase = 'end'; return s; }
        s.q += 1;
        s.phase = 'open';
        s.said = Array(s.n).fill('');
        return s;
      }
      if (m.t === 'close' && s0.phase === 'open') {
        const s = clone(s0);
        s.step += 1;
        s.phase = 'shown';
        const t = tally(TOPICS[s.qs[s.q]], s.said);
        t.pts.forEach((v, p) => { s.scores[p] += v; });
        s.last = { top: t.top, pts: t.pts };
        s.log = [...s0.log, { said: s.said.slice(), pts: t.pts }];
        return s;
      }
      return null;
    }
    if (m.t !== 'ans' || s0.phase !== 'open' || m.q !== s0.q || !Number.isInteger(m.p) || m.p < 0 || m.p >= s0.n || s0.said[m.p]) return null;
    if (typeof m.text !== 'string') return null;
    const text = m.text.trim();
    if (!text || text.length > MAX_TEXT || !kana(text)) return null;
    const s = clone(s0);
    s.step += 1;
    s.said[m.p] = text;
    return s;
  },

  // CPU: 3秒〜制限時間の半分のあいだに、よくある答えから選んで書く
  cpuDelay(s) { return s.phase === 'open' ? 250 : 500; },
  cpu(s, p) {
    if (s.phase !== 'open' || s.said[p]) return null;
    const key = qKey(s) + ':' + p;
    let plan = cpuPlan.get(key);
    if (!plan) {
      const list = TOPICS[s.qs[s.q]][1];
      let r = Math.random(), pick = list.length - 1;
      for (let i = 0; i < list.length; i++) {
        const w = CPU_PICK[i] ?? (1 - CPU_PICK.reduce((a, b) => a + b, 0)) / Math.max(1, list.length - CPU_PICK.length);
        if ((r -= w) < 0) { pick = i; break; }
      }
      plan = { at: 3000 + Math.random() * Math.max(0, limitOf(s) * 0.5 - 3000), text: list[Math.min(pick, list.length - 1)][0], done: false };
      cpuPlan.set(key, plan);
      if (cpuPlan.size > 200) cpuPlan.delete(cpuPlan.keys().next().value);
    }
    if (plan.done || since(qKey(s)) < plan.at) return null;
    plan.done = true;
    return { t: 'ans', q: s.q, text: plan.text };
  },

  render(root, s, o) {
    const me = o.me >= 0 ? o.me : null;
    // 答えを見せた後は「この人を隠す」が変わったら作り直す（書いている間は入力欄を残すため入れない）
    const mount = `${s.seed}:${s.q}:${s.phase}:${me}:${me !== null && !!s.said[me]}:${s.phase === 'open' ? '' : (o.hidden ?? []).join()}`;
    const won = s.phase === 'end' ? leaders(s.scores) : [];
    const shownPhase = s.phase === 'shown';
    const extra = (p) => {
      if (s.phase === 'open') return s.said[p] ? '<span class="pt-ok">書いた</span>' : '';
      if (!shownPhase || !s.last) return '';
      return s.last.pts[p] ? '<span class="pt-ok">○ +1</span>' : '<span class="pt-ng">―</span>';
    };
    const chips = scoreChips(o, s.scores, { won, extra });
    if (ui?.mount === mount && root.contains(ui.wrap)) {
      ui.chips.replaceWith(chips);
      ui.chips = chips;
      this.note(s, me, o);
      return;
    }

    root.innerHTML = '';
    root.className = 'board kj ishin';
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
    if (s.phase === 'ready') {
      card.innerHTML = `<div class="kj-word small">よーい…</div><div class="kj-sub">全${s.qs.length}問・1問 ${s.rules.time}秒・一番多かった答えを書いた人に1点</div>`;
      wrap.append(card);
      root.append(wrap);
      return;
    }
    const topic = TOPICS[s.qs[s.q]];
    const key = qKey(s);
    const limit = limitOf(s);
    card.innerHTML = `<div class="kj-num">第${s.q + 1}問 / ${s.qs.length}</div><div class="is-topic"></div>`;
    card.querySelector('.is-topic').textContent = topic[0];
    if (s.phase === 'open') {
      since(key);
      card.append(timeBar(key, limit, { secs: true }));
    } else {
      card.append(this.answers(s, me, o, topic));
    }
    wrap.append(card);

    const note = document.createElement('p');
    note.className = 'cc-log';
    ui.note = note;
    if (s.phase === 'open' && me !== null && !s.said[me]) {
      const form = document.createElement('form');
      form.className = 'kj-form';
      form.innerHTML = `<input type="text" autocomplete="off" autocapitalize="off" spellcheck="false" enterkeyhint="send" maxlength="${MAX_TEXT}" placeholder="みんなと同じになりそうな答え"><button type="submit" class="btn primary">書く</button>`;
      const input = form.querySelector('input');
      form.onsubmit = (e) => {
        e.preventDefault();
        const text = input.value.trim();
        if (!text || since(key) >= limit) return;
        if (!kana(text)) { note.textContent = '文字を入れてください'; return; }
        o.onMove({ t: 'ans', q: s.q, text });
      };
      ui.input = input;
      wrap.append(form);
      setTimeout(() => {
        if (!form.isConnected) return;
        input.disabled = true;
        form.querySelector('button').disabled = true;
        note.textContent = '時間切れ！';
      }, Math.max(0, limit - since(key)));
    }
    wrap.append(note);
    root.append(wrap);
    this.note(s, me, o);
    if (ui.input && !matchMedia('(pointer: coarse)').matches && document.activeElement?.tagName !== 'SELECT') ui.input.focus();
  },

  // 答えを見せる場面: まとまりごとに、答えと書いた人を多い順に並べる（一番多いまとまりを光らせる）
  answers(s, me, o, topic) {
    const box = document.createElement('div');
    box.className = 'is-groups';
    const t = tally(topic, s.said);
    const nameOf = (p) => esc(p === me ? 'あなた' : o.names?.[p] ?? `プレイヤー${p + 1}`);
    for (const g of t.groups) {
      const row = document.createElement('div');
      row.className = 'is-group' + (t.top.includes(g.key) ? ' top' : '');
      const label = g.label ?? filtered(s.said[g.who[0]], o.hidden?.[g.who[0]]); // まとめた書き方に当たらなかった答えは、最初に書いた人の文字のまま
      row.innerHTML = `<span class="is-ans">${esc(label)}</span><span class="is-cnt">${g.who.length}人</span><span class="is-names">${g.who.map(nameOf).join('・')}</span>`;
      box.append(row);
    }
    const none = s.said.map((x, p) => (x ? -1 : p)).filter((p) => p >= 0);
    if (none.length) {
      const row = document.createElement('div');
      row.className = 'is-group none';
      row.innerHTML = `<span class="is-ans">（書かなかった）</span><span class="is-cnt">${none.length}人</span><span class="is-names">${none.map(nameOf).join('・')}</span>`;
      box.append(row);
    }
    return box;
  },

  // ふりかえり: お題ごとに、一番多かった答えと自分の答え
  review(s, me, o) {
    const box = document.createElement('details');
    box.className = 'kj-review mk-review';
    box.open = true;
    const got = me === null ? 0 : s.log.filter((x) => x.pts[me]).length;
    const sum = document.createElement('summary');
    sum.textContent = `📝 ふりかえり（全${s.log.length}問${me !== null ? `・あなたがそろえた ${got}問` : ''}）`;
    const list = document.createElement('ol');
    s.log.forEach((x, q) => {
      const topic = TOPICS[s.qs[q]];
      const t = tally(topic, x.said);
      const top = t.groups.filter((g) => t.top.includes(g.key)).map((g) => g.label ?? filtered(x.said[g.who[0]], o.hidden?.[g.who[0]]));
      const mine = me === null ? '' : x.said[me] ? filtered(x.said[me], false) : '（なし）';
      const li = document.createElement('li');
      li.innerHTML = `<span class="mk-rv-n">${q + 1}</span>${me !== null ? `<span>${x.pts[me] ? '⭕' : '❌'}</span>` : ''}`
        + `<span class="is-rv-topic">${esc(topic[0])}</span>`
        + `<span class="mk-rv-ex">${top.length ? esc(top.join('・')) : 'そろわず'}${me !== null ? `<small>（あなた: ${esc(mine)}）</small>` : ''}</span>`;
      list.append(li);
    });
    box.append(sum, list);
    return box;
  },

  note(s, me, o) {
    const note = ui?.note;
    if (!note) return;
    if (s.phase === 'open') {
      if (me !== null && s.said[me]) note.textContent = `「${filtered(s.said[me], o.hidden?.[me])}」と書きました。ほかの人を待っています`;
      else if (me === null) note.textContent = '観戦中';
      else if (!note.textContent) note.textContent = '一番多くの人が書きそうな答えを1つ（書き直しはできません）';
    } else if (s.phase === 'shown' && s.last) {
      note.textContent = s.last.top.length ? '' : '一番多い答えがそろいませんでした（だれも点なし）';
    } else {
      note.textContent = '';
    }
  },
};
