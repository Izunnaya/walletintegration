import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";

type Props = React.ComponentProps<typeof Button> & {
  loading: boolean;
  loadingLabel: string;
};

// A submit button that cannot be pressed twice while a request is in flight.
//
// On a transfer screen that is not cosmetic: the guard is what stops a second attempt being
// sent. A repeat is safe anyway, because the Idempotency-Key is reused, but the user should
// not have to rely on that to avoid wondering whether they sent money twice.
const LoadingButton = ({ loading, loadingLabel, disabled, children, ...rest }: Props) => (
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
