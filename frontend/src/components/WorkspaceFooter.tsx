// The design closes every screen with one quiet line. The service indicator that used to
// live here moved to the top bar, where the design puts it, so this is only the wordmark.
const WorkspaceFooter = () => (
  <footer className="mt-10 flex flex-wrap items-center justify-between gap-3 border-t pt-5 text-[10px] text-muted-foreground">
    <span>
      Folio workspace
      <span className="mx-2">·</span>
      Every transfer is recorded and reconciled.
    </span>
    <span>NGN · Nigerian Naira</span>
  </footer>
);
export default WorkspaceFooter;
