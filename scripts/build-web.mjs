import { build, context } from "esbuild";
import { copyFile, cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { parseArgs, parseEnv } from "node:util";

const { values } = parseArgs({
  options: {
    dev: { type: "boolean" },
    preview: { type: "boolean" },
    host: { type: "string" },
    port: { type: "string" },
  },
});
const { dev, preview } = values;
if (dev && preview) throw new Error("Choose either dev or preview");

const port = Number(values.port ?? (preview ? 4173 : 5173));
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("Invalid web server port");

if (preview) {
  await readFile("dist/index.html");
  await serve(await context({}), "dist");
} else {
  const mode = dev ? "development" : "production";
  const directory = dev ? ".web-dev" : "dist";
  await rm(directory, { recursive: true, force: true });
  await mkdir(directory, { recursive: true });
  await cp("public", directory, { recursive: true });
  await copyFile("docs/openapi.json", directory + "/openapi.json");

  const env = {};
  for (const path of [".env", ".env.local", ".env." + mode, ".env." + mode + ".local"]) {
    try {
      Object.assign(env, parseEnv(await readFile(path, "utf8")));
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
  }
  const publicKeys = ["VITE_SUPABASE_URL", "VITE_SUPABASE_PUBLISHABLE_KEY", "VITE_API_URL"];
  const publicEnv = Object.fromEntries(publicKeys.map(key => [key, process.env[key] ?? env[key]]));
  const options = {
    entryPoints: { app: "apps/web/main.tsx" },
    outdir: directory + "/assets",
    entryNames: dev ? "[name]" : "[name]-[hash]",
    format: "esm",
    target: "es2022",
    jsx: "automatic",
    bundle: true,
    splitting: true,
    minify: !dev,
    metafile: true,
    define: {
      "import.meta.env": JSON.stringify(publicEnv),
      "process.env.NODE_ENV": JSON.stringify(mode),
    },
    plugins: [{
      name: "web-entry-html",
      setup(builder) {
        builder.onEnd(async result => {
          if (result.errors.length) return;
          const prefix = directory + "/";
          const js = Object.entries(result.metafile.outputs).find(([, output]) =>
            output.entryPoint === "apps/web/main.tsx");
          if (!js?.[1].cssBundle) throw new Error("Expected JS and CSS from the web entry point");
          const css = js[1].cssBundle.slice(prefix.length);
          const script = js[0].slice(prefix.length);
          const template = await readFile("index.html", "utf8");
          await writeFile(directory + "/index.html", template
            .replace("</head>", `<link rel="stylesheet" href="/${css}"></head>`)
            .replace('src="/apps/web/main.tsx"', `src="/${script}"`));
        });
      },
    }],
  };

  if (dev) {
    const server = await context(options);
    await server.rebuild();
    await server.watch();
    await serve(server, directory);
  } else {
    await build(options);
  }
}

async function serve(server, directory) {
  const host = values.host ?? "127.0.0.1";
  await server.serve({ host, port, servedir: directory, fallback: resolve(directory, "index.html") });
  console.log(`Avtalslänk is available at http://${host}:${port}/`);
  process.once("SIGINT", () => void server.dispose());
  process.once("SIGTERM", () => void server.dispose());
}
