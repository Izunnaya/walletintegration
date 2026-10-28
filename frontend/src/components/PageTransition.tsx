import { motion } from "framer-motion";
import { easeOut, pageVariants } from "@/lib/motion";
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
