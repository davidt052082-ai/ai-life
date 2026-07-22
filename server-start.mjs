import "dotenv/config";
import { createApp } from "./server.js";

const port = Number(process.env.PORT || 5173);
const host = process.env.HOST || "127.0.0.1";

createApp().listen(port, host, () => {
  console.log(`AI Life running at http://${host}:${port}`);
});
