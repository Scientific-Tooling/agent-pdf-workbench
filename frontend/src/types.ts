export interface PaperSession {
  id: string;
  paper_ref: string;
  pdf_uri: string;
  agent_id: string;
  user_id: string;
  metadata: Record<string, unknown>;
  opened_at: string;
  closed_at: string | null;
}

export interface ActionEvent {
  id: number;
  session_id: string;
  event_type: string;
  page: number | null;
  selection_text: string | null;
  payload: Record<string, unknown>;
  source: string;
  created_at: string;
}

export interface ListActionsResponse {
  session_id: string;
  count: number;
  events: ActionEvent[];
}

export interface RecordActionParams {
  page?: number | null;
  selectionText?: string | null;
  payload?: Record<string, unknown> | null;
}
