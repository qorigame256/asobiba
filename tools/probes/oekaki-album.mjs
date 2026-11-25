// play-two.mjs 用: お絵描き当てを2人で最後まで進め、結果の画面の「絵のふりかえり」を撮る。
// 使い方: node tools/play-two.mjs oekaki --script tools/probes/oekaki-album.mjs --out <フォルダ>
export default async function ({ host, guests, shot, sleep }) {
  const pages = [host, guests[0]];
  for (const p of pages) p.on('dialog', (d) => d.accept().catch(() => {})); // 台本の側でも受けているときがある
  await sleep(3000);
  for (let turn = 0; turn < 2; turn++) {
    let drawer = null;
    for (let i = 0; i < 40 && !drawer; i++) {
      for (const p of pages) if (await p.$('.oe-canvas.drawing')) drawer = p;
      if (!drawer) await sleep(250);
    }
    if (!drawer) throw new Error(`描く人が見つからない（${turn}回目）`); // return にすると play-two.mjs が成功と数える（2026-11-25 の Codex の点検）
    const box = await (await drawer.$('.oe-canvas')).boundingBox();
    const at = (x, y) => [box.x + box.width * x, box.y + box.height * y];
    for (const line of [[[0.2, 0.2 + turn * 0.2], [0.8, 0.3], [0.5, 0.8]], [[0.3, 0.6], [0.7, 0.6]]]) {
      await drawer.mouse.move(...at(...line[0]));
      await drawer.mouse.down();
      for (const pt of line.slice(1)) await drawer.mouse.move(...at(...pt), { steps: 8 });
      await drawer.mouse.up();
      await sleep(700);
    }
    await drawer.click('text=あきらめる');
    await sleep(6500); // 答え合わせ5秒
  }
  await sleep(600);
  await shot(host, 'album-mid', { full: true });
  await sleep(4000);
  await shot(host, 'album-end', { full: true });
  const n = await host.evaluate(() => document.querySelectorAll('.oe-pic canvas').length);
  if (n !== 2) throw new Error(`ふりかえりの絵が2枚でない（${n}枚）`);
  return { pics: n, text: await host.evaluate(() => document.querySelector('.oe-album')?.innerText) };
}
