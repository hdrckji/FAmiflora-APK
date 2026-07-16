// Etiquetage des plantes pour le conseiller : a partir d'un libelle produit
// (FR/NL, avec tailles de pot), Claude deduit les attributs de recommandation.
// Fait UNE fois (cote serveur) ; l'app filtre ensuite ces attributs en local.

const PLANT_ITEM = {
  type: "object",
  additionalProperties: false,
  properties: {
    id: { type: "string" },
    estPlante: { type: "boolean" },
    nom: { type: "string" },            // nom commun FR
    scientifique: { type: "string" },
    emoji: { type: "string" },
    milieu: { type: "string", enum: ["interieur", "exterieur", "les_deux"] },
    exposition: { type: "array", items: { type: "string", enum: ["soleil", "mi_ombre", "ombre"] } },
    arrosage: { type: "string", enum: ["faible", "moyen", "eleve"] },
    cycle: { type: "string", enum: ["vivace", "annuelle", "arbuste", "arbre", "grimpante", "bulbe", "aromatique", "potager", "interieur_tropical"] },
    feuillage: { type: "string", enum: ["persistant", "caduc", "na"] },
    gelResistant: { type: "boolean" },  // resiste au gel en pleine terre en Belgique
    usages: { type: "array", items: { type: "string", enum: ["cimetiere", "balcon_terrasse", "massif_jardin", "interieur", "haie", "potager", "rocaille", "bordure"] } },
    hauteur: { type: "string" },
    saisonInteret: { type: "array", items: { type: "string", enum: ["printemps", "ete", "automne", "hiver"] } },
    couleurs: { type: "array", items: { type: "string" } },
    argument: { type: "string" },       // 1 phrase : pourquoi la conseiller
  },
  required: [
    "id", "estPlante", "nom", "scientifique", "emoji", "milieu", "exposition",
    "arrosage", "cycle", "feuillage", "gelResistant", "usages", "hauteur",
    "saisonInteret", "couleurs", "argument",
  ],
};

export const RECO_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: { plantes: { type: "array", items: PLANT_ITEM } },
  required: ["plantes"],
};

export const RECO_SYSTEM = `Tu es l'expert horticole de Famiflora (jardinerie belge, Mouscron). On te donne une liste de libelles produits (en francais ET neerlandais, avec des tailles de pot type p13, C2L, P9 - a ignorer). Pour CHAQUE entree, renvoie un objet avec le MEME "id".

- Si l'entree n'est PAS une plante vivante (accessoire, semence, terreau, ail seche en tresse, arrangement, gazon en rouleau, etc.) : "estPlante": false et remplis le reste avec des valeurs neutres ("nom": le libelle, "milieu": "exterieur", "exposition": ["soleil"], "arrosage": "moyen", "cycle": "annuelle", "feuillage": "na", "gelResistant": false, "usages": [], "hauteur": "", "saisonInteret": [], "couleurs": [], "argument": "").
- Sinon identifie l'espece (traduis le neerlandais : Aardbei=fraisier, Rozemarijn=romarin, Tijm=thym, Bieslook=ciboulette, Vetplanten=succulentes, Buis=buis, Struik=arbuste...) et remplis les attributs pour la Belgique :
  - milieu: interieur (plante d'interieur), exterieur (jardin/balcon), ou les_deux.
  - exposition: ce que la plante supporte (soleil / mi_ombre / ombre), une ou plusieurs.
  - arrosage: faible (tolere l'oubli/la secheresse), moyen, ou eleve (a garder humide).
  - cycle: vivace (revient chaque annee), annuelle (une saison), arbuste, arbre, grimpante, bulbe, aromatique, potager, ou interieur_tropical.
  - feuillage: persistant (garde ses feuilles l'hiver), caduc (les perd), ou na (interieur/non pertinent).
  - gelResistant: true si elle passe l'hiver dehors en pleine terre en Belgique (rustique), false sinon.
  - usages: tous ceux qui conviennent (cimetiere = resiste, sobre, souvent chrysantheme/bruyere/cyclamen/persistant bas ; balcon_terrasse ; massif_jardin ; interieur ; haie ; potager ; rocaille ; bordure).
  - hauteur: fourchette realiste (ex "30-60 cm").
  - saisonInteret: saisons ou la plante est interessante (floraison/feuillage/vente).
  - couleurs: couleurs principales de fleur ou feuillage.
  - argument: UNE phrase de vendeur expliquant pour qui/quel usage elle est ideale.
Sois precis et factuel. Reponds pour toutes les entrees, dans l'ordre.`;

// Etiquette un lot d'entrees. `items` = [{id, sample}]. Renvoie un tableau d'objets tagues.
export async function tagBatch(client, model, items) {
  const lignes = items.map((it) => `${it.id}\t${it.sample}`).join("\n");
  const userPrompt = "Libelles (id<TAB>libelle) :\n" + lignes;
  const response = await client.messages.create({
    model,
    max_tokens: 6000,
    system: RECO_SYSTEM,
    output_config: { format: { type: "json_schema", schema: RECO_SCHEMA } },
    messages: [{ role: "user", content: userPrompt }],
  });
  if (response.stop_reason === "refusal") throw new Error("refusal");
  const text = response.content.find((b) => b.type === "text")?.text;
  if (!text) throw new Error("empty");
  const parsed = JSON.parse(text);
  return Array.isArray(parsed.plantes) ? parsed.plantes : [];
}
