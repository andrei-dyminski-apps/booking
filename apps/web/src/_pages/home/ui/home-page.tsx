import { ThemeToggle } from "./theme-toggle";

export const HomePage = () => (
  <div className="mx-auto flex w-full max-w-5xl items-start justify-between gap-4 px-4 py-10">
    <div className="flex flex-col gap-1">
      <h1 className="text-2xl font-semibold tracking-tight">Booking</h1>
      <p className="text-sm text-muted-foreground">
        Rooms, dates and guests — all on one shared contract.
      </p>
    </div>
    <ThemeToggle />
  </div>
);
