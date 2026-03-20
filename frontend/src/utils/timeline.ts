import type { ActionEvent } from "../types/types";

export function buildEventLines(event: ActionEvent): string[] {
  const line1 = `${event.id} | ${event.event_type} | p.${event.page ?? "-"} | ${event.created_at}`;
  const line2 = event.selection_text ? `text: ${event.selection_text}` : "";
  const hasPayload = event.payload && Object.keys(event.payload).length > 0;
  const line3 = hasPayload ? `payload: ${JSON.stringify(event.payload)}` : "";
  return [line1, line2, line3].filter(Boolean);
}

export function createEventListItem(event: ActionEvent): HTMLLIElement {
  const item = document.createElement("li");
  for (const line of buildEventLines(event)) {
    const div = document.createElement("div");
    div.textContent = line;
    item.appendChild(div);
  }
  return item;
}
