/// <reference types="node" />
// Films the store-page gameplay video (marketing/trailer-1080p.mp4, about 30 s,
// git-ignored) and the looping GIF of auto-battle and a drop
// (marketing/autobattle.gif) from the production build and the test saves.
// Each scene is fast-forwarded on a paused clock to its moment, then played in
// real time while Chrome streams its frames; ffmpeg cuts them together.
//
//   npm run build && npm run marketing:trailer   (needs ffmpeg on the PATH)

import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Page } from 'playwright';
import { load, openStage, playUntil, type Stage } from './stage.ts';

const VIDEO = 'marketing/trailer-1080p.mp4';
const GIF = 'marketing/autobattle.gif';
const FPS = 30;
/** Seconds of fade at each end of a scene. */
const FADE = 0.4;

interface Scene {
  save: string;
  seconds: number;
  /** Seconds of play to fast-forward before filming starts. */
  skip?: (stage: Stage) => Promise<number>;
  /** Runs while filming (clicks), in real time. */
  act?: (page: Page) => Promise<void>;
}

const wait = (ms: number) => new Promise((done) => setTimeout(done, ms));

/** Seconds of play until the Immortal item drops, found on a paused clock. */
async function untilImmortal(stage: Stage): Promise<number> {
  const page = await load(stage, 'immortal-drop');
  const seconds = await playUntil(page, '.drops li.grade-immortal', 60);
  await page.context().close();
  return seconds;
}

const SCENES: Scene[] = [
  { save: 'early-floor', seconds: 8 },
  // Starts a few seconds before the drop lands.
  { save: 'immortal-drop', seconds: 9, skip: async (stage) => (await untilImmortal(stage)) - 4 },
  { save: 'tribulation', seconds: 8 },
  {
    save: 'inventory',
    seconds: 7,
    act: async (page) => {
      for (const n of [0, 1, 9]) {
        await wait(1500);
        await page.locator('.bag .cell').nth(n).click();
      }
    },
  },
];

/** Films one scene into `dir` as an MP4 clip with fades, returning its path. */
async function film(stage: Stage, scene: Scene, dir: string, n: number): Promise<string> {
  const skip = (await scene.skip?.(stage)) ?? 0;
  const page = await load(stage, scene.save);
  await page.mouse.move(0, 0);
  if (skip > 0) await page.clock.runFor(Math.round(skip * 1000));
  const frames: { file: string; at: number }[] = [];
  const cdp = await page.context().newCDPSession(page);
  cdp.on('Page.screencastFrame', ({ data, metadata, sessionId }) => {
    const file = join(dir, `s${n}-${String(frames.length).padStart(5, '0')}.jpg`);
    writeFileSync(file, Buffer.from(data, 'base64'));
    frames.push({ file, at: metadata.timestamp ?? 0 });
    void cdp.send('Page.screencastFrameAck', { sessionId });
  });
  await page.clock.resume();
  await cdp.send('Page.startScreencast', {
    format: 'jpeg',
    quality: 95,
    maxWidth: 1920,
    maxHeight: 1080,
  });
  const start = Date.now();
  await scene.act?.(page);
  await wait(scene.seconds * 1000 - (Date.now() - start));
  await cdp.send('Page.stopScreencast');
  await page.context().close();
  if (frames.length < 2) throw new Error(`scene ${n}: no frames`);

  // Each frame shows until the next one arrived; the last for one frame time.
  const list = frames.map((f, i) => {
    const next = frames[i + 1]?.at ?? f.at + 1 / FPS;
    return `file '${f.file}'\nduration ${(next - f.at).toFixed(4)}`;
  });
  const concat = join(dir, `s${n}.txt`);
  writeFileSync(concat, `${list.join('\n')}\nfile '${frames.at(-1)?.file}'\n`);
  const length = scene.seconds;
  const clip = join(dir, `s${n}.mp4`);
  ffmpeg([
    ['-f', 'concat', '-safe', '0', '-i', concat],
    [
      '-vf',
      `fps=${FPS},scale=1920:1080:flags=lanczos,trim=duration=${length},` +
        `fade=in:st=0:d=${FADE},fade=out:st=${length - FADE}:d=${FADE},format=yuv420p`,
    ],
    ['-c:v', 'libx264', '-preset', 'slow', '-crf', '18', '-an', clip],
  ]);
  return clip;
}

function ffmpeg(args: string[][]): void {
  execFileSync('ffmpeg', ['-y', '-loglevel', 'error', ...args.flat()], { stdio: 'inherit' });
}

const stage = await openStage();
const dir = mkdtempSync(join(tmpdir(), 'oi-trailer-'));
try {
  const clips: string[] = [];
  for (const [n, scene] of SCENES.entries()) clips.push(await film(stage, scene, dir, n));
  const all = join(dir, 'clips.txt');
  writeFileSync(all, clips.map((c) => `file '${c}'`).join('\n'));
  mkdirSync('marketing', { recursive: true });
  ffmpeg([
    ['-f', 'concat', '-safe', '0', '-i', all],
    ['-c', 'copy', '-movflags', '+faststart', '-map_metadata', '-1', VIDEO],
  ]);
  console.log(VIDEO);

  // The GIF: the drop scene's fight and drop list, cropped and looped.
  const crop = 'crop=1440:316:240:85,scale=960:-1:flags=lanczos';
  const palette = join(dir, 'palette.png');
  const drop = clips[1] as string;
  const window = ['-ss', '1.5', '-t', '6'];
  ffmpeg([window, ['-i', drop, '-vf', `fps=12,${crop},palettegen=stats_mode=diff`, palette]]);
  ffmpeg([
    window,
    ['-i', drop, '-i', palette],
    ['-lavfi', `fps=12,${crop}[x];[x][1:v]paletteuse=dither=bayer:bayer_scale=4`],
    ['-loop', '0', GIF],
  ]);
  console.log(GIF);
} finally {
  rmSync(dir, { recursive: true, force: true });
  await stage.close();
}
