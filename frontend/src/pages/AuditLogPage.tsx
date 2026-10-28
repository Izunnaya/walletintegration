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
import { Empty, EmptyHeader, EmptyTitle } from "@/components/ui/empty";

const AuditLogPage = () => {
  const query = useAuditEntries();
  return (
    <>
      <PageHeading
        title="Audit log"
        description="The latest 50 account restriction changes, newest first."
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
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Action</TableHead>
                <TableHead>Account</TableHead>
                <TableHead>Changed by</TableHead>
                <TableHead>Reason</TableHead>
                <TableHead>Date</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {query.entries.map((entry) => (
                <TableRow key={entry.id}>
                  <TableCell className="capitalize">{entry.action}</TableCell>
                  <TableCell>
                    {entry.affected.email}
                    <p className="text-xs text-muted-foreground">
                      User {entry.affected.id}
                    </p>
                  </TableCell>
                  <TableCell>{entry.actor.email}</TableCell>
                  <TableCell className="max-w-xs whitespace-normal break-words">
                    {entry.reason ?? "No reason recorded"}
                  </TableCell>
                  <TableCell>
                    {new Date(entry.createdAt).toLocaleString()}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          {!query.isError && query.entries.length === 0 && (
            <Empty>
              <EmptyHeader>
                <EmptyTitle>No restriction changes recorded</EmptyTitle>
              </EmptyHeader>
            </Empty>
          )}
        </section>
      )}
    </>
  );
};
export default AuditLogPage;
