import { useEffect, useState } from "react";
import { Skeleton } from "@/components/ui/skeleton";

// What a screen shows while its query is in flight.
//
// The notice after three seconds is not decoration. The API is deployed on Render's free
// plan, which stops the service when it is idle and takes the best part of a minute to start
// it again. Without this the first request of the day looks like a hang, and a reviewer
// opening the link cold is exactly the person who hits it.
const SLOW_REQUEST_MS = 3000;

const PendingPanels = ({ label = "Loading" }: { label?: string }) => {
  const [slow, setSlow] = useState(false);

  useEffect(() => {
    const timer = setTimeout(() => setSlow(true), SLOW_REQUEST_MS);
    return () => clearTimeout(timer);
  }, []);

  return (
    <div aria-label={label} aria-busy="true" className="flex flex-col gap-6">
      {slow && (
        <p role="status" className="text-sm text-muted-foreground">
          Waking up the server, this can take up to a minute.
        </p>
      )}
      <Skeleton className="h-60 w-full rounded-xl" />
      <Skeleton className="h-80 w-full rounded-xl" />
    </div>
  );
};

export default PendingPanels;
