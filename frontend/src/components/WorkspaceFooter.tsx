import { useServiceHealth } from "@/api/HealthApi";
import { Button } from "@/components/ui/button";
const WorkspaceFooter = () => {
  const { isFetching, isError, refetch } = useServiceHealth();
  return (
    <footer className="mt-10 flex flex-wrap items-center justify-between gap-3 border-t pt-5 text-xs text-muted-foreground">
      <span>Folio wallet · NGN</span>
      <div className="flex items-center gap-2" role="status">
        <span
          className={
            isFetching
              ? "text-muted-foreground"
              : isError
                ? "text-destructive"
                : "text-success"
          }
        >
          {isFetching
            ? "Checking service..."
            : isError
              ? "Service unavailable"
              : "Service online"}
        </span>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => void refetch()}
          disabled={isFetching}
        >
          Check again
        </Button>
      </div>
    </footer>
  );
};
export default WorkspaceFooter;
