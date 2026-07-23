import "dotenv/config";
import { createApp } from "./server.js";

const port = Number(process.env.PORT || 5173);
const host = process.env.HOST || "127.0.0.1";
const app = createApp();

try {
  await app.locals.syncConfiguredAdmin();
} catch (error) {
  console.error("Unable to synchronize configured administrator:", error);
}

app.listen(port, host, () => {
  console.log(`AI Life running at http://${host}:${port}`);
});
