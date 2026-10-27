export function readConfig(environment: NodeJS.ProcessEnv): { port: number } {
  const portText = environment.PORT ?? "3000";
  const port = Number(portText);

  if (!/^\d+$/.test(portText) || !Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error("PORT must be an integer between 1 and 65535.");
  }

  return { port };
}
