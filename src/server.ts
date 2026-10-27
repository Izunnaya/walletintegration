import { createApp } from "./app.ts";
import { readConfig } from "./config.ts";

const config = readConfig(process.env);
const app = createApp();

const server = app.listen(config.port, () => {
  console.info(JSON.stringify({ event: "server_started", port: config.port }));
});

server.on("error", (error: NodeJS.ErrnoException) => {
  console.error(JSON.stringify({ event: "server_error", code: error.code }));
  process.exitCode = 1;
});
