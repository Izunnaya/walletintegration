import { useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import {
  ArrowDownLeft,
  ArrowLeftRight,
  ArrowRight,
  ArrowUpRight,
  ChevronLeft,
  ChevronRight,
  Search,
} from "lucide-react";
import { motion } from "framer-motion";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { money } from "@/lib/money";
import { easeOut, panelVariants } from "@/lib/motion";
import { cn } from "@/lib/utils";
import type { Transfer } from "@/api/contracts";

const tabs = [
  { id: "all", label: "All" },
  { id: "sent", label: "Sent" },
  { id: "received", label: "Received" },
] as const;
type Tab = (typeof tabs)[number]["id"];

// The wallet on the other side of the transfer. The row shows it under the direction,
// because it is the only thing identifying the counterparty: the API returns wallet ids,
// not the names the design's sample data had.
function counterparty(transfer: Transfer): string {
  return transfer.direction === "received"
    ? (transfer.sourceWalletPublicId ?? transfer.sourceWalletId)
    : (transfer.destinationWalletPublicId ?? transfer.destinationWalletId);
}

type Props = {
  transfers: Transfer[];
  full?: boolean;
  // Full view only. The design pages with previous and next, and the API is cursor-paged, so
  // a page here is one page the API returned - not a fixed row count. Paging by a count of
  // our own would land on an empty page whenever the server returned fewer rows than that.
  pages?: Transfer[][];
  hasNextPage?: boolean;
  isFetchingNextPage?: boolean;
  onLoadMore?: () => void;
};

const TransactionsTable = ({
  transfers,
  full = false,
  pages = [],
  hasNextPage = false,
  isFetchingNextPage = false,
  onLoadMore,
}: Props) => {
  const navigate = useNavigate();
  const [tab, setTab] = useState<Tab>("all");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(0);

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    return transfers.filter((transfer) => {
      if (tab !== "all" && transfer.direction !== tab) return false;
      if (!term) return true;
      return (
        transfer.reference.toLowerCase().includes(term) ||
        counterparty(transfer).toLowerCase().includes(term)
      );
    });
  }, [transfers, tab, search]);

  // A filter searches every transfer loaded so far, so it cannot also be paged: a match two
  // pages back would simply not be shown. Filtering therefore lists all of its matches and
  // puts the pager away, and the footer says how many rows that is.
  const filtering = tab !== "all" || search.trim() !== "";
  const rows = !full
    ? filtered.slice(0, 5)
    : filtering
      ? filtered
      : (pages[page] ?? []);
  const canGoNext = page + 1 < pages.length || hasNextPage;

  // Changing a filter can leave the viewer on a page that no longer exists.
  const changeFilter = (apply: () => void) => {
    apply();
    setPage(0);
  };
  const goNext = () => {
    if (page + 1 < pages.length) setPage((current) => current + 1);
    else if (hasNextPage && onLoadMore) {
      onLoadMore();
      setPage((current) => current + 1);
    }
  };

  return (
    <motion.section
      className="overflow-hidden rounded-xl border bg-card"
      variants={panelVariants}
      initial="initial"
      animate="animate"
      transition={easeOut}
    >
      <div className="flex flex-wrap items-center justify-between gap-3 px-6 py-5">
        <div>
          <h2 className="text-[15px] font-semibold">
            {full ? "Transfer history" : "Recent transfers"}
          </h2>
          <p className="mt-1 text-xs text-muted-foreground">
            {full
              ? "Every movement, newest first."
              : "Your five most recent transfers."}
          </p>
        </div>
        {!full && (
          <Link
            className={buttonVariants({ variant: "outline", size: "sm" })}
            to="/transactions"
          >
            View all
            <ArrowRight />
          </Link>
        )}
      </div>
      {full && (
        <div className="flex flex-wrap justify-between gap-3 border-t px-6 py-4">
          <div
            role="tablist"
            aria-label="Filter by direction"
            className="inline-flex h-8 w-fit items-center rounded-lg bg-muted p-[3px] text-muted-foreground"
          >
            {tabs.map(({ id, label }) => (
              <button
                key={id}
                type="button"
                role="tab"
                aria-selected={tab === id}
                onClick={() => changeFilter(() => setTab(id))}
                className={cn(
                  "inline-flex h-[calc(100%-1px)] flex-1 items-center justify-center rounded-md border border-transparent px-1.5 py-0.5 text-sm font-medium whitespace-nowrap transition-all hover:text-foreground",
                  tab === id && "border-border bg-background text-foreground",
                )}
              >
                {label}
              </button>
            ))}
          </div>
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-2.5 size-4 text-muted-foreground" />
            <Input
              aria-label="Search transactions"
              placeholder="Search transactions…"
              className="pl-9"
              value={search}
              onChange={(event) =>
                changeFilter(() => setSearch(event.target.value))
              }
            />
          </div>
        </div>
      )}
      <Table>
        <TableHeader>
          <TableRow className="bg-muted/40">
            <TableHead className="pl-6">Transaction</TableHead>
            <TableHead>Amount</TableHead>
            <TableHead>Reference</TableHead>
            <TableHead className="pr-6 text-right">Date &amp; time</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((transfer) => {
            const received = transfer.direction === "received";
            const open = () => void navigate(`/transactions/${transfer.id}`);
            const createdAt = new Date(transfer.createdAt);
            return (
              <TableRow
                key={transfer.id}
                tabIndex={0}
                aria-label={`View transfer ${transfer.id}`}
                onClick={open}
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    open();
                  }
                }}
                className="cursor-pointer"
              >
                <TableCell className="py-4 pl-6">
                  <div className="flex items-center gap-3">
                    <span className="flex size-9 shrink-0 items-center justify-center rounded-full border bg-background">
                      {received ? (
                        <ArrowDownLeft className="size-4" />
                      ) : (
                        <ArrowUpRight className="size-4" />
                      )}
                    </span>
                    <div>
                      <p className="font-medium">
                        {received ? "Received" : "Sent"}
                      </p>
                      <p className="mt-1 font-mono text-[11px] text-muted-foreground">
                        {counterparty(transfer)}
                      </p>
                    </div>
                  </div>
                </TableCell>
                <TableCell>
                  <span
                    className={cn(
                      "font-medium tabular-nums",
                      received && "text-success",
                    )}
                  >
                    {received ? "+" : "−"}
                    {money(transfer.amountMinor)}
                  </span>
                  <p className="mt-1 text-[11px] text-muted-foreground">
                    Completed
                  </p>
                </TableCell>
                <TableCell>
                  <code className="text-xs">{transfer.reference}</code>
                </TableCell>
                <TableCell className="pr-6 text-right">
                  <p className="text-xs">{createdAt.toLocaleDateString()}</p>
                  <p className="mt-1 text-[11px] text-muted-foreground">
                    {createdAt.toLocaleTimeString()}
                  </p>
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
      {rows.length === 0 && (
        <Empty>
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <ArrowLeftRight />
            </EmptyMedia>
            <EmptyTitle>
              {transfers.length === 0
                ? "No transactions yet"
                : "No matching transactions"}
            </EmptyTitle>
            <EmptyDescription>
              {transfers.length === 0
                ? "Your completed transfers will appear here."
                : "Try a different filter or search term."}
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      )}
      <div className="flex items-center justify-between border-t px-6 py-3 text-xs text-muted-foreground">
        <span>
          {rows.length} {rows.length === 1 ? "transfer" : "transfers"} shown
        </span>
        {full && !filtering ? (
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
              disabled={!canGoNext || isFetchingNextPage}
              onClick={goNext}
            >
              <ChevronRight />
            </Button>
          </div>
        ) : (
          <span>All times in your local timezone</span>
        )}
      </div>
    </motion.section>
  );
};
export default TransactionsTable;
