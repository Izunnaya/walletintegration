import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";

type Props = React.ComponentProps<typeof Button> & {
  loading: boolean;
  loadingLabel: string;
};
const LoadingButton = ({
  loading,
  loadingLabel,
  disabled,
  children,
  ...rest
}: Props) => (
  <Button {...rest} disabled={loading || disabled}>
    {loading ? (
      <>
        <Loader2 className="animate-spin" />
        {loadingLabel}
      </>
    ) : (
      children
    )}
  </Button>
);

export default LoadingButton;
