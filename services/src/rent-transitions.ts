import type { Rent, RentStatus } from "./domain";

const NON_TERMINAL: RentStatus[] = ["queued", "running", "paused", "suspended"];

export function canPause(rent: Rent): boolean {
  return rent.status === "running";
}

export function canResume(rent: Rent): boolean {
  return rent.status === "paused" || rent.status === "suspended";
}

export function canCancel(rent: Rent): boolean {
  return NON_TERMINAL.includes(rent.status);
}
