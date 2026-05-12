/**
 * Module-level beforeinstallprompt store.
 * Captures the event before React mounts so no prompt is ever missed.
 * main.jsx registers the listener; components call getPrompt() / subscribe().
 */

let _prompt = null
const _listeners = new Set()

export function _setPrompt(evt) {
  _prompt = evt
  _listeners.forEach((fn) => fn(evt))
}

export function getPrompt() {
  return _prompt
}

export function clearPrompt() {
  _prompt = null
}

export function subscribe(fn) {
  _listeners.add(fn)
}

export function unsubscribe(fn) {
  _listeners.delete(fn)
}
