import test from 'node:test';
import assert from 'node:assert/strict';

import {
  CHAT_HISTORY_STORAGE_KEY,
  MAX_HISTORY_MESSAGES,
  addFact,
  clearHistory,
  loadFacts,
  loadHistory,
  removeFact,
  saveHistory,
} from './chatMemory.js';

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

test('loadHistory returns [] when nothing is stored', () => {
  withStorage(fakeStorage(), () => {
    assert.deepEqual(loadHistory(), []);
  });
});

test('saveHistory then loadHistory round-trips', () => {
  withStorage(fakeStorage(), () => {
    const messages = [{ role: 'user', content: 'hi' }];
    assert.equal(saveHistory(messages), true);
    assert.deepEqual(loadHistory(), messages);
  });
});

test('loadHistory tolerates corrupt JSON', () => {
  const storage = fakeStorage();
  storage.setItem(CHAT_HISTORY_STORAGE_KEY, 'not json');
  withStorage(storage, () => {
    assert.deepEqual(loadHistory(), []);
  });
});

test('saveHistory trims to the oldest-dropped cap', () => {
  withStorage(fakeStorage(), () => {
    const messages = Array.from({ length: MAX_HISTORY_MESSAGES + 10 }, (_, i) => ({ role: 'user', content: `m${i}` }));
    saveHistory(messages);
    const stored = loadHistory();
    assert.equal(stored.length, MAX_HISTORY_MESSAGES);
    assert.equal(stored[0].content, 'm10');
    assert.equal(stored[stored.length - 1].content, `m${MAX_HISTORY_MESSAGES + 9}`);
  });
});

test('clearHistory empties the transcript only', () => {
  withStorage(fakeStorage(), () => {
    saveHistory([{ role: 'user', content: 'hi' }]);
    addFact('runs 400 Kwik Fill sites');
    clearHistory();
    assert.deepEqual(loadHistory(), []);
    assert.deepEqual(loadFacts(), ['runs 400 Kwik Fill sites']);
  });
});

test('addFact de-duplicates case-insensitively', () => {
  withStorage(fakeStorage(), () => {
    addFact('Runs 400 Kwik Fill sites');
    const after = addFact('runs 400 kwik fill sites');
    assert.deepEqual(after, ['Runs 400 Kwik Fill sites']);
  });
});

test('addFact ignores blank input', () => {
  withStorage(fakeStorage(), () => {
    assert.deepEqual(addFact('   '), []);
    assert.deepEqual(loadFacts(), []);
  });
});

test('removeFact matches by exact text, case-insensitively', () => {
  withStorage(fakeStorage(), () => {
    addFact('fiscal year starts in July');
    addFact('runs 400 Kwik Fill sites');
    const after = removeFact('Fiscal Year Starts In July');
    assert.deepEqual(after, ['runs 400 Kwik Fill sites']);
  });
});

test('removeFact falls back to a substring match', () => {
  withStorage(fakeStorage(), () => {
    addFact('runs 400 Kwik Fill sites in Pennsylvania');
    const after = removeFact('kwik fill');
    assert.deepEqual(after, []);
  });
});

test('removeFact by numeric index', () => {
  withStorage(fakeStorage(), () => {
    addFact('fact one');
    addFact('fact two');
    const after = removeFact(0);
    assert.deepEqual(after, ['fact two']);
  });
});

test('removeFact is a no-op when nothing matches', () => {
  withStorage(fakeStorage(), () => {
    addFact('fact one');
    const after = removeFact('nonexistent');
    assert.deepEqual(after, ['fact one']);
  });
});
