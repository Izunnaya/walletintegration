import bcrypt from "bcrypt";

// The cost is stored in each hash; benchmark it on deployment hardware before changing it.
const COST_FACTOR = 12;

export function hashPassword(plainPassword: string): Promise<string> {
  return bcrypt.hash(plainPassword, COST_FACTOR);
}

export function verifyPassword(plainPassword: string, passwordHash: string): Promise<boolean> {
  return bcrypt.compare(plainPassword, passwordHash);
}
