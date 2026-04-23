import { createClient } from "@supabase/supabase-js";
import { existsSync, readFileSync, statSync } from "node:fs";
import { basename, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const DEFAULT_BUCKET = "professor-artifacts";
const DEFAULT_SOURCE = "public/data/top200_plus_behrend_professors.csv";
const DEFAULT_OBJECT = "top200_plus_behrend_professors.csv";
const DEFAULT_CACHE_CONTROL = "300";

function scriptDirname() {
  return fileURLToPath(new URL(".", import.meta.url));
}

function projectRoot() {
  return resolve(scriptDirname(), "..");
}

function repoRoot() {
  return resolve(projectRoot(), "..");
}

function loadEnvFile(path) {
  if (!existsSync(path)) return;

  const text = readFileSync(path, "utf8");
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const match = trimmed.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (!match) continue;

    const [, key, rawValue] = match;
    if (process.env[key] != null) continue;
    process.env[key] = rawValue.replace(/^['"]|['"]$/g, "");
  }
}

function loadLocalEnv() {
  const root = projectRoot();
  const repo = repoRoot();
  loadEnvFile(resolve(repo, ".env"));
  loadEnvFile(resolve(repo, ".env.local"));
  loadEnvFile(resolve(root, ".env"));
  loadEnvFile(resolve(root, ".env.local"));
}

function parseArgs(argv) {
  const options = {
    bucket: process.env.SUPABASE_PROFESSOR_BUCKET || DEFAULT_BUCKET,
    object: process.env.SUPABASE_PROFESSOR_OBJECT || DEFAULT_OBJECT,
    source: process.env.PROFESSOR_ARTIFACT_SOURCE || DEFAULT_SOURCE,
    cacheControl: process.env.SUPABASE_PROFESSOR_CACHE_CONTROL || DEFAULT_CACHE_CONTROL,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = argv[index + 1];
    if (arg === "--bucket" && next) {
      options.bucket = next;
      index += 1;
    } else if (arg === "--object" && next) {
      options.object = next;
      index += 1;
    } else if (arg === "--source" && next) {
      options.source = next;
      index += 1;
    } else if (arg === "--cache-control" && next) {
      options.cacheControl = next;
      index += 1;
    } else if (arg === "--help") {
      options.help = true;
    }
  }

  return options;
}

function printHelp() {
  console.log(`
Usage:
  npm run upload:professor-data -- [--source path] [--bucket name] [--object path]

Environment:
  SUPABASE_URL or VITE_SUPABASE_URL
  SUPABASE_SERVICE_ROLE_KEY

Defaults:
  --source ${DEFAULT_SOURCE}
  --bucket ${DEFAULT_BUCKET}
  --object ${DEFAULT_OBJECT}
`);
}

function getContentType(path) {
  if (path.toLowerCase().endsWith(".json")) return "application/json";
  if (path.toLowerCase().endsWith(".csv")) return "text/csv; charset=utf-8";
  return "application/octet-stream";
}

async function ensurePublicBucket(supabase, bucket) {
  const { data, error } = await supabase.storage.getBucket(bucket);
  if (!error && data) return;

  const { error: createError } = await supabase.storage.createBucket(bucket, {
    public: true,
  });
  if (createError) {
    throw new Error(`Unable to create bucket "${bucket}": ${createError.message}`);
  }
}

async function main() {
  loadLocalEnv();
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    printHelp();
    return;
  }

  const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error("Set SUPABASE_URL/VITE_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY first.");
  }
  if (serviceRoleKey === "YOUR_SERVICE_ROLE_KEY" || serviceRoleKey.startsWith("sb_publishable_")) {
    throw new Error(
      "SUPABASE_SERVICE_ROLE_KEY must be the project service-role/secret key, not the placeholder or publishable browser key."
    );
  }

  const sourcePath = resolve(projectRoot(), options.source);
  if (!existsSync(sourcePath)) {
    throw new Error(`Professor artifact not found: ${sourcePath}`);
  }

  const sourceStat = statSync(sourcePath);
  const objectPath = options.object || basename(sourcePath);
  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });

  await ensurePublicBucket(supabase, options.bucket);

  const { error: uploadError } = await supabase.storage
    .from(options.bucket)
    .upload(objectPath, readFileSync(sourcePath), {
      cacheControl: options.cacheControl,
      contentType: getContentType(sourcePath),
      upsert: true,
    });

  if (uploadError) {
    throw new Error(`Upload failed: ${uploadError.message}`);
  }

  const { data } = supabase.storage.from(options.bucket).getPublicUrl(objectPath);
  console.log(`Uploaded ${sourceStat.size.toLocaleString()} bytes.`);
  console.log(`Public URL: ${data.publicUrl}`);
  console.log(`Set VITE_PROFESSOR_ARTIFACT_PATHS=${data.publicUrl}`);
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
