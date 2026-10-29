import type { Transition, Variants } from "framer-motion";

export const easeOut: Transition = { duration: 0.26, ease: [0.16, 1, 0.3, 1] };

export const quick: Transition = { duration: 0.16, ease: [0.16, 1, 0.3, 1] };

export const pageVariants: Variants = {
  initial: { opacity: 0, y: 8 },
  animate: { opacity: 1, y: 0 },
  exit: { opacity: 0, y: -4 },
};

export const panelVariants: Variants = {
  initial: { opacity: 0, y: 10 },
  animate: { opacity: 1, y: 0 },
};

export const listVariants: Variants = {
  initial: {},
  animate: { transition: { staggerChildren: 0.03 } },
};

export const rowVariants: Variants = {
  initial: { opacity: 0, y: 6 },
  animate: { opacity: 1, y: 0, transition: easeOut },
};
