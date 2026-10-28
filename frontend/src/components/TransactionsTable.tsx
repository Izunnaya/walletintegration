import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { motion } from "framer-motion";
import {
  ArrowDownLeft,
  ArrowLeftRight,
  ArrowRight,
  ArrowUpRight,
  ChevronLeft,
  ChevronRight,
  Search,
} from "lucide-react";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { money } from "@/lib/money";
import { easeOut, panelVariants } from "@/lib/motion";
import type { Transfer } from "@/api/types";

const PAGE_SIZE = 6;
const RECENT_COUNT = 5;

const filters = [
  { value: "all", label: "All transactions" },
  { value: "sent", label: "Sent" },
  { value: "received", label: "Received" },
];

type Props = {
  transfers: Transfer[];
  /** The full screen gets filters, search and paging; the overview gets a short list. */
  full?: boolean;
};

const TransactionsTable = ({ transfers, full = false }: Props) => {
  const [filter, setFilter] = useState("all");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(0);
  const navigate = useNavigate();

  const term = search.trim().toLowerCase();
  const filtered = transfers.filter((transfer) => {
    const matchesFilter = filter === "all" || transfer.direction === filter;
    const haystack = `${transfer.counterpartyName} ${transfer.counterpartyWallet}`.toLowerCase();
    return matchesFilter && haystack.includes(term);
  });

  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  // Clamped rather than reset, so deleting the last row of the last page cannot leave the
  // view on a page that no longer exists.
  const currentPage = Math.min(page, pageCount - 1);
  const rows = full
    ? filtered.slice(currentPage * PAGE_SIZE, (currentPage + 1) * PAGE_SIZE)
    : transfers.slice(0, RECENT_COUNT);

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
            {full ? "All transactions" : "Recent transactions"}
          </h2>
          <p className="mt-1 text-xs text-muted-foreground">
            {full
              ? "A complete record of your wallet activity."
              : "Your latest money movements, at a glance."}
          </p>
        </div>
        {!full && (
          <Link to="/transactions" className={buttonVariants({ variant: "outline", size: "sm" })}>
            View all <ArrowRight data-icon="inline-end" />
          </Link>
        )}
      </div>

      {full && (
        <div className="flex flex-wrap justify-between gap-3 border-t px-6 py-4">
          <Tabs
            value={filter}
            onValueChange={(value) => {
              setFilter(String(value));
              setPage(0);
            }}
          >
            <TabsList>
              {filters.map(({ value, label }) => (
                <TabsTrigger key={value} value={value}>
                  {label}
                </TabsTrigger>
              ))}
            </TabsList>
          </Tabs>
          <div className="relative">
            <Search className="absolute top-2.5 left-3 size-4 text-muted-foreground" />
            <Input
              aria-label="Search transactions"
              placeholder="Search transactions…"
              className="pl-9"
              value={search}
              onChange={(event) => {
                setSearch(event.target.value);
                setPage(0);
              }}
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
            const open = () => navigate(`/transactions/${transfer.id}`);
            return (
              <TableRow
                key={transfer.id}
                className="cursor-pointer"
                tabIndex={0}
                aria-label={`View transfer ${transfer.id}`}
                onClick={open}
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    open();
                  }
                }}
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
                        {received ? "From" : "To"} {transfer.counterpartyName}
                      </p>
                      <p className="mt-1 font-mono text-[11px] text-muted-foreground">
                        {transfer.counterpartyWallet}
                      </p>
                    </div>
                  </div>
                </TableCell>
                <TableCell>
                  <span
                    className={
                      received
                        ? "text-success font-medium tabular-nums"
                        : "font-medium tabular-nums"
                    }
                  >
                    {received ? "+" : "−"}
                    {money(transfer.amountMinor)}
                  </span>
                  <p className="mt-1 text-[11px] text-muted-foreground">
                    NGN · {received ? "Received" : "Sent"}
                  </p>
                </TableCell>
                <TableCell>
                  <code className="text-xs">{transfer.id}</code>
                </TableCell>
                <TableCell className="pr-6 text-right">
                  <p className="text-xs">
                    {new Date(transfer.createdAt).toLocaleDateString("en-US", {
                      month: "short",
                      day: "numeric",
                      year: "numeric",
                    })}
                  </p>
                  <p className="mt-1 text-[11px] text-muted-foreground">
                    {new Date(transfer.createdAt).toLocaleTimeString("en-US", {
                      hour: "numeric",
                      minute: "2-digit",
                    })}
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
            <EmptyTitle>No transactions yet</EmptyTitle>
            <EmptyDescription>
              Try a different filter or send your first transfer.
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      )}

      <div className="flex items-center justify-between border-t px-6 py-3 text-xs text-muted-foreground">
        <span>
          {full
            ? `${filtered.length} transactions`
            : `Showing your ${RECENT_COUNT} most recent transactions`}
        </span>
        {full ? (
          <div className="flex items-center gap-3">
            <Button
              variant="outline"
              size="icon-sm"
              aria-label="Previous page"
              disabled={currentPage === 0}
              onClick={() => setPage(currentPage - 1)}
            >
              <ChevronLeft />
            </Button>
            <span>
              {currentPage + 1} of {pageCount}
            </span>
            <Button
              variant="outline"
              size="icon-sm"
              aria-label="Next page"
              disabled={currentPage >= pageCount - 1}
              onClick={() => setPage(currentPage + 1)}
            >
              <ChevronRight />
            </Button>
          </div>
        ) : (
          <span className="hidden sm:inline">All times in your local timezone</span>
        )}
      </div>
    </motion.section>
  );
};

export default TransactionsTable;
