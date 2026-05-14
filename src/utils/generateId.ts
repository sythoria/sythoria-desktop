import { ID_LENGTH } from "../config/constants";

export function generateId(): string {
  if (typeof crypto !== "undefined" && crypto.randomUUID) {
    return crypto.randomUUID().slice(0, ID_LENGTH);
  }
  return Math.random().toString(36).substring(2, 2 + ID_LENGTH);
}
