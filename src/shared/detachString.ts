/**
 * A copy of `value` that does not keep the string it was cut from alive.
 *
 * V8 represents a substring of 13 or more characters (from `slice`,
 * `substring`, `split`, `trim`, a regex match...) as a SLICE: a view holding a
 * pointer to the whole parent string. A title cut from a note's first line is
 * therefore, in memory, the entire note. Stored anywhere long-lived -- React
 * state, a summary object, anything a render scope captures -- it retains one
 * full copy of the document per distinct title, and the title of a note
 * being typed on its first line changes on every keystroke (measured: +85MB
 * over 40 keystrokes on a 2MB note).
 *
 * Joining the characters builds a new flat string, so the result holds its
 * own characters and nothing else. Only worth doing for short strings derived
 * from a document and then kept; a copy of the document itself is just a
 * second document.
 */
export function detachString(value: string): string {
  return Array.from(value).join('')
}
