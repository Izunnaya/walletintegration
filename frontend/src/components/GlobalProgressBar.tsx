import { useIsFetching, useIsMutating } from "@tanstack/react-query";
import { AnimatePresence, motion } from "framer-motion";

// A thin bar across the top whenever anything is in flight.
//
// The skeletons cover a screen that has no data yet. They do not cover the other half: a
// refetch after a transfer, or a background revalidation, where the screen already has
// content and showing skeletons would throw away what the user is reading. Those requests
// were previously invisible, so on a slow connection the app looked like it had ignored you.
//
// It needs no wiring. TanStack Query already knows how many queries and mutations are
// running, so this subscribes to those counts rather than threading a loading flag through
// the app - which is the same reason the data lives in the cache at all.
const GlobalProgressBar = () => {
  const fetching = useIsFetching();
  const mutating = useIsMutating();
  const busy = fetching + mutating > 0;

  return (
    <AnimatePresence>
      {busy && (
        <motion.div
          // Not aria-live. This is ambient, and a screen reader announcing "loading" on
          // every background refetch would be noise; the screens announce their own busy
          // state with aria-busy where it matters.
          aria-hidden="true"
          className="fixed inset-x-0 top-0 z-50 h-0.5 overflow-hidden bg-transparent"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.15 }}
        >
          {/* An indeterminate bar, because a request has no measurable progress. It sweeps
              rather than filling, so it cannot imply a percentage it does not know. */}
          <motion.div
            className="h-full w-2/5 bg-foreground/70"
            initial={{ x: "-100%" }}
            animate={{ x: "350%" }}
            transition={{ duration: 1.1, repeat: Infinity, ease: "easeInOut" }}
          />
        </motion.div>
      )}
    </AnimatePresence>
  );
};

export default GlobalProgressBar;
