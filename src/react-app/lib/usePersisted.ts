import { useState } from "react";

/**
 * A yes/no the person set once and expects to find the same way next time —
 * whether a sidebar is open, whether a toolbar is tucked away. Kept in
 * localStorage under a `notesanity:` key, read defensively, because storage
 * can be absent or refuse in a private window and a preference isn't worth
 * failing a page over.
 */
export function usePersistedBool(key: string, initial: boolean): [boolean, (v: boolean) => void] {
  const [value, setValue] = useState<boolean>(() => {
    try {
      const saved = localStorage.getItem(key);
      if (saved !== null) return saved === "1";
    } catch { /* no storage here */ }
    return initial;
  });
  const set = (v: boolean) => {
    setValue(v);
    try { localStorage.setItem(key, v ? "1" : "0"); } catch { /* no storage here */ }
  };
  return [value, set];
}
