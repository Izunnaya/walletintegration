type Props = {
  title: string;
  description: string;
  eyebrow?: string;
  action?: React.ReactNode;
};

// The heading block every screen opens with. The export built this inline with a chain of
// `screen === ...` checks and a lookup table of descriptions; each page now states its own.
const PageHeading = ({ title, description, eyebrow, action }: Props) => (
  <div className="mb-8 flex flex-wrap items-start justify-between gap-4">
    <div>
      {eyebrow && (
        <div className="mb-2 flex items-center gap-2 text-xs text-muted-foreground">
          <span className="size-1.5 rounded-full bg-success" />
          {eyebrow}
        </div>
      )}
      <h1 className="text-[28px] font-semibold tracking-[-1px]">{title}</h1>
      <p className="mt-2 text-[13px] text-muted-foreground">{description}</p>
    </div>
    {action}
  </div>
);

export default PageHeading;
