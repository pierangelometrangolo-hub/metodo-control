import { createHash } from "crypto";

export function sha256Hex(content: Buffer): string {
  return createHash("sha256").update(content).digest("hex");
}
