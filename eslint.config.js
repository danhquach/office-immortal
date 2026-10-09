import js from '@eslint/js';
import prettier from 'eslint-config-prettier';
import globals from 'globals';
import tseslint from 'typescript-eslint';

// Every use of Math.random is banned. Runs must be reproducible from a seed, so
// the only randomness source is src/core/rng.ts.
const noMathRandom = {
  'no-restricted-properties': [
    'error',
    {
      object: 'Math',
      property: 'random',
      message: 'Use the seeded RNG from src/core/rng.ts instead of Math.random.',
    },
  ],
};

// No HTML sinks anywhere: all text reaches the page through textContent, so
// item names, log lines and save data can never inject markup.
const HTML_SINK = 'Render text with textContent / DOM nodes, never as HTML.';
const noHtmlSinks = {
  'no-restricted-syntax': [
    'error',
    {
      selector: 'AssignmentExpression > MemberExpression[property.name=/^(innerHTML|outerHTML)$/]',
      message: HTML_SINK,
    },
    {
      selector: 'CallExpression[callee.property.name=/^(insertAdjacentHTML|write|writeln)$/]',
      message: HTML_SINK,
    },
    { selector: "CallExpression[callee.name='eval']", message: 'No eval.' },
  ],
};

// src/core/** is the pure simulation: it must run under Vitest and in offline
// catch-up with no page present. Dependencies point inward: the UI may import
// core, never the reverse.
const CORE_MESSAGE =
  'src/core must stay pure: no DOM, no storage, no UI imports. Pass data in from the UI layer.';
const pureCore = {
  'no-restricted-globals': [
    'error',
    ...['window', 'document', 'localStorage', 'sessionStorage', 'navigator', 'fetch'].map(
      (name) => ({ name, message: CORE_MESSAGE }),
    ),
  ],
  'no-restricted-imports': [
    'error',
    { patterns: [{ group: ['**/ui/**', '**/storage/**'], message: CORE_MESSAGE }] },
  ],
};

export default tseslint.config(
  { ignores: ['dist/', 'coverage/', 'node_modules/', '.claude/'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['**/*.{js,mjs,ts}'],
    languageOptions: { globals: { ...globals.browser, ...globals.node } },
    rules: { ...noMathRandom, ...noHtmlSinks },
  },
  {
    files: ['src/core/rng.ts'],
    rules: { 'no-restricted-properties': 'off' },
  },
  {
    files: ['src/core/**/*.ts'],
    rules: pureCore,
  },
  prettier,
);
