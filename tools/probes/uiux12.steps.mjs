// play-shot.mjs 用の操作の JSON を書き出す（2026-11-25 の UI・UX の12回目の確認）。
// 使い方: node tools/probes/uiux12.steps.mjs <書き出すフォルダ> → そのフォルダに cube4.json・kabe.json・daifugo.json・memory.json ができる。
//   node tools/play-shot.mjs cube4 --steps <フォルダ>/cube4.json --out <絵のフォルダ>
//   node tools/play-shot.mjs kabe --steps <フォルダ>/kabe.json --out <絵のフォルダ>
//   node tools/play-shot.mjs daifugo --steps <フォルダ>/daifugo.json --out <絵のフォルダ>
//   node tools/play-shot.mjs memory --rule cards=24 --steps <フォルダ>/memory.json --out <絵のフォルダ> --timeout 170
import fs from 'node:fs';
import path from 'node:path';
const dir = process.argv[2];
const put = (name, steps) => fs.writeFileSync(path.join(dir, name + '.json'), JSON.stringify(steps));

// 立体四目並べ: 柱を押した直後に、落ちる玉（.cb-slot.drop）と落ちる段の数を読む
put('cube4', [{ wait: 2800 },
  { eval: "document.querySelectorAll('.cb-col.playable')[5]?.click(), 1" }, { wait: 60 },
  { eval: "(() => { const e = document.querySelector('.cb-slot.drop'); return e ? getComputedStyle(e).animationName + ' dz=' + e.style.getPropertyValue('--dz') : 'none'; })()", as: 'drop' },
  { shot: 'cube4', selector: '#board' }]);

// かべ置きレース: 相手の丸のすぐ前に横の壁を置き、「ゴールまで」の数え上がりと「+」を読む
const clickGrid = "(() => { const g = document.querySelector('.kw-grid'); const b = g.getBoundingClientRect(); const ev = new MouseEvent('click', { bubbles: true, clientX: b.left + b.width * 0.5, clientY: b.top + b.height / 9 }); g.dispatchEvent(ev); return 1; })()";
put('kabe', [{ wait: 2800 },
  { eval: "[...document.querySelectorAll('.kw-tab')].find((b) => b.textContent.includes('壁'))?.click(), 1" }, { wait: 200 },
  { eval: clickGrid }, { wait: 200 }, { shot: 'kabe-ghost', selector: '#board' }, { eval: clickGrid }, { wait: 300 },
  { eval: "(() => { const e = document.querySelector('.kw-up'); return e ? e.outerHTML + ' / ' + getComputedStyle(e, '::after').content + ' / ' + (document.querySelector('.kw-plus')?.textContent ?? '') : 'none: ' + document.body.innerText.match(/ゴールまで[^\\n]*/)?.[0]; })()", as: 'up' },
  { wait: 1000 }, { shot: 'kabe' }]);

// 大富豪: 場に革命の色のクラスを付けた見た目だけを撮る（革命を起こすのは運なので。クラスを付ける条件は daifugo.js の1行）
put('daifugo', [{ wait: 3500 }, { shot: 'df-a', selector: '.df-field' },
  { eval: "document.querySelector('.df-field').classList.add('rev'), getComputedStyle(document.querySelector('.df-field')).backgroundColor", as: 'rev' },
  { shot: 'df-rev', selector: '.df-field' }]);

// 神経衰弱: CPU どうしでそろうのを待ち、飛ぶ札の写し（.mm-fly）が出た数を数える。自分の番は適当に2枚めくる
const steps = [{ wait: 2500 },
  { eval: "(window.__fly = 0, new MutationObserver((ms) => { for (const m of ms) for (const n of m.addedNodes) if (n.classList?.contains('mm-fly')) window.__fly++; }).observe(document.body, { childList: true }), 1)" }];
for (let i = 0; i < 40; i++) steps.push({ eval: "document.querySelector('.mm-grid .pcard.usable')?.click(), 1" }, { wait: 1500 });
steps.push({ eval: 'window.__fly', as: 'fly' }, { eval: "[...document.querySelectorAll('.mm-score')].map((e) => e.textContent).join(' ')", as: 'scores' });
put('memory', steps);
