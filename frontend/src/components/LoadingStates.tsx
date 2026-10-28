import { useEffect, useState } from "react";
import Skeleton from "react-loading-skeleton";

// Placeholders shaped like the thing that is coming.
//
// The export faked loading with two grey rectangles, which is the version of this that makes
// the screen jump: the boxes are the wrong size, the real content lands, and everything
// moves. These mirror the real layout - same card, same borders, same number of table rows,
// same column widths - so when the data arrives it fills the shape already on screen and
// nothing shifts.
//
// react-loading-skeleton rather than the shadcn Skeleton div, because it does three things
// by hand otherwise: it sizes from the surrounding text, it takes `count` for repeated
// lines, and its shimmer is theme-aware through SkeletonProvider. The pulsing div was fine
// for one box and does not scale to a whole application.

// The API is on Render's free plan: it stops when idle and takes most of a minute to start
// again. Without this the first request of the day looks like a hang, and a reviewer opening
// the link cold is exactly the person who hits it.
const SLOW_REQUEST_MS = 3000;

export const SlowRequestNotice = () => {
  const [slow, setSlow] = useState(false);

  useEffect(() => {
    const timer = setTimeout(() => setSlow(true), SLOW_REQUEST_MS);
    return () => clearTimeout(timer);
  }, []);

  if (!slow) return null;

  return (
    <p role="status" className="mb-6 text-sm text-muted-foreground">
      Waking up the server, this can take up to a minute.
    </p>
  );
};

export const BalanceCardSkeleton = () => (
  <section className="mb-7 overflow-hidden rounded-xl border bg-card">
    <div className="flex flex-col justify-between gap-8 p-6 sm:flex-row lg:p-7">
      <div className="flex-1">
        <Skeleton width={130} height={14} />
        <div className="mt-5">
          <Skeleton width={260} height={46} />
        </div>
        <div className="mt-5">
          <Skeleton width={110} height={12} />
        </div>
      </div>
      <div className="flex flex-col items-start gap-6 sm:items-end">
        <Skeleton width={78} height={20} />
        <Skeleton width={190} height={62} />
      </div>
    </div>
    <div className="grid border-t bg-muted/20 sm:grid-cols-3">
      {[0, 1, 2].map((tile) => (
        <div key={tile} className="flex items-start gap-3 border-b px-6 py-5 last:border-0 sm:border-r sm:border-b-0 lg:px-7">
          <Skeleton width={32} height={32} />
          <div className="flex-1">
            <Skeleton width={90} height={11} />
            <div className="mt-2">
              <Skeleton width={120} height={20} />
            </div>
          </div>
        </div>
      ))}
    </div>
  </section>
);

export const TransactionsTableSkeleton = ({ rows = 5 }: { rows?: number }) => (
  <section className="overflow-hidden rounded-xl border bg-card">
    <div className="px-6 py-5">
      <Skeleton width={180} height={16} />
      <div className="mt-1">
        <Skeleton width={260} height={12} />
      </div>
    </div>
    <div className="border-t">
      {Array.from({ length: rows }, (_, index) => (
        <div key={index} className="flex items-center gap-4 border-b px-6 py-4 last:border-0">
          <Skeleton circle width={36} height={36} />
          <div className="flex-1">
            <Skeleton width={170} height={13} />
            <div className="mt-1">
              <Skeleton width={120} height={11} />
            </div>
          </div>
          <div className="hidden sm:block">
            <Skeleton width={100} height={13} />
          </div>
          <div className="hidden md:block">
            <Skeleton width={80} height={13} />
          </div>
          <Skeleton width={90} height={13} />
        </div>
      ))}
    </div>
  </section>
);

export const UsersTableSkeleton = ({ rows = 5 }: { rows?: number }) => (
  <section className="overflow-hidden rounded-xl border">
    <div className="flex flex-wrap items-center justify-between gap-4 p-5">
      <div>
        <Skeleton width={140} height={14} />
        <div className="mt-1">
          <Skeleton width={220} height={12} />
        </div>
      </div>
      <Skeleton width={210} height={32} />
    </div>
    <div className="border-t">
      {Array.from({ length: rows }, (_, index) => (
        <div key={index} className="flex items-center gap-4 border-b px-5 py-5 last:border-0">
          <div className="flex-1">
            <Skeleton width={150} height={13} />
            <div className="mt-1">
              <Skeleton width={190} height={11} />
            </div>
          </div>
          <div className="hidden sm:block">
            <Skeleton width={130} height={12} />
          </div>
          <Skeleton width={70} height={20} />
          <Skeleton width={64} height={28} />
        </div>
      ))}
    </div>
  </section>
);

export const ReceiptSkeleton = () => (
  <section className="max-w-xl rounded-xl border bg-card p-6">
    <Skeleton width={150} height={28} />
    <div className="my-6">
      <Skeleton circle width={40} height={40} />
    </div>
    <Skeleton width={200} height={22} />
    <div className="my-5">
      <Skeleton width={180} height={36} />
    </div>
    {/* count rather than a loop: the library repeats the line and spaces it itself. */}
    <Skeleton count={6} height={16} className="mb-3" />
  </section>
);

export const FormSkeleton = ({ fields = 3 }: { fields?: number }) => (
  <div className="flex flex-col gap-6">
    {Array.from({ length: fields }, (_, index) => (
      <div key={index}>
        <Skeleton width={110} height={12} />
        <div className="mt-2">
          <Skeleton height={32} />
        </div>
      </div>
    ))}
    <Skeleton width={150} height={32} />
  </div>
);
