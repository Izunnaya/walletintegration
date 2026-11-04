import { useState } from "react";
import { Link } from "react-router-dom";
import { ChevronLeft, ChevronRight, Plus, Search, Users } from "lucide-react";
import { useUsers, useSetRestriction } from "@/api/AdminApi";
import { useAuth } from "@/auth/AuthProvider";
import { useRetryAfter } from "@/hooks/useRetryAfter";
import ApiFeedback from "@/components/ApiFeedback";
import PageHeading from "@/components/PageHeading";
import LoadingButton from "@/components/LoadingButton";
import {
  SlowRequestNotice,
  TransactionsTableSkeleton,
} from "@/components/LoadingStates";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Field,
  FieldDescription,
  FieldLabel,
} from "@/components/ui/field";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { money } from "@/lib/money";
import type { AdminUser } from "@/api/contracts";

// Blacklisting is keyed by email and is not lifted from here, so it is a third status rather
// than a second kind of blocked: offering an unblock on one would promise something this
// screen cannot deliver.
function status(user: AdminUser): "Blacklisted" | "Blocked" | "Active" {
  if (user.isBlacklisted) return "Blacklisted";
  return user.isBlocked ? "Blocked" : "Active";
}

const UserManagementPage = () => {
  const { session } = useAuth();
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(0);
  const [managing, setManaging] = useState<AdminUser | null>(null);
  const [reason, setReason] = useState("");
  const query = useUsers(search);
  const { setRestriction, isPending, error, reset } = useSetRestriction();
  const retryAfter = useRetryAfter(error);

  const rows = query.pages[page] ?? [];
  const canGoNext = page + 1 < query.pages.length || query.hasNextPage;
  const goNext = () => {
    if (page + 1 < query.pages.length) setPage((current) => current + 1);
    else if (query.hasNextPage) {
      void query.fetchNextPage();
      setPage((current) => current + 1);
    }
  };

  const open = (user: AdminUser) => {
    reset();
    setReason("");
    setManaging(user);
  };
  const confirm = async () => {
    if (!managing || retryAfter > 0 || reason.trim() === "") return;
    try {
      await setRestriction({
        userId: managing.id,
        action: managing.isBlocked ? "unblock" : "block",
        reason: reason.trim(),
      });
      setManaging(null);
    } catch {
      /* The mutation error is shown in the dialog. */
    }
  };

  const blocking = managing ? !managing.isBlocked : true;
  const isSelf = managing?.id === session?.user.id;

  return (
    <>
      <PageHeading
        eyebrow="ADMINISTRATION"
        title="User management"
        description="Manage accounts and keep your workspace secure."
        action={
          <Link to="/admin/create" className={buttonVariants()}>
            <Plus />
            Create account
          </Link>
        }
      />
      <ApiFeedback
        error={query.error}
        onRetry={() => void query.refetch()}
      />
      {query.isPending ? (
        <>
          <SlowRequestNotice />
          <TransactionsTableSkeleton />
        </>
      ) : (
        <section className="overflow-hidden rounded-xl border">
          <div className="flex flex-wrap items-center justify-between gap-4 p-5">
            <div>
              <h2 className="text-sm font-semibold">
                All users
                <span className="ml-2 text-muted-foreground">
                  {query.users.length}
                  {query.hasNextPage ? "+" : ""}
                </span>
              </h2>
              <p className="mt-1 text-xs text-muted-foreground">
                Manage access to your wallet workspace.
              </p>
            </div>
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-2.5 size-4 text-muted-foreground" />
              <Input
                aria-label="Search users"
                placeholder="Search users…"
                className="pl-9"
                value={search}
                onChange={(event) => {
                  setSearch(event.target.value);
                  setPage(0);
                }}
              />
            </div>
          </div>
          <Table>
            <TableHeader>
              <TableRow className="bg-muted/40">
                <TableHead className="pl-5">User</TableHead>
                <TableHead>Wallet ID</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="pr-5 text-right">Action</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((user) => (
                <TableRow key={user.id}>
                  <TableCell className="py-5 pl-5">
                    <p className="font-medium">{user.name}</p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {user.email}
                    </p>
                  </TableCell>
                  <TableCell className="font-mono text-xs text-muted-foreground">
                    {user.wallet ? user.wallet.publicId : "No wallet"}
                    {user.wallet && (
                      <p className="mt-1 font-sans tabular-nums">
                        {money(user.wallet.balanceMinor)}
                      </p>
                    )}
                  </TableCell>
                  <TableCell>
                    <span
                      className="status-badge inline-flex items-center border"
                      data-status={status(user)}
                    >
                      <span className="size-1.5 rounded-full bg-current" />
                      {status(user)}
                    </span>
                  </TableCell>
                  <TableCell className="pr-5 text-right">
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={user.isBlacklisted || user.id === session?.user.id}
                      onClick={() => open(user)}
                    >
                      {user.isBlocked ? "Unblock" : "Block"}
                    </Button>
                    {user.isBlacklisted && (
                      <p className="ml-auto mt-2 max-w-48 whitespace-normal text-xs text-muted-foreground">
                        Blacklist restrictions can't be lifted from here.
                      </p>
                    )}
                    {user.id === session?.user.id && (
                      <p className="ml-auto mt-2 max-w-48 whitespace-normal text-xs text-muted-foreground">
                        You can't change your own access.
                      </p>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          {rows.length === 0 && (
            <div className="flex flex-col items-center justify-center gap-4 p-6 text-center">
              <div className="flex max-w-96 flex-col items-center gap-2">
                <div className="mb-2 flex size-8 items-center justify-center rounded-lg bg-muted">
                  <Users className="size-4" />
                </div>
                <p className="text-sm font-medium tracking-tight">
                  No users found
                </p>
                <p className="text-sm leading-relaxed text-muted-foreground">
                  Try another name, email, or wallet ID.
                </p>
              </div>
            </div>
          )}
          <div className="flex items-center justify-between border-t px-5 py-3 text-xs text-muted-foreground">
            <span>
              {rows.length} {rows.length === 1 ? "account" : "accounts"} shown
            </span>
            <div className="flex items-center gap-3">
              <Button
                variant="outline"
                size="icon-sm"
                aria-label="Previous page"
                disabled={page === 0}
                onClick={() => setPage((current) => current - 1)}
              >
                <ChevronLeft />
              </Button>
              <span>Page {page + 1}</span>
              <Button
                variant="outline"
                size="icon-sm"
                aria-label="Next page"
                disabled={!canGoNext || query.isFetchingNextPage}
                onClick={goNext}
              >
                <ChevronRight />
              </Button>
            </div>
          </div>
        </section>
      )}

      <Dialog
        open={managing !== null}
        onOpenChange={(next) => {
          if (!next && !isPending) setManaging(null);
        }}
      >
        <DialogContent showCloseButton={!isPending}>
          <DialogHeader>
            <DialogTitle>
              {blocking ? "Block this account" : "Unblock this account"}
            </DialogTitle>
            <DialogDescription>
              {blocking
                ? "Blocking stops transfers in both directions."
                : "Unblocking restores transfers. It does not lift a blacklist."}{" "}
              A reason is required for the audit record.
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-4">
            <p className="text-sm">
              <span className="font-medium">{managing?.name}</span>
              <span className="text-muted-foreground"> · {managing?.email}</span>
            </p>
            <Field>
              <FieldLabel htmlFor="admin-reason">Reason</FieldLabel>
              <Input
                id="admin-reason"
                value={reason}
                onChange={(event) => setReason(event.target.value)}
                placeholder="Explain why this action is needed"
              />
              <FieldDescription>
                This is written to the audit log with your name.
              </FieldDescription>
            </Field>
            <ApiFeedback error={error} />
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              disabled={isPending}
              onClick={() => setManaging(null)}
            >
              Cancel
            </Button>
            <LoadingButton
              loading={isPending}
              loadingLabel="Saving..."
              disabled={reason.trim() === "" || retryAfter > 0 || isSelf}
              onClick={confirm}
            >
              {retryAfter > 0
                ? `Retry in ${retryAfter}s`
                : blocking
                  ? "Block account"
                  : "Unblock account"}
            </LoadingButton>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
};
export default UserManagementPage;
