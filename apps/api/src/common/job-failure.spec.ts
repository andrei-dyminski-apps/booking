import { logJobFailure } from "./job-failure";
import { RetryLaterError } from "./retry-later.error";

class HeldElsewhereError extends RetryLaterError {}

const job = {
  name: "refund-cancellation",
  id: "refund-1",
  attemptsMade: 1,
  opts: { attempts: 5 },
};

describe("logJobFailure", () => {
  const logged: { level: "warn" | "error"; message: string; stack?: string }[] =
    [];
  const logger = {
    warn: (message: string) => {
      logged.push({ level: "warn", message });
    },
    error: (message: string, stack?: string) => {
      logged.push({ level: "error", message, stack });
    },
  };

  beforeEach(() => {
    logged.length = 0;
  });

  it("logs a run that found the lease taken as a warning, without a stack", () => {
    logJobFailure(logger, job, new HeldElsewhereError("held by another run"));

    expect(logged).toEqual([
      {
        level: "warn",
        message:
          "Job refund-cancellation (refund-1) failed on attempt 1 of 5: held by another run",
      },
    ]);
  });

  it("logs any other failure as an error with its stack", () => {
    const error = new Error("api_connection_error");

    logJobFailure(logger, job, error);

    expect(logged).toEqual([
      {
        level: "error",
        message:
          "Job refund-cancellation (refund-1) failed on attempt 1 of 5: api_connection_error",
        stack: error.stack,
      },
    ]);
  });
});
