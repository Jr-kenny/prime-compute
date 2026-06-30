import type { Rent, RentStatus } from "./domain";

const NON_TERMINAL: RentStatus[] = ["queued", "running", "paused"];

export function canPause(rent: Rent): boolean {
  return rent.status === "running";
}

export function canResume(rent: Rent): boolean {
  return rent.status === "paused";
}

export function canCancel(rent: Rent): boolean {
  return NON_TERMINAL.includes(rent.status);
}
