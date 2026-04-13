import path from "path";
import fs from "fs";
import chalk from "chalk";
import { Document } from "@langchain/core/documents";
import { MemoryVectorStore } from "@langchain/classic/vectorstores/memory";
import { RecursiveCharacterTextSplitter } from "@langchain/textsplitters";
import { GoogleGenerativeAIEmbeddings } from "@langchain/google-genai";
import { logger } from "../utils/logger.js";
import { loadAgentEnv } from "../utils/config.js";
import type { EmbeddingStore } from "../core/types.js";

// ─── File Loading ─────────────────────────────────────────────────────────────

const SUPPORTED_EXTENSIONS = [
  ".txt",
  ".md",
  ".csv",
  ".json",
  ".html",
  ".xml",
  ".pdf",
];

function loadFiles(dirPath: string): Document[] {
  const results: Document[] = [];

  function walk(dir: string) {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (!entry.name.startsWith(".") && entry.name !== "node_modules") {
          walk(fullPath);
        }
      } else if (
        SUPPORTED_EXTENSIONS.includes(path.extname(entry.name).toLowerCase())
      ) {
        try {
          const content = fs.readFileSync(fullPath, "utf-8");
          results.push(
            new Document({
              pageContent: content,
              metadata: { source: path.relative(dirPath, fullPath) },
            }),
          );
        } catch (e: any) {
          console.warn(`  Skipped ${fullPath}: ${e.message}`);
        }
      }
    }
  }

  walk(dirPath);
  return results;
}

// ─── LangChain Embeddings Instance ────────────────────────────────────────────

export function createEmbeddings(apiKey: string): GoogleGenerativeAIEmbeddings {
  return new GoogleGenerativeAIEmbeddings({
    apiKey,
    model: "text-embedding-004",
  });
}

// ─── Vector Store Persistence ─────────────────────────────────────────────────

function saveStore(store: EmbeddingStore, agentDir: string): void {
  const storeDir = path.join(agentDir, ".blockbot");
  fs.mkdirSync(storeDir, { recursive: true });
  const storePath = path.join(storeDir, "embeddings.json");
  fs.writeFileSync(storePath, JSON.stringify(store));
}

export function loadEmbeddingStore(agentDir: string): EmbeddingStore | null {
  const storePath = path.join(agentDir, ".blockbot", "embeddings.json");
  if (!fs.existsSync(storePath)) return null;
  try {
    return JSON.parse(fs.readFileSync(storePath, "utf-8"));
  } catch {
    return null;
  }
}

// ─── Reconstruct LangChain MemoryVectorStore from serialized data ─────────────

export async function loadVectorStoreFromDisk(
  agentDir: string,
  apiKey: string,
): Promise<MemoryVectorStore | null> {
  const store = loadEmbeddingStore(agentDir);
  if (!store) return null;

  const embeddings = createEmbeddings(apiKey);
  const vectorStore = new MemoryVectorStore(embeddings);

  const docs = store.documents.map(
    (d) => new Document({ pageContent: d.pageContent, metadata: d.metadata }),
  );

  // addVectors re-uses pre-computed vectors — no re-embedding needed
  await vectorStore.addVectors(store.vectors, docs);

  logger.success(
    `Loaded vector store: ${docs.length} chunks (${store.dimensions}-dim, model: ${store.model})`,
  );
  return vectorStore;
}

// ─── Index Command ────────────────────────────────────────────────────────────

export async function indexCommand(
  dataPath: string,
  options: { dir?: string },
): Promise<void> {
  logger.banner();

  const agentDir = options.dir || process.cwd();
  const resolvedDataPath = path.resolve(dataPath);

  // Validate data path
  if (!fs.existsSync(resolvedDataPath)) {
    console.error(chalk.red(`  ✗ Path not found: ${resolvedDataPath}`));
    process.exit(1);
  }

  // Get Gemini API key
  const env = (() => {
    try {
      return loadAgentEnv(agentDir);
    } catch {
      return {} as Record<string, string>;
    }
  })();
  const geminiKey = env.GEMINI_API_KEY || process.env.GEMINI_API_KEY;

  if (!geminiKey) {
    console.error(chalk.red("  ✗ GEMINI_API_KEY not found"));
    console.error(
      chalk.gray("    Set it in .env or run: export GEMINI_API_KEY=..."),
    );
    process.exit(1);
  }

  // ── Step 1: Load files ──────────────────────────────────────────────────────
  console.log(chalk.cyan("  [1/3] Loading files..."));

  let docs: Document[];
  const stat = fs.statSync(resolvedDataPath);

  if (stat.isDirectory()) {
    docs = loadFiles(resolvedDataPath);
  } else {
    const content = fs.readFileSync(resolvedDataPath, "utf-8");
    docs = [
      new Document({
        pageContent: content,
        metadata: { source: path.basename(resolvedDataPath) },
      }),
    ];
  }

  if (docs.length === 0) {
    console.error(
      chalk.red(
        "  ✗ No supported files found (.txt, .md, .csv, .json, .html, .xml)",
      ),
    );
    process.exit(1);
  }

  logger.success(`Loaded ${docs.length} file(s)`);
  for (const doc of docs) {
    logger.arrow(`${doc.metadata.source} (${doc.pageContent.length} chars)`);
  }

  // ── Step 2: Split into chunks with LangChain ───────────────────────────────
  console.log();
  console.log(
    chalk.cyan(
      "  [2/3] Splitting into chunks (LangChain RecursiveCharacterTextSplitter)...",
    ),
  );

  const splitter = new RecursiveCharacterTextSplitter({
    chunkSize: 500,
    chunkOverlap: 100,
    separators: ["\n\n", "\n", ". ", " ", ""],
  });

  const splitDocs = await splitter.splitDocuments(docs);
  logger.success(`Created ${splitDocs.length} chunks`);

  // ── Step 3: Embed with LangChain + Google Generative AI ─────────────────────
  console.log();
  console.log(
    chalk.cyan(
      "  [3/3] Embedding with Google text-embedding-004 (via LangChain)...",
    ),
  );

  const embeddings = createEmbeddings(geminiKey);

  // Embed in batches for progress reporting
  const BATCH_SIZE = 100;
  const allVectors: number[][] = [];

  for (let i = 0; i < splitDocs.length; i += BATCH_SIZE) {
    const batch = splitDocs.slice(i, i + BATCH_SIZE);
    const batchTexts = batch.map((d) => d.pageContent);
    const batchVectors = await embeddings.embedDocuments(batchTexts);
    allVectors.push(...batchVectors);

    const done = Math.min(i + BATCH_SIZE, splitDocs.length);
    console.log(
      chalk.gray(`    Embedded ${done}/${splitDocs.length} chunks...`),
    );

    // Rate limit pause between batches
    if (i + BATCH_SIZE < splitDocs.length) {
      await new Promise((r) => setTimeout(r, 200));
    }
  }

  logger.success(
    `Generated ${allVectors.length} embeddings (${allVectors[0]?.length || 0} dimensions)`,
  );

  // Build serializable store (documents + vectors stored separately)
  const store: EmbeddingStore = {
    model: "text-embedding-004",
    dimensions: allVectors[0]?.length || 768,
    documents: splitDocs.map((d) => ({
      pageContent: d.pageContent,
      metadata: d.metadata,
    })),
    vectors: allVectors,
    createdAt: new Date().toISOString(),
  };

  // Save to disk
  saveStore(store, agentDir);

  const sizeKb = (Buffer.byteLength(JSON.stringify(store)) / 1024).toFixed(1);
  logger.success(`Saved to .blockbot/embeddings.json (${sizeKb} KB)`);

  // Done
  console.log();
  console.log(chalk.cyan("  " + "─".repeat(54)));
  console.log(
    chalk.green.bold(
      `  Indexed ${splitDocs.length} chunks from ${docs.length} file(s) ✓`,
    ),
  );
  console.log(chalk.cyan("  " + "─".repeat(54)));
  console.log();
  console.log(
    chalk.gray("  Run ") +
      chalk.white("blockbot serve") +
      chalk.gray(" to start serving queries"),
  );
  console.log();
}
