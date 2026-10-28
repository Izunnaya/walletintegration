import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { ApiError } from "@/api/contracts";

const ApiFeedback = ({ error, onRetry }: { error: unknown; onRetry?: () => void }) => {
  if (!error) return null;
  const apiError = error instanceof ApiError ? error : null;
  return <Alert variant="destructive" role="alert"><AlertDescription>
    <p>{error instanceof Error ? error.message : "The request could not be completed."}</p>
    {apiError?.details.map((issue, index) => <p key={index}>{issue.field ? `${issue.field}: ` : ""}{issue.message}</p>)}
    {apiError?.retryAfterSeconds !== undefined && <p>Try again in {apiError.retryAfterSeconds} seconds.</p>}
    {apiError?.requestId && <p className="mt-2 break-all text-xs">Request ID: {apiError.requestId}</p>}
    {onRetry && <Button variant="outline" className="mt-3" onClick={onRetry}>Try again</Button>}
  </AlertDescription></Alert>;
};
export default ApiFeedback;
