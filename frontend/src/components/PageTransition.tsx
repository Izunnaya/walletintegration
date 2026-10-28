import { motion } from "framer-motion";
import { easeOut, pageVariants } from "@/lib/motion";

// Wraps a screen so it fades in, and fades out when the route changes.
//
// This replaces the .page-enter CSS keyframe. CSS could animate the arrival but not the
// departure: there is no way to keep an element in the tree after React has removed it, so
// the old screen vanished instantly and the new one faded in over the gap. AnimatePresence
// in the layout holds the outgoing screen until its exit finishes, which is the whole reason
// for bringing framer-motion in rather than writing more keyframes.
const PageTransition = ({ children }: { children: React.ReactNode }) => (
  <motion.div
    variants={pageVariants}
    initial="initial"
    animate="animate"
    exit="exit"
    transition={easeOut}
  >
    {children}
  </motion.div>
);

export default PageTransition;
