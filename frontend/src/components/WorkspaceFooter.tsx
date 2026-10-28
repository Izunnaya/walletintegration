import { useNavigate } from "react-router-dom";
import { useWorkspace } from "@/components/WorkspaceProvider";

// The role selector is the only preview control left here.
//
// The export also had a "Preview state" selector with Loading and Empty options, which
// existed because nothing was fetching: loading had to be faked to be seen. The screens now
// read isPending from their query and render the empty case when the list comes back empty,
// so both states are real and the selector would only let someone lie about them.

const WorkspaceFooter = () => {
  const { role, setRole } = useWorkspace();
  const navigate = useNavigate();

  return (
    <footer className="mt-10 flex flex-wrap items-center justify-between gap-3 border-t pt-5 text-[10px] text-muted-foreground">
      <span>
        Folio workspace <span className="mx-2">·</span> Interactive demo. No real funds.
        Changes reset on reload.
      </span>
      <label className="flex items-center gap-2">
        Preview role
        <select
          aria-label="Preview role"
          className="rounded border bg-background px-2 py-1 text-foreground"
          value={role}
          onChange={(event) => {
            setRole(event.target.value === "user" ? "user" : "admin");
            // Leaving the admin role while on an admin screen would otherwise sit on a route
            // the nav no longer offers.
            navigate("/");
          }}
        >
          <option value="admin">Admin</option>
          <option value="user">User</option>
        </select>
      </label>
    </footer>
  );
};

export default WorkspaceFooter;
