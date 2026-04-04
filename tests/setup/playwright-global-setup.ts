import { resetPlaywrightTestDatabase } from "./playwright-env";

export default async function globalSetup(): Promise<void> {
  resetPlaywrightTestDatabase();
}
