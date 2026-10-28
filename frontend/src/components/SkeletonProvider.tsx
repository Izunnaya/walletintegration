import { SkeletonTheme } from "react-loading-skeleton";
import "react-loading-skeleton/dist/skeleton.css";
import { useTheme } from "@/components/ThemeProvider";
const palette = {
  light: { baseColor: "#ececec", highlightColor: "#f6f6f6" },
  dark: { baseColor: "#262626", highlightColor: "#333333" },
};

const SkeletonProvider = ({ children }: { children: React.ReactNode }) => {
  const { theme } = useTheme();
  const { baseColor, highlightColor } = palette[theme];

  return (
    <SkeletonTheme
      baseColor={baseColor}
      highlightColor={highlightColor}
      borderRadius="0.5rem"
    >
      {children}
    </SkeletonTheme>
  );
};

export default SkeletonProvider;
