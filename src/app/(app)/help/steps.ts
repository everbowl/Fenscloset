import { getAddTips } from "@/lib/tips";
import type { HelpStep, HelpTopic } from "./content";

/** The steps a topic shows, with the photo rules folded into "Add your clothes" (the general list, then one tip per category). One place, so the card's count and the page agree. */
export async function stepsFor(topic: HelpTopic, personId: string): Promise<HelpStep[]> {
  if (topic.slug !== "add") return topic.steps;
  const tips = await getAddTips(personId);
  const before: HelpStep[] = [{ text: `Before you start: ${tips.general.join(" ")}`, cue: { kind: "icon", name: "camera" } }];
  const perPiece: HelpStep[] = tips.categories.map((c) => ({ text: `${c.name}: ${c.tip}`, cue: { kind: "tabs", active: c.name, others: [] } }));
  return [...before, ...topic.steps, ...perPiece];
}
