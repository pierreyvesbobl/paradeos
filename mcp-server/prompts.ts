/**
 * Templates de prompts MCP — Claude les voit comme des "raccourcis"
 * que l'utilisateur peut invoquer (slash commands en général).
 */

export const PROMPTS = [
  {
    name: "plan_my_week",
    description:
      "Génère un plan de semaine actionnable depuis tes tâches en retard, à venir, meetings et relances commerciales.",
    arguments: [],
  },
  {
    name: "project_summary",
    description:
      "Synthèse markdown propre d'un projet (copy-pastable dans un mail/slack) — entité, status, prochaines étapes, derniers meetings.",
    arguments: [
      { name: "project_id_or_name", description: "ID UUID ou nom du projet", required: true },
    ],
  },
  {
    name: "commercial_brief",
    description: "Liste les projets commerciaux à relancer (followUpDate dépassée).",
    arguments: [],
  },
];

export function getPromptMessages(
  name: string,
  args: Record<string, string>,
): {
  description: string;
  messages: Array<{ role: "user" | "assistant"; content: { type: "text"; text: string } }>;
} {
  switch (name) {
    case "plan_my_week":
      return {
        description: "Plan de semaine",
        messages: [
          {
            role: "user",
            content: {
              type: "text",
              text: `Aide-moi à organiser ma semaine. Utilise les tools MCP pour récupérer :
1. mes tâches en retard (\`paradeos://tasks/overdue\`),
2. mes tâches à échéance dans les 7 prochains jours (\`list_my_tasks\` filtré),
3. les meetings prévus (\`list_meetings\` since=aujourd'hui),
4. les projets commerciaux dont \`followUpDate\` est dépassée ou prévue cette semaine (\`list_projects\` status=to_follow_up/awaiting_response).

Puis propose un plan jour par jour (lundi à vendredi) avec :
- Les rendez-vous bloqués
- Les tâches à attaquer en priorité
- Les relances commerciales à faire
- Estimation du temps par bloc

Reste pragmatique, pas plus de 3-4 tâches par jour, et bloque du temps profond pour les projets délivery.`,
            },
          },
        ],
      };

    case "project_summary": {
      const ref = args.project_id_or_name ?? "";
      return {
        description: `Synthèse projet ${ref}`,
        messages: [
          {
            role: "user",
            content: {
              type: "text",
              text: `Génère une synthèse markdown du projet "${ref}". Utilise \`get_project\` pour récupérer la fiche, puis \`list_meetings\` (3 derniers) pour le contexte récent.

Format attendu :
- Titre : nom du projet (et entité si client)
- Statut + dates clés (1 ligne)
- État actuel (2-3 phrases)
- Prochaines étapes (3 bullets)
- Derniers échanges (1 bullet par meeting récent)

Reste factuel, pas de superlatifs. Cible : copy-paste direct dans un mail interne ou slack.`,
            },
          },
        ],
      };
    }

    case "commercial_brief":
      return {
        description: "Brief commercial — relances à faire",
        messages: [
          {
            role: "user",
            content: {
              type: "text",
              text: `Liste mes projets commerciaux à relancer. Pour ça :
1. \`list_projects\` avec status="to_follow_up" et "awaiting_response"
2. Pour chacun, donne : nom, entité, dernière date de contact, montant estimé, raison de la relance
3. Trie par urgence (followUpDate dépassée d'abord)

Format : tableau markdown compact avec colonnes : Projet · Entité · À faire · Échéance.`,
            },
          },
        ],
      };

    default:
      throw new Error(`Prompt inconnu : ${name}`);
  }
}
