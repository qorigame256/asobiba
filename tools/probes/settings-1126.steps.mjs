// play-shot.mjs 用の操作の JSON を書き出す（2026-11-26 の48回目の案の3つの詳細設定の確認）。
// 使い方: node tools/probes/settings-1126.steps.mjs <書き出すフォルダ> → そのフォルダに kaburi.json・daruma.json・kingyo.json ができる。
//   node tools/play-shot.mjs kaburi --rule carry=true --cpus 3 --steps <フォルダ>/kaburi.json --out <絵のフォルダ> --timeout 90
//   node tools/play-shot.mjs daruma --rule oni=human --cpus 2 --steps <フォルダ>/daruma.json --out <絵のフォルダ> --timeout 90
//   node tools/play-shot.mjs kingyo --rule share=true --cpus 3 --steps <フォルダ>/kingyo.json --out <絵のフォルダ>
import fs from 'node:fs';
import path from 'node:path';
const dir = process.argv[2];
const put = (name, steps) => fs.writeFileSync(path.join(dir, name + '.json'), JSON.stringify(steps));

// かぶったら0点（持ち越す）: 毎回5を選んで決める（CPU も大きい数を選びやすいので5がかぶりやすい）。選ぶ前に、数字のボタンに出ている場の点を読む
const pick5 = "new Promise((res) => { const t0 = Date.now(); const f = () => { const b = document.querySelector('.kb-num[data-v=\"5\"]:not([disabled])'); if (b) { const pots = [...document.querySelectorAll('.kb-pot')].map((e) => e.parentElement.dataset.v + e.textContent); b.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true })); document.querySelector('.kb-go').dispatchEvent(new PointerEvent('pointerdown', { bubbles: true })); res(pots.join(' ') || 'なし'); } else if (Date.now() - t0 > 9000) res('timeout'); else setTimeout(f, 200); }; f(); })";
const reveal = "[...document.querySelectorAll('.kb-row')].map((r) => r.innerText.replace(/\\s+/g, ' ')).join(' / ')";
const kaburi = [{ wait: 2500 }];
for (let r = 1; r <= 4; r++) kaburi.push({ eval: pick5, as: 'pots' + r }, { shot: 'open' + r }, { wait: 8000 }, { eval: reveal, as: 'reveal' + r }, { shot: 'shown' + r });
put('kaburi', kaburi);

// だるまさんがころんだ（人が交代で）: 走る人の回を1枚撮り、自分が鬼の回が来るまで待って（1回 9秒まで × 6）、鬼の画面を撮ってから「ふりむく」を押す
const notes = "document.querySelector('#board .cc-log')?.textContent + ' | ' + [...document.querySelectorAll('.dr-lane')].map((l) => l.querySelector('.dr-name').textContent + (l.classList.contains('oni') ? '[鬼]' : '')).join(' ')";
const myTurn = "new Promise((res) => { const t0 = Date.now(); const f = () => { const btn = document.querySelector('.dr-btn'); if (btn && btn.textContent.includes('ふりむく') && !btn.disabled) res('鬼の番: ' + document.querySelector('.dr-who')?.textContent); else if (Date.now() - t0 > 9000) res('まだ'); else setTimeout(f, 150); }; f(); })";
const daruma = [{ wait: 4000 }, { eval: notes, as: 'runner' }, { shot: 'runner' }];
for (let k = 1; k <= 6; k++) daruma.push({ eval: myTurn, as: 'wait' + k });
daruma.push({ wait: 1200 }, { eval: notes, as: 'oni' }, { shot: 'oni' },
  { eval: "document.querySelector('.dr-btn').dispatchEvent(new PointerEvent('pointerdown', { bubbles: true })), 1" }, { wait: 700 },
  { eval: notes, as: 'look' }, { shot: 'look' }, { wait: 3500 }, { eval: notes, as: 'next' }, { shot: 'next' });
put('daruma', daruma);

// 金魚すくい（みんなで1つ）: CPU がすくった所の色の輪を、0.25秒おきに撮って探す
const kingyo = [{ wait: 3500 }];
for (let i = 1; i <= 16; i++) kingyo.push({ shot: 'k' + String(i).padStart(2, '0'), selector: '.kg-canvas' }, { wait: 250 });
kingyo.push({ eval: "document.querySelector('#board .cc-log')?.textContent", as: 'note' });
put('kingyo', kingyo);
