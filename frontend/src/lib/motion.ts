import type { Transition, Variants } from "framer-motion";

// Every animation in the application takes its timing from here.
//
// The reason to centralise it is that inconsistent motion reads as a bug even when nobody
// can say why: two panels easing differently, or one transition at 150ms next to another at
// 400ms, makes an interface feel unfinished. One file means the whole app moves the same way
// and the timings can be tuned in one place.
//
// The brief is subtle. This is a wallet, and money moving is the only thing on screen that
// should feel like an event. Everything else gets a short fade and a few pixels of travel -
// enough to show where a panel came from, not enough to make somebody wait for it.
//
// Accessibility is not handled here: MotionConfig in main.tsx is set to reducedMotion="user",
// so framer-motion drops transforms for anyone whose system asks for reduced motion and
// keeps opacity changes only. That is global, so it cannot be forgotten per component.

// The default curve. Standard ease-out: quick to start, settles gently, which is what makes
// an entrance feel responsive rather than sluggish.
export const easeOut: Transition = { duration: 0.26, ease: [0.16, 1, 0.3, 1] };

export const quick: Transition = { duration: 0.16, ease: [0.16, 1, 0.3, 1] };

// A whole screen arriving. Replaces the .page-enter CSS keyframe, which could not animate
// anything leaving because CSS has no way to hold an element in the tree while it exits.
export const pageVariants: Variants = {
  initial: { opacity: 0, y: 8 },
  animate: { opacity: 1, y: 0 },
  exit: { opacity: 0, y: -4 },
};

// A panel or card appearing within a screen.
export const panelVariants: Variants = {
  initial: { opacity: 0, y: 10 },
  animate: { opacity: 1, y: 0 },
};

// A list that fills in. The stagger is deliberately small: at 0.03s a table of six rows is
// fully in under a fifth of a second, so it reads as the list settling rather than as rows
// being dealt out one at a time.
export const listVariants: Variants = {
  initial: {},
  animate: { transition: { staggerChildren: 0.03 } },
};

export const rowVariants: Variants = {
  initial: { opacity: 0, y: 6 },
  animate: { opacity: 1, y: 0, transition: easeOut },
};
