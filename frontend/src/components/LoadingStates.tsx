import { useEffect, useState } from "react";
import Skeleton from "react-loading-skeleton";
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
      This is taking longer than usual. Please keep this page open.
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
        <div
          key={index}
          className="flex items-center gap-4 border-b px-6 py-4 last:border-0"
        >
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

    <Skeleton count={6} height={16} className="mb-3" />
  </section>
);
export const RouteFallback = () => (
  <div aria-busy="true">
    <Skeleton width={220} height={28} />
    <div className="mt-2 mb-8">
      <Skeleton width={320} height={13} />
    </div>
    <Skeleton height={190} className="mb-7" />
    <Skeleton height={260} />
  </div>
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
