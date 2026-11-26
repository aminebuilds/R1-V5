/**
 * @file As-you-type search suggestions, attachable to any text input:
 * instant local matches (portfolio sites + known landmarks — zero network
 * cost, via {@link module:portfolio/fuzzySearchEngine.searchLocalCandidates})
 * layered with debounced Google Places Autocomplete (session-token priced —
 * see {@link module:portfolio/autocompleteClient}). Local results render
 * immediately; Google's arrive a beat later and are appended, never
 * replacing what is already shown.
 * @module portfolio/searchSuggestions
 */

import { searchLocalCandidates } from './fuzzySearchEngine.js';
import { createSessionToken, fetchAutocomplete, fetchPlaceDetails } from './autocompleteClient.js';

const DEBOUNCE_MS = 250;
const MIN_QUERY_LEN = 2;
const MAX_LOCAL = 5;
const MAX_GOOGLE = 6;

/**
 * @param {HTMLInputElement} inputEl
 * @param {{
 *   getBias: () => {biasLat?: number, biasLon?: number},
 *   onSelect: (result: {name: string, lat?: number, lon?: number, address?: string|null}) => void,
 * }} opts
 * @returns {() => void} Teardown — removes listeners and the dropdown element.
 */
export function attachSearchSuggestions(inputEl, { getBias, onSelect }) {
  if (!inputEl) return () => {};

  const dropdown = document.createElement('div');
  dropdown.className = 'search-suggest-dropdown';
  dropdown.setAttribute('role', 'listbox');
  dropdown.hidden = true;
  document.body.appendChild(dropdown);

  let items = [];
  let activeIndex = -1;
  let debounceTimer = null;
  // One token per search burst — reused across every keystroke's Autocomplete
  // call, cleared (forcing a fresh one) the moment a Place Details call
  // closes the session or the box empties. Never reused across two searches.
  let sessionToken = null;
  let abortController = null;

  function positionDropdown() {
    const rect = inputEl.getBoundingClientRect();
    dropdown.style.left = `${rect.left}px`;
    dropdown.style.top = `${rect.bottom + 4}px`;
    dropdown.style.width = `${rect.width}px`;
  }

  function render() {
    dropdown.replaceChildren();
    if (items.length === 0) {
      dropdown.hidden = true;
      return;
    }
    positionDropdown();
    dropdown.hidden = false;
    items.forEach((item, i) => {
      const row = document.createElement('div');
      row.className = `search-suggest-item${i === activeIndex ? ' is-active' : ''}`;
      row.setAttribute('role', 'option');
      const main = document.createElement('div');
      main.className = 'search-suggest-main';
      main.textContent = item.label;
      const sub = document.createElement('div');
      sub.className = 'search-suggest-sub';
      const sourceLabel = item.source === 'local' ? 'Saved' : 'Google';
      sub.textContent = [item.sublabel, sourceLabel].filter(Boolean).join(' · ');
      row.append(main, sub);
      // mousedown (not click) fires before the input's blur, so the row is
      // still in the DOM — and this handler still runs — when selected.
      row.addEventListener('mousedown', (event) => {
        event.preventDefault();
        selectItem(item);
      });
      dropdown.appendChild(row);
    });
  }

  function close() {
    items = [];
    activeIndex = -1;
    dropdown.hidden = true;
    if (abortController) {
      abortController.abort();
      abortController = null;
    }
  }

  async function selectItem(item) {
    if (item.source === 'google') {
      const token = sessionToken;
      sessionToken = null; // closes the session; the next search starts fresh
      close();
      const place = await fetchPlaceDetails(item.data.placeId, token);
      if (!place) return;
      const name = place.name || item.label;
      inputEl.value = name;
      onSelect({ name, lat: place.latitude, lon: place.longitude, address: place.address });
      return;
    }
    close();
    inputEl.value = item.label;
    onSelect({ name: item.label, lat: item.data.lat, lon: item.data.lon, address: item.data.address });
  }

  async function runSearch(query) {
    const local = searchLocalCandidates(query).slice(0, MAX_LOCAL).map((c) => ({
      source: 'local',
      label: c.name,
      sublabel: c.address,
      data: c,
    }));
    items = local;
    activeIndex = -1;
    render();

    if (!sessionToken) sessionToken = createSessionToken();
    const { biasLat, biasLon } = getBias?.() || {};
    if (abortController) abortController.abort();
    abortController = new AbortController();

    let suggestions;
    try {
      suggestions = await fetchAutocomplete(query, sessionToken, {
        biasLat,
        biasLon,
        signal: abortController.signal,
      });
    } catch {
      return; // superseded by a newer keystroke, which owns the next render
    }

    // The input may have changed again while the request was in flight —
    // a stale response landing late must not show suggestions for text the
    // box no longer contains.
    if (inputEl.value.trim() !== query) return;
    const google = suggestions.slice(0, MAX_GOOGLE).map((s) => ({
      source: 'google',
      label: s.mainText || s.text,
      sublabel: s.secondaryText,
      data: s,
    }));
    items = [...local, ...google];
    render();
  }

  function onInput() {
    const query = inputEl.value.trim();
    if (debounceTimer) clearTimeout(debounceTimer);
    if (query.length < MIN_QUERY_LEN) {
      close();
      sessionToken = null;
      return;
    }
    debounceTimer = setTimeout(() => runSearch(query), DEBOUNCE_MS);
  }

  // Callers typically also have a plain "Enter submits the box" listener on
  // the same input. stopImmediatePropagation (not just preventDefault) is
  // required to keep that from ALSO firing once a suggestion is chosen here
  // — preventDefault alone stops the browser's default action, not a
  // sibling listener on the same element (same lesson as this app's ESC
  // arbitration: see docs/CURRENT-STATE.md). Call attachSearchSuggestions
  // BEFORE registering that plain handler so this one runs first.
  function onKeydown(event) {
    if (dropdown.hidden || items.length === 0) return;
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      activeIndex = (activeIndex + 1) % items.length;
      render();
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      activeIndex = (activeIndex - 1 + items.length) % items.length;
      render();
    } else if (event.key === 'Enter' && activeIndex >= 0) {
      event.preventDefault();
      event.stopImmediatePropagation();
      selectItem(items[activeIndex]);
    } else if (event.key === 'Escape') {
      event.stopImmediatePropagation();
      close();
    }
  }

  // A selection's mousedown (above) runs before this fires and already
  // closed the dropdown; anything still open here is a genuine blur-away.
  function onBlur() {
    close();
  }

  const onReposition = () => {
    if (!dropdown.hidden) positionDropdown();
  };

  inputEl.addEventListener('input', onInput);
  inputEl.addEventListener('keydown', onKeydown);
  inputEl.addEventListener('blur', onBlur);
  window.addEventListener('scroll', onReposition, true);
  window.addEventListener('resize', onReposition);

  return function teardown() {
    if (debounceTimer) clearTimeout(debounceTimer);
    if (abortController) abortController.abort();
    inputEl.removeEventListener('input', onInput);
    inputEl.removeEventListener('keydown', onKeydown);
    inputEl.removeEventListener('blur', onBlur);
    window.removeEventListener('scroll', onReposition, true);
    window.removeEventListener('resize', onReposition);
    dropdown.remove();
  };
}
