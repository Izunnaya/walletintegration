import { useEffect, useState } from "react";

// Holds a value still until it stops changing.
//
// A search box wired straight to a query key sends one request per keystroke. The admin
// endpoints allow thirty requests a minute, so typing an email address is most of that
// budget on its own, and the request that matters arrives as a 429. This is what sits
// between the input and the key.
export function useDebounced<T>(value: T, delayMs = 300): T {
  const [settled, setSettled] = useState(value);

  useEffect(() => {
    const timer = setTimeout(() => setSettled(value), delayMs);
    return () => clearTimeout(timer);
  }, [value, delayMs]);

  return settled;
}
