import apiClient from './client';

export type ChatRole = 'user' | 'assistant';

export interface ChatAction {
  tool: 'create_transaction' | 'update_transactions' | string;
  summary: string;
  count: number;
  ids?: number[];
  changes?: Record<string, unknown>;
}

export interface ChatMessage {
  id: number;
  conversation_id: number;
  role: ChatRole;
  content: string;
  actions?: ChatAction[] | null;
  created_at: string;
}

export interface ChatConversation {
  id: number;
  workspace_id: number;
  user_id: number;
  title: string;
  created_at: string;
  updated_at: string;
  message_count?: number;
  messages?: ChatMessage[];
}

export interface SendChatMessageResponse {
  conversation: ChatConversation;
  user_message: ChatMessage;
  assistant_message: ChatMessage;
}

const base = (workspaceId: number) => `/workspaces/${workspaceId}/chat/conversations`;

export const chatApi = {
  list: async (workspaceId: number): Promise<{ conversations: ChatConversation[] }> => {
    const response = await apiClient.get<{ conversations: ChatConversation[] }>(base(workspaceId));
    return response.data;
  },

  create: async (workspaceId: number, title?: string): Promise<{ conversation: ChatConversation }> => {
    const response = await apiClient.post<{ conversation: ChatConversation }>(base(workspaceId), { title: title ?? '' });
    return response.data;
  },

  get: async (workspaceId: number, conversationId: number): Promise<{ conversation: ChatConversation }> => {
    const response = await apiClient.get<{ conversation: ChatConversation }>(`${base(workspaceId)}/${conversationId}`);
    return response.data;
  },

  rename: async (workspaceId: number, conversationId: number, title: string): Promise<{ conversation: ChatConversation }> => {
    const response = await apiClient.patch<{ conversation: ChatConversation }>(`${base(workspaceId)}/${conversationId}`, { title });
    return response.data;
  },

  delete: async (workspaceId: number, conversationId: number): Promise<void> => {
    await apiClient.delete(`${base(workspaceId)}/${conversationId}`);
  },

  sendMessage: async (workspaceId: number, conversationId: number, content: string): Promise<SendChatMessageResponse> => {
    const response = await apiClient.post<SendChatMessageResponse>(
      `${base(workspaceId)}/${conversationId}/messages`,
      { content },
      { timeout: 180000 }
    );
    return response.data;
  },
};
