import { ID_LENGTH } from "../config/constants";

export function generateId(): string {
  return crypto.randomUUID().slice(0, ID_LENGTH);
}
