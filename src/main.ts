import { readFrameConfig } from './storage/frame-config.ts';
import { start, startWithFrame } from './ui/app.ts';

const root = document.getElementById('app');
if (!root) throw new Error('#app missing');
// The itch.io build keeps its save and cloud save in a frame on GitHub Pages (docs/design.md §11).
const frame = readFrameConfig(import.meta.env);
if (frame) void startWithFrame(root, frame);
else start(root);
