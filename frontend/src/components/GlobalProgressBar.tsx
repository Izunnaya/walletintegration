import { useIsFetching, useIsMutating } from "@tanstack/react-query";
import { AnimatePresence, motion } from "framer-motion";
const GlobalProgressBar = () => {
  const fetching = useIsFetching();
  const mutating = useIsMutating();
  const busy = fetching + mutating > 0;

  return (
    <AnimatePresence>
      {busy && (
        <motion.div
          aria-hidden="true"
          className="fixed inset-x-0 top-0 z-50 h-0.5 overflow-hidden bg-transparent"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.15 }}
        >
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
