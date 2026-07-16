// Relais Famiflora "L'expert des plantes"
// - POST/GET /care    : renvoie une fiche d'entretien detaillee pour une espece (genere par Claude, mise en cache)
// - POST     /identify : proxifie l'identification Pl@ntNet (garde la cle Pl@ntNet cote serveur)
//
// Les cles d'API (Claude, Pl@ntNet) restent cote serveur, jamais dans l'app.
import express from "express";
import cors from "cors";
import multer from "multer";
import Anthropic from "@anthropic-ai/sdk";
import { initCache, getCached, setCached, countCached } from "./cache.js";
import { PLANTS } from "./plants.js";

const app = express();
app.use(cors());
app.use(express.json({ limit: "1mb" }));

const client = new Anthropic(); // lit ANTHROPIC_API_KEY
const MODEL = process.env.CLAUDE_MODEL || "claude-sonnet-5";       // generations a la volee
const SEED_MODEL = process.env.SEED_MODEL || MODEL;               // pre-remplissage (qualite)
const SEED_TOKEN = process.env.SEED_TOKEN || "";                  // protege /admin/seed
const PLANTNET_KEY = process.env.PLANTNET_KEY || "";
const upload = multer({ limits: { fileSize: 8 * 1024 * 1024 } });

// ---- Schema de la fiche (sorties structurees Claude) ----------------------
const CARE_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    nomCommun: { type: "string" },
    nomScientifique: { type: "string" },
    famille: { type: "string" },
    resume: { type: "string" },
    difficulte: { type: "string", enum: ["Facile", "Moyen", "Difficile"] },
    arrosage: {
      type: "object", additionalProperties: false,
      properties: { frequence: { type: "string" }, details: { type: "string" } },
      required: ["frequence", "details"],
    },
    lumiere: {
      type: "object", additionalProperties: false,
      properties: { niveau: { type: "string" }, details: { type: "string" } },
      required: ["niveau", "details"],
    },
    temperature: {
      type: "object", additionalProperties: false,
      properties: { plage: { type: "string" }, details: { type: "string" } },
      required: ["plage", "details"],
    },
    humidite: { type: "string" },
    substrat: { type: "string" },
    engrais: { type: "string" },
    rempotage: { type: "string" },
    problemesCourants: {
      type: "array",
      items: {
        type: "object", additionalProperties: false,
        properties: {
          symptome: { type: "string" },
          cause: { type: "string" },
          remede: { type: "string" },
        },
        required: ["symptome", "cause", "remede"],
      },
    },
    toxicite: { type: "string" },
    astuceFamiflora: { type: "string" },
  },
  required: [
    "nomCommun", "nomScientifique", "famille", "resume", "difficulte",
    "arrosage", "lumiere", "temperature", "humidite", "substrat",
    "engrais", "rempotage", "problemesCourants", "toxicite", "astuceFamiflora",
  ],
};

const SYSTEM_PROMPT = `Tu es l'expert horticole de Famiflora, une grande jardinerie belge (Mouscron). On te donne le nom d'une plante identifiee par photo, et tu produis une fiche d'entretien PRECISE, PRATIQUE et SPECIFIQUE a cette espece, en francais, pour un client belge (interieur ou jardin selon la plante).

Regles:
- Sois specifique a l'espece, jamais generique. Chaque champ doit apporter une info utile et concrete (frequences reelles, temperatures en degres, gestes precis).
- Reste factuel. Si l'espece est peu connue ou incertaine, donne des conseils surs valables pour son genre/sa famille et signale l'incertitude dans "resume".
- Toxicite: si tu connais la toxicite pour animaux/enfants, indique-la clairement. Si tu ne sais pas, ecris "Donnees limitees - par prudence, tenir hors de portee des animaux et jeunes enfants."
- "astuceFamiflora": un conseil concret et un peu malin, comme le donnerait un vendeur experimente.
- Ton chaleureux mais concis. Pas de bla-bla, pas d'emoji.
- 3 a 5 entrees dans "problemesCourants", ciblees sur les soucis reels de cette plante.`;

function normalizeKey(sci) {
  return (sci || "").trim().toLowerCase().replace(/\s+/g, " ");
}

async function generateCareSheet({ sci, common, family }, model = MODEL) {
  const parts = [`Espece: ${sci || "inconnue"}`];
  if (common) parts.push(`Nom commun repere: ${common}`);
  if (family) parts.push(`Famille: ${family}`);
  const userPrompt = parts.join("\n") + "\n\nProduis la fiche d'entretien.";

  const response = await client.messages.create({
    model,
    max_tokens: 2000,
    system: SYSTEM_PROMPT,
    output_config: { format: { type: "json_schema", schema: CARE_SCHEMA } },
    messages: [{ role: "user", content: userPrompt }],
  });

  if (response.stop_reason === "refusal") {
    throw new Error("refusal");
  }
  const text = response.content.find((b) => b.type === "text")?.text;
  if (!text) throw new Error("empty response");
  return JSON.parse(text);
}

// ---- Pre-remplissage (seed) ----------------------------------------------
let seedState = { running: false, total: 0, done: 0, generated: 0, skipped: 0, errors: 0 };

async function runSeed(list, concurrency = 4) {
  seedState = { running: true, total: list.length, done: 0, generated: 0, skipped: 0, errors: 0 };
  let i = 0;
  async function worker() {
    while (i < list.length) {
      const item = list[i++];
      const key = normalizeKey(item.sci);
      try {
        const existing = await getCached(key);
        if (existing) { seedState.skipped++; }
        else {
          const sheet = await generateCareSheet(item, SEED_MODEL);
          await setCached(key, sheet);
          seedState.generated++;
        }
      } catch (e) {
        seedState.errors++;
        console.error("[seed] " + item.sci + " :", e.message);
      }
      seedState.done++;
    }
  }
  await Promise.all(Array.from({ length: concurrency }, worker));
  seedState.running = false;
  console.log(`[seed] termine : ${seedState.generated} generees, ${seedState.skipped} deja en cache, ${seedState.errors} erreurs`);
}

// ---- Routes ---------------------------------------------------------------
app.get("/", (req, res) => res.json({ service: "famiflora-plant-relay", ok: true }));

app.get("/health", async (req, res) => {
  res.json({
    ok: true,
    model: MODEL,
    seedModel: SEED_MODEL,
    plantnet: PLANTNET_KEY ? "configure" : "absent",
    fichesEnCache: await countCached().catch(() => null),
    plantesConnues: PLANTS.length,
    seed: seedState,
  });
});

// GET /care?name=Phalaenopsis%20amabilis&common=Orchidee&family=Orchidaceae
// POST /care  { name, common, family }
async function careHandler(req, res) {
  try {
    const src = req.method === "POST" ? req.body : req.query;
    const sci = (src.name || src.sci || "").toString();
    const common = (src.common || "").toString();
    const family = (src.family || "").toString();
    if (!sci) return res.status(400).json({ error: "Parametre 'name' requis (nom scientifique)." });

    const key = normalizeKey(sci);
    let sheet = await getCached(key);
    let cached = true;
    if (!sheet) {
      cached = false;
      sheet = await generateCareSheet({ sci, common, family });
      await setCached(key, sheet);
    }
    res.json({ cached, sheet });
  } catch (err) {
    console.error("[care] erreur:", err.message);
    if (err.message === "refusal") return res.status(422).json({ error: "Demande refusee." });
    res.status(500).json({ error: "Generation impossible pour le moment." });
  }
}
app.get("/care", careHandler);
app.post("/care", careHandler);

// Pre-remplit le cache avec la liste des plantes courantes (arriere-plan).
// Protege par SEED_TOKEN. Suivre l'avancement via /admin/seed-status ou /health.
function seedHandler(req, res) {
  const token = (req.query.token || (req.body && req.body.token) || "").toString();
  if (!SEED_TOKEN) return res.status(403).json({ error: "SEED_TOKEN non configure sur le serveur." });
  if (token !== SEED_TOKEN) return res.status(401).json({ error: "Token invalide." });
  if (seedState.running) return res.json({ status: "deja en cours", state: seedState });
  const list = (req.body && Array.isArray(req.body.plants) && req.body.plants.length) ? req.body.plants : PLANTS;
  runSeed(list, 4).catch((e) => console.error("[seed] fatal:", e.message));
  res.json({ status: "pre-remplissage demarre", total: list.length, model: SEED_MODEL, suivi: "/admin/seed-status" });
}
app.get("/admin/seed", seedHandler);
app.post("/admin/seed", seedHandler);
app.get("/admin/seed-status", (req, res) => res.json(seedState));

// POST /identify  (multipart form-data, champ "images")  -> proxifie Pl@ntNet
app.post("/identify", upload.single("images"), async (req, res) => {
  try {
    if (!PLANTNET_KEY) return res.status(500).json({ error: "PLANTNET_KEY non configuree." });
    if (!req.file) return res.status(400).json({ error: "Aucune image (champ 'images')." });

    const form = new FormData();
    const blob = new Blob([req.file.buffer], { type: req.file.mimetype || "image/jpeg" });
    form.append("images", blob, req.file.originalname || "photo.jpg");

    const lang = (req.query.lang || "fr").toString();
    const url =
      "https://my-api.plantnet.org/v2/identify/all" +
      `?api-key=${encodeURIComponent(PLANTNET_KEY)}` +
      `&lang=${encodeURIComponent(lang)}&nb-results=3&include-related-images=false`;

    const r = await fetch(url, { method: "POST", body: form });
    const data = await r.json().catch(() => ({}));
    res.status(r.status).json(data);
  } catch (err) {
    console.error("[identify] erreur:", err.message);
    res.status(500).json({ error: "Identification impossible pour le moment." });
  }
});

const PORT = process.env.PORT || 3000;
await initCache();
app.listen(PORT, () => console.log(`[famiflora-relay] ecoute sur :${PORT} (modele ${MODEL})`));
