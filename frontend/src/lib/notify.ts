import { toast } from "sonner";
import { ApiError } from "@/api/types";

// Every notification in the application goes through here.
//
// sonner is the library - it was already the dependency, it is what shadcn/ui ships with,
// and a second toast library would mean two stacking contexts and two sets of styling for
// the same job. What was missing was not a library but a policy: calls were scattered across
// components, the wording drifted between them, and the useful part of a failure - the
// request ID - was dropped on the floor every time.
//
// So this module decides three things in one place:
//
//   What a failure says. An ApiError carries a code and a request ID. The ID is what a user
//   quotes when they report that a transfer did not work, and it is the only thing that ties
//   their report to a line in the server log. It goes in the description, always.
//
//   What gets announced at all. A notification is for something that happened and that the
//   user would want confirmed or would be surprised by. Not for validation messages, which
//   belong beside the field, and not for a failure already shown in a dialog the user is
//   looking at.
//
//   How long it stays. A success is read in passing. A failure carries an ID somebody may
//   need to copy, so it stays long enough to do that.

const SUCCESS_MS = 4000;
const FAILURE_MS = 10000;

function describe(error: unknown, fallback: string): { message: string; description?: string } {
  if (error instanceof ApiError) {
    return {
      message: error.message,
      ...(error.requestId ? { description: `Request ID: ${error.requestId}` } : {}),
    };
  }
  if (error instanceof Error && error.message) {
    return { message: error.message };
  }
  return { message: fallback };
}

export const notify = {
  success(message: string, description?: string) {
    toast.success(message, { duration: SUCCESS_MS, ...(description ? { description } : {}) });
  },

  // Takes the error itself rather than a pre-formatted string, so the request ID cannot be
  // lost by a caller that forgot to include it.
  error(error: unknown, fallback = "Something went wrong. Please try again.") {
    const { message, description } = describe(error, fallback);
    toast.error(message, { duration: FAILURE_MS, ...(description ? { description } : {}) });
  },

  // For an outcome that is neither. The transfer whose result the server could not confirm
  // is the case this exists for: calling it an error would be a lie, because it may well
  // have succeeded, and calling it a success would be a worse one.
  warning(message: string, description?: string) {
    toast.warning(message, { duration: FAILURE_MS, ...(description ? { description } : {}) });
  },

  info(message: string, description?: string) {
    toast(message, { duration: SUCCESS_MS, ...(description ? { description } : {}) });
  },

  // One toast that becomes the outcome, rather than a spinner toast and then a second one.
  // Used where the wait is worth showing and the screen has nowhere else to show it.
  promise<T>(
    work: Promise<T>,
    messages: { loading: string; success: string | ((value: T) => string); failure?: string },
  ) {
    return toast.promise(work, {
      loading: messages.loading,
      success: messages.success,
      error: (error: unknown) => describe(error, messages.failure ?? "That did not work.").message,
      duration: SUCCESS_MS,
    });
  },
};
