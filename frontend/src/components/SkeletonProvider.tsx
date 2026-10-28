import { SkeletonTheme } from "react-loading-skeleton";
import "react-loading-skeleton/dist/skeleton.css";
import { useWorkspace } from "@/components/WorkspaceProvider";

// react-loading-skeleton takes its colours from a provider rather than from classes, so this
// is where the placeholder shimmer learns about dark mode. Without it the skeletons stay pale
// grey on a dark background and glow.
//
// The values are hard-coded rather than read from the CSS custom properties, because the
// library needs real colours for its gradient and cannot resolve var(--muted) itself. They
// are the resolved values of --muted and --accent from App.css, which is a small duplication
// and the reason it is confined to this one file.
const palette = {
  light: { baseColor: "#ececec", highlightColor: "#f6f6f6" },
  dark: { baseColor: "#262626", highlightColor: "#333333" },
};

const SkeletonProvider = ({ children }: { children: React.ReactNode }) => {
  const { theme } = useWorkspace();
  const { baseColor, highlightColor } = palette[theme];

  return (
    <SkeletonTheme baseColor={baseColor} highlightColor={highlightColor} borderRadius="0.5rem">
      {children}
    </SkeletonTheme>
  );
};

export default SkeletonProvider;
