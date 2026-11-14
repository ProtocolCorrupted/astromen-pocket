export type SourceFile = { path: string; content: string };
export type Message = { id: string; role: 'user' | 'assistant'; content: string; model?: string; status?: 'error' | 'cancelled'; baseFiles?: SourceFile[]; usage?: { prompt_tokens?: number; completion_tokens?: number }; truncated?: boolean };
export type Checkpoint = { id: string; at: number; label: string; files: SourceFile[] };
export type Project = { id: string; name: string; description: string; template: string; files: SourceFile[]; messages: Message[]; history: Checkpoint[]; updatedAt: number; createdAt: number };
export type Model = { id: string; label: string; contextWindow: number | null; maxOutputTokens: number | null; available: boolean; verified: boolean; source: string };
export type Status = { configured: boolean; models: Model[]; message: string };
export type Connection = { url: string; token: string };
