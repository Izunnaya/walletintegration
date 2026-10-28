import { toast } from "sonner";
import { ApiError } from "@/api/contracts";

export const notify = {
  success(message: string, description?: string) {
    toast.success(message, { description, duration: 4000 });
  },
  error(error: unknown, fallback = "The request could not be completed.") {
    const message = error instanceof Error ? error.message : fallback;
    const description =
      error instanceof ApiError && error.requestId
        ? `Request ID: ${error.requestId}`
        : undefined;
    toast.error(message, { description, duration: 10000 });
  },
};
