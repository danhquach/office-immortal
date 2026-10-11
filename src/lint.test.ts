import { ESLint } from 'eslint';
import { describe, expect, it } from 'vitest';

// The ESLint config is the guard that keeps markup out of the page; push each
// way of writing an HTML or code sink through it and expect a refusal.
const eslint = new ESLint();

async function errors(code: string): Promise<number> {
  const [result] = await eslint.lintText(code, { filePath: 'src/ui/sink-probe.ts' });
  return (result?.messages ?? []).filter(
    (m) =>
      m.ruleId === 'no-restricted-syntax' ||
      m.ruleId === 'no-implied-eval' ||
      m.ruleId === 'no-new-func',
  ).length;
}

describe('HTML and code sinks', () => {
  it.each([
    "document.body.innerHTML = '<img src=x onerror=alert(1)>';",
    "document.body.outerHTML = '<b>x</b>';",
    "document.body['innerHTML'] = '<b>x</b>';",
    "document.body.insertAdjacentHTML('beforeend', '<b>x</b>');",
    "document.write('<b>x</b>');",
    "document.body.setHTMLUnsafe('<b>x</b>');",
    "new DOMParser().parseFromString('<b>x</b>', 'text/html');",
    "document.createRange().createContextualFragment('<b>x</b>');",
    "eval('alert(1)');",
    "window.eval('alert(1)');",
    "setTimeout('alert(1)', 0);",
    "new Function('alert(1)')();",
  ])('refuses %s', async (code) => {
    expect(await errors(code)).toBeGreaterThan(0);
  });

  it('allows text through textContent', async () => {
    expect(await errors("document.body.textContent = '<b>x</b>';")).toBe(0);
  });
});
