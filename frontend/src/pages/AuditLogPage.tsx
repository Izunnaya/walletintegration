import { useAuditEntries } from "@/api/AdminApi";
import ApiFeedback from "@/components/ApiFeedback";
import PageHeading from "@/components/PageHeading";
import {
  SlowRequestNotice,
  TransactionsTableSkeleton,
} from "@/components/LoadingStates";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { ScrollText } from "lucide-react";

const AuditLogPage = () => {
  const query = useAuditEntries();
  return (
    <>
      <PageHeading
        title="Audit log"
        description="Every access change, with the reason it was made."
        action={
          <Button
            variant="outline"
            disabled={query.isFetching}
            onClick={() => void query.refetch()}
          >
            Refresh audit log
          </Button>
        }
      />
      <ApiFeedback error={query.error} onRetry={() => void query.refetch()} />
      {query.isPending ? (
        <>
          <SlowRequestNotice />
          <TransactionsTableSkeleton />
        </>
      ) : (
        <section className="overflow-hidden rounded-xl border bg-card">
          <div className="px-6 py-5">
            <h2 className="text-[15px] font-semibold">
              Restriction changes
              <span className="ml-2 text-muted-foreground">
                {query.entries.length}
              </span>
            </h2>
            <p className="mt-1 text-xs text-muted-foreground">
              The latest 50, newest first.
            </p>
          </div>
          <Table>
            <TableHeader>
              <TableRow className="bg-muted/40">
                <TableHead className="pl-6">Action</TableHead>
                <TableHead>Account</TableHead>
                <TableHead>Changed by</TableHead>
                <TableHead>Reason</TableHead>
                <TableHead className="pr-6 text-right">Date</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {query.entries.map((entry) => (
                <TableRow key={entry.id}>
                  <TableCell className="py-4 pl-6">
                    <span
                      className="status-badge inline-flex items-center border"
                      data-status={
                        entry.action === "block" ? "Blocked" : "Active"
                      }
                    >
                      <span className="size-1.5 rounded-full bg-current" />
                      {entry.action === "block" ? "Blocked" : "Unblocked"}
                    </span>
                  </TableCell>
                  <TableCell>
                    <p className="font-medium">{entry.affected.email}</p>
                    <p className="mt-1 font-mono text-[11px] text-muted-foreground">
                      User {entry.affected.id}
                    </p>
                  </TableCell>
                  <TableCell className="text-xs">{entry.actor.email}</TableCell>
                  <TableCell className="max-w-xs whitespace-normal break-words text-xs">
                    {entry.reason ?? "No reason recorded"}
                  </TableCell>
                  <TableCell className="pr-6 text-right">
                    <p className="text-xs">
                      {new Date(entry.createdAt).toLocaleDateString()}
                    </p>
                    <p className="mt-1 text-[11px] text-muted-foreground">
                      {new Date(entry.createdAt).toLocaleTimeString()}
                    </p>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          {!query.isError && query.entries.length === 0 && (
            <div className="flex flex-col items-center justify-center gap-4 p-6 text-center">
              <div className="flex max-w-96 flex-col items-center gap-2">
                <div className="mb-2 flex size-8 items-center justify-center rounded-lg bg-muted">
                  <ScrollText className="size-4" />
                </div>
                <p className="text-sm font-medium tracking-tight">
                  No restriction changes recorded
                </p>
                <p className="text-sm leading-relaxed text-muted-foreground">
                  Blocking or unblocking an account will show up here.
                </p>
              </div>
            </div>
          )}
        </section>
      )}
    </>
  );
};
export default AuditLogPage;
