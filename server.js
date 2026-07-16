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

const app = express();
app.use(cors());
app.use(express.json({ limit: "1mb" }));

const client = new Anthropic(); // lit ANTHROPIC_API_KEY
const MODEL = process.env.CLAUDE_MODEL || "claude-sonnet-5";
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

async function generateCareSheet({ sci, common, family }) {
  const parts = [`Espece: ${sci || "inconnue"}`];
  if (common) parts.push(`Nom commun repere: ${common}`);
  if (family) parts.push(`Famille: ${family}`);
  const userPrompt = parts.join("\n") + "\n\nProduis la fiche d'entretien.";

  const response = await client.messages.create({
    model: MODEL,
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

// ---- Routes ---------------------------------------------------------------
app.get("/", (req, res) => res.json({ service: "famiflora-plant-relay", ok: true }));

app.get("/health", async (req, res) => {
  res.json({
    ok: true,
    model: MODEL,
    plantnet: PLANTNET_KEY ? "configure" : "absent",
    fichesEnCache: await countCached().catch(() => null),
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
