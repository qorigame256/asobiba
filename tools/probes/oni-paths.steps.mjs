// play-shot.mjs 用の操作の JSON を書き出す: 見えない鬼ごっこを進め、決着のあとの「通った道」を撮る。
// 使い方: node tools/probes/oni-paths.steps.mjs <書き出す.json> → node tools/play-shot.mjs oni --steps <書き出す.json> --out <フォルダ> --timeout 170
// 何手目で決着するかは運なので、3手ごとに絵（p3.png・p6.png …）と道の丸の数（dots3 …）を残す。決着して20秒たつと待合室へ戻るので、丸の数が増えた回の絵を見る。
import fs from 'node:fs';
const steps = [{ wait: 2500 }];
for (let i = 1; i <= 16; i++) {
  steps.push({ eval: "(() => { const c = [...document.querySelectorAll('.on-cell.can')]; c[c.length >> 1]?.click(); return c.length; })()" });
  steps.push({ eval: "document.querySelector('.on-go')?.click(), 1" });
  steps.push({ wait: 1900 });
  if (i % 3 === 0) steps.push({ eval: "document.querySelectorAll('.on-tr i').length + (document.querySelector('.on-again:not([hidden])') ? ' again' : '')", as: `dots${i}` }, { shot: `p${i}` });
}
fs.writeFileSync(process.argv[2], JSON.stringify(steps));
