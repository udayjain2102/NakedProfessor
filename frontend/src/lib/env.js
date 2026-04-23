export function getRequiredEnv(name) {
  const value = import.meta.env?.[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}
