// Node test for From Claude cards (js/cards.js): which steps show as ticked once Claude rewrites a card (#150).
//   node test/web/cards.test.js
'use strict';
const fs = require('fs'), path = require('path'), vm = require('vm'), assert = require('assert');
const ctx = { console, Object, JSON, Math, Number, String, Array, Set, Date, RegExp, isFinite, setInterval() {},
  location: { protocol: 'file:' }, document: { addEventListener() {}, querySelector: () => null }, localStorage: { getItem: () => null, setItem() {} } };
ctx.window = ctx;
vm.createContext(ctx);
ctx.CC = { V: {}, api: { esc: String, arr: (x) => (Array.isArray(x) ? x : []), uiIcon: () => 'x' } };
vm.runInContext(fs.readFileSync(path.join(__dirname, '../../ClaudeCompanion/web/js/cards.js'), 'utf8'), ctx);
const T = ctx.CC.cards.ticked;
let failed = 0;
const test = (name, fn) => { try { fn(); console.log('ok   ' + name); } catch (e) { failed++; console.log('FAIL ' + name + '\n     ' + e.message); } };
const list = (s) => JSON.stringify([...s].sort());

const card = { id: 'c', title: 'x', updated: '2026-11-25T09:00:00Z', steps: ['Buy reagents', 'Run Scholomance', 'Hand in'] };
test('ticks saved with their text follow the step when Claude moves it', () => {
  const moved = Object.assign({}, card, { updated: '2026-11-25T10:00:00Z', steps: ['Hand in', 'Buy reagents', 'Run Scholomance'] });
  assert.strictEqual(list(T(moved, { steps: [0, 2], stepTexts: ['Buy reagents', 'Hand in'], at: '2026-11-25T09:30:00Z' })), '[0,1]');
});
test('a step Claude rewrote loses its tick', () => {
  const re = Object.assign({}, card, { steps: ['Buy reagents', 'Run Stratholme', 'Hand in'] });
  assert.strictEqual(list(T(re, { stepTexts: ['Run Scholomance'], at: '2026-11-25T09:30:00Z' })), '[]');
});
test('older saves (positions only) count while the card is no newer than the ticks', () => {
  assert.strictEqual(list(T(card, { steps: [0, 1], at: '2026-11-25T09:30:00Z' })), '[0,1]');
  const newer = Object.assign({}, card, { updated: '2026-11-25T11:50:00Z' });
  assert.strictEqual(list(T(newer, { steps: [0, 1, 2, 3], at: '2026-11-25T04:46:51Z' })), '[]', 'the account case: ticks from 04:46 on a card rewritten since');
});
console.log(failed ? `\n${failed} failed` : '\nall passed');
process.exit(failed ? 1 : 0);
