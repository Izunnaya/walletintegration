import { Link } from "react-router-dom";
import { ArrowDownLeft, ArrowUpRight } from "lucide-react";
import { motion } from "framer-motion";
import { buttonVariants } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from "@/components/ui/empty";
import { money } from "@/lib/money";
import { easeOut, panelVariants } from "@/lib/motion";
import type { Transfer } from "@/api/contracts";

const TransactionsTable = ({
  transfers,
  full = false,
}: {
  transfers: Transfer[];
  full?: boolean;
}) => {
  const rows = full ? transfers : transfers.slice(0, 5);
  return (
    <motion.section
      className="overflow-hidden rounded-xl border bg-card"
      variants={panelVariants}
      initial="initial"
      animate="animate"
      transition={easeOut}
    >
      <div className="flex items-center justify-between gap-3 px-5 py-5">
        <h2 className="text-base font-semibold">
          {full ? "Transfer history" : "Recent transfers"}
        </h2>
        {!full && (
          <Link
            className={buttonVariants({ variant: "outline", size: "sm" })}
            to="/transactions"
          >
            View all
          </Link>
        )}
      </div>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="pl-5">Wallet</TableHead>
            <TableHead>Amount</TableHead>
            <TableHead>Reference</TableHead>
            <TableHead className="pr-5 text-right">Date</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((transfer) => {
            const received = transfer.direction === "received";
            return (
              <TableRow key={transfer.id}>
                <TableCell className="py-4 pl-5">
                  <Link
                    to={`/transactions/${transfer.id}`}
                    className="flex items-center gap-2 font-medium underline-offset-4 hover:underline"
                  >
                    {received ? (
                      <ArrowDownLeft className="size-4" />
                    ) : (
                      <ArrowUpRight className="size-4" />
                    )}
                    {received ? "From" : "To"} wallet{" "}
                    {received
                      ? transfer.sourceWalletId
                      : transfer.destinationWalletId}
                  </Link>
                </TableCell>
                <TableCell
                  className={
                    received
                      ? "text-success font-medium tabular-nums"
                      : "font-medium tabular-nums"
                  }
                >
                  {received ? "+" : "−"}
                  {money(transfer.amountMinor)}
                </TableCell>
                <TableCell>
                  <Link
                    to={`/transactions/${transfer.id}`}
                    className="font-mono text-xs underline underline-offset-4"
                    aria-label={`View transfer ${transfer.id}`}
                  >
                    {transfer.reference}
                  </Link>
                </TableCell>
                <TableCell className="pr-5 text-right text-xs">
                  {new Date(transfer.createdAt).toLocaleString()}
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
      {rows.length === 0 && (
        <Empty>
          <EmptyHeader>
            <EmptyTitle>No transfers yet</EmptyTitle>
            <EmptyDescription>
              Your completed transfers will appear here.
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      )}
      <p className="border-t px-5 py-3 text-xs text-muted-foreground">
        {rows.length} {rows.length === 1 ? "transfer" : "transfers"} shown ·
        Times are local to your device
      </p>
    </motion.section>
  );
};
export default TransactionsTable;
