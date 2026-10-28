import { toast } from "sonner";

export const notify = {
  success(message: string, description?: string) {
    toast.success(message, { description, duration: 4000 });
  },
  error(error: unknown, fallback = "The request could not be completed.") {
    const message = error instanceof Error ? error.message : fallback;
    toast.error(message, { duration: 10000 });
  },
};
