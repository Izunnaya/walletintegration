import { useState } from "react";
import { Search } from "lucide-react";
import { notify } from "@/lib/notify";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@/components/ui/empty";
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import PageHeading from "@/components/PageHeading";
import { SlowRequestNotice, UsersTableSkeleton } from "@/components/LoadingStates";
import StatusBadge from "@/components/StatusBadge";
import { useSetRestriction, useUsers } from "@/api/AdminApi";
import type { WalletUser } from "@/api/types";

const UserManagementPage = () => {
  const { users, isPending, isError, error } = useUsers();
  const { setUserRestriction, isPending: saving } = useSetRestriction();

  const [search, setSearch] = useState("");
  const [managing, setManaging] = useState<WalletUser | null>(null);
  const [reason, setReason] = useState("");

  if (isPending) {
    return (
      <div aria-busy="true">
        <SlowRequestNotice />
        <UsersTableSkeleton />
      </div>
    );
  }

  if (isError) {
    return (
      <Alert variant="destructive">
        <AlertDescription>{error?.message ?? "Users could not be loaded."}</AlertDescription>
      </Alert>
    );
  }

  const term = search.trim().toLowerCase();
  const visible = users.filter((user) =>
    `${user.name} ${user.email} ${user.id}`.toLowerCase().includes(term),
  );

  const apply = async () => {
    if (!managing) return;
    try {
      // Blocked becomes active; anything else becomes blocked.
      await setUserRestriction({
        walletId: managing.id,
        blocked: managing.status !== "blocked",
        reason,
      });
      // Named, because "User blocked" without saying who is useless in a list of five.
      notify.success(
        managing.status === "blocked" ? `${managing.name} unblocked` : `${managing.name} blocked`,
        "The reason has been recorded against the wallet.",
      );
      setManaging(null);
      setReason("");
    } catch (caught) {
      notify.error(caught, "That change could not be saved.");
    }
  };

  return (
    <>
      <PageHeading
        title="User management"
        description="Manage accounts and keep your workspace secure."
      />

      <section className="overflow-hidden rounded-xl border">
        <div className="flex flex-wrap items-center justify-between gap-4 p-5">
          <div>
            <h2 className="text-sm font-semibold">
              All users <span className="ml-2 text-muted-foreground">{users.length}</span>
            </h2>
            <p className="mt-1 text-xs text-muted-foreground">
              Manage access to your wallet workspace.
            </p>
          </div>
          <div className="relative">
            <Search className="absolute left-3 top-2.5 size-4 text-muted-foreground" />
            <Input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              className="pl-9"
              placeholder="Search users…"
              aria-label="Search users"
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
            {visible.map((user) => (
              <TableRow key={user.id}>
                <TableCell className="py-5 pl-5">
                  <p className="font-medium">{user.name}</p>
                  <p className="mt-1 text-xs text-muted-foreground">{user.email}</p>
                </TableCell>
                <TableCell className="font-mono text-xs text-muted-foreground">
                  {user.id}
                </TableCell>
                <TableCell>
                  <StatusBadge status={user.status} />
                </TableCell>
                <TableCell className="pr-5 text-right">
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={user.status === "blacklisted"}
                    onClick={() => {
                      setReason("");
                      setManaging(user);
                    }}
                  >
                    {user.status === "blocked" ? "Unblock" : "Block"}
                  </Button>
                  {user.status === "blacklisted" && (
                    <p className="mt-2 max-w-48 text-xs text-muted-foreground">
                      Blacklist restrictions can&apos;t be lifted from here.
                    </p>
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>

        {visible.length === 0 && (
          <Empty>
            <EmptyHeader>
              <EmptyTitle>No users found</EmptyTitle>
              <EmptyDescription>Try another name, email, or wallet ID.</EmptyDescription>
            </EmptyHeader>
          </Empty>
        )}
      </section>

      <Dialog
        open={managing !== null}
        onOpenChange={(open) => {
          if (!open && !saving) setManaging(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {managing?.status === "blocked" ? "Unblock" : "Block"} {managing?.name}?
            </DialogTitle>
            <DialogDescription>
              {managing?.status === "blocked"
                ? "This user will be able to send and receive transfers again."
                : "This user will not be able to send or receive transfers."}{" "}
              A reason is required for the audit record.
            </DialogDescription>
          </DialogHeader>

          <FieldGroup>
            <Field>
              <FieldLabel htmlFor="admin-reason">Reason</FieldLabel>
              <Input
                id="admin-reason"
                value={reason}
                onChange={(event) => setReason(event.target.value)}
                placeholder="Explain why this action is needed"
              />
              <FieldDescription>
                The server records this against the wallet, and the record is not editable
                afterwards.
              </FieldDescription>
            </Field>
          </FieldGroup>

          <DialogFooter>
            <Button variant="outline" disabled={saving} onClick={() => setManaging(null)}>
              Cancel
            </Button>
            <Button disabled={!reason.trim() || saving} onClick={apply}>
              {saving
                ? "Saving…"
                : `Confirm ${managing?.status === "blocked" ? "unblock" : "block"}`}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
};

export default UserManagementPage;
