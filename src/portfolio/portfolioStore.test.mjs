import test from 'node:test';
import assert from 'node:assert/strict';

import {
  PORTFOLIO_STORAGE_KEY,
  addSites,
  clearPortfolio,
  loadPortfolio,
  savePortfolio,
  subscribePortfolio,
} from './portfolioStore.js';

function fakeStorage() {
  const map = new Map();
  return {
    getItem: (key) => (map.has(key) ? map.get(key) : null),
    setItem: (key, value) => { map.set(key, String(value)); },
    removeItem: (key) => { map.delete(key); },
  };
}

function withStorage(storage, fn) {
  const original = globalThis.localStorage;
  globalThis.localStorage = storage;
  try {
    return fn();
  } finally {
    if (original === undefined) delete globalThis.localStorage;
    else globalThis.localStorage = original;
  }
}

test('loadPortfolio returns [] when nothing is stored', () => {
  withStorage(fakeStorage(), () => {
    assert.deepEqual(loadPortfolio(), []);
  });
});

test('savePortfolio then loadPortfolio round-trips', () => {
  withStorage(fakeStorage(), () => {
    const sites = [{ id: 'site:a', name: 'Store A' }];
    assert.equal(savePortfolio(sites), true);
    assert.deepEqual(loadPortfolio(), sites);
  });
});

test('loadPortfolio tolerates corrupt JSON', () => {
  const storage = fakeStorage();
  storage.setItem(PORTFOLIO_STORAGE_KEY, 'not json');
  withStorage(storage, () => {
    assert.deepEqual(loadPortfolio(), []);
  });
});

test('addSites de-duplicates by id, newer entries win', () => {
  const existing = [{ id: 'site:a', name: 'Old Name' }, { id: 'site:b', name: 'Store B' }];
  const incoming = [{ id: 'site:a', name: 'New Name' }];
  const merged = addSites(existing, incoming);
  assert.equal(merged.length, 2);
  assert.equal(merged.find((s) => s.id === 'site:a').name, 'New Name');
});

test('clearPortfolio empties storage and notifies subscribers with []', () => {
  const storage = fakeStorage();
  withStorage(storage, () => {
    savePortfolio([{ id: 'site:a' }]);
    let received = null;
    const unsubscribe = subscribePortfolio((sites) => { received = sites; });
    clearPortfolio();
    unsubscribe();
    assert.deepEqual(received, []);
    assert.deepEqual(loadPortfolio(), []);
  });
});

test('subscribePortfolio notifies on save and can unsubscribe', () => {
  withStorage(fakeStorage(), () => {
    const calls = [];
    const unsubscribe = subscribePortfolio((sites) => calls.push(sites));
    savePortfolio([{ id: 'site:a' }]);
    unsubscribe();
    savePortfolio([{ id: 'site:b' }]);
    assert.equal(calls.length, 1);
    assert.equal(calls[0][0].id, 'site:a');
  });
});

test('a throwing listener does not break other listeners or the save', () => {
  withStorage(fakeStorage(), () => {
    let secondCalled = false;
    const unsub1 = subscribePortfolio(() => { throw new Error('boom'); });
    const unsub2 = subscribePortfolio(() => { secondCalled = true; });
    assert.doesNotThrow(() => savePortfolio([{ id: 'site:a' }]));
    assert.equal(secondCalled, true);
    unsub1();
    unsub2();
  });
});
