import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { format, isToday, isYesterday, parseISO } from 'date-fns';
import { isAxiosError } from 'axios';
import { chatApi, type ChatAction, type ChatConversation, type ChatMessage } from '../api/chat';
import { useWorkspaceStore } from '../store/workspaceSlice';
import { useAuthStore } from '../store/authSlice';
import { MarkdownMessage } from '../components/chat/MarkdownMessage';

const SUGGESTIONS = [
  '¿En qué gasté más este mes comparado con el anterior?',
  'Give me 3 concrete tips to reduce my spending',
  'Etiquetá todas las transacciones de MERCADOPAGO*UBER como Transporte',
  'Show my uncategorized transactions from last month and suggest categories',
  'Cargá un gasto de $12.500 en la verdulería de hoy',
  '¿Qué gastos recurrentes podría revisar o recortar?',
];

// Query keys whose data can change when the assistant creates or edits transactions.
const DATA_QUERY_KEYS = [
  'transactions',
  'summary',
  'yearly-summary',
  'areaSummary',
  'yearly-area-summary',
  'categories',
  'categoriesList',
  'areas',
  'recurringExpenses',
  'recurringExpensesSummary',
];

function errorMessage(error: unknown): string {
  if (isAxiosError(error)) {
    const msg = (error.response?.data as { error?: string } | undefined)?.error;
    if (msg) return msg;
    if (error.code === 'ECONNABORTED') return 'The AI took too long to answer. Please try again.';
  }
  return 'Something went wrong. Please try again.';
}

function formatListDate(value: string): string {
  const date = parseISO(value);
  if (isToday(date)) return format(date, 'HH:mm');
  if (isYesterday(date)) return 'Yesterday';
  return format(date, 'd MMM');
}

export function ChatPage() {
  const currentWorkspace = useWorkspaceStore((state) => state.currentWorkspace);
  const user = useAuthStore((state) => state.user);
  const workspaceId = currentWorkspace?.id;
  const queryClient = useQueryClient();

  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [draft, setDraft] = useState('');
  const [pendingMessage, setPendingMessage] = useState<string | null>(null);
  const [sendError, setSendError] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editingTitle, setEditingTitle] = useState('');

  const threadEndRef = useRef<HTMLDivElement>(null);
  const composerRef = useRef<HTMLTextAreaElement>(null);

  // Reset selection when switching workspaces.
  useEffect(() => {
    setSelectedId(null);
    setPendingMessage(null);
    setSendError(null);
  }, [workspaceId]);

  const { data: listData, isLoading: isListLoading } = useQuery({
    queryKey: ['chatConversations', workspaceId],
    queryFn: () => chatApi.list(workspaceId!),
    enabled: !!workspaceId,
  });
  const conversations = listData?.conversations ?? [];

  const { data: conversationData, isLoading: isThreadLoading } = useQuery({
    queryKey: ['chatConversation', workspaceId, selectedId],
    queryFn: () => chatApi.get(workspaceId!, selectedId!),
    enabled: !!workspaceId && selectedId !== null,
  });
  const messages: ChatMessage[] = conversationData?.conversation.messages ?? [];
  const activeConversation =
    conversationData?.conversation ?? conversations.find((c) => c.id === selectedId) ?? null;

  const invalidateList = () => queryClient.invalidateQueries({ queryKey: ['chatConversations', workspaceId] });

  const sendMutation = useMutation({
    mutationFn: async (content: string) => {
      let conversationId = selectedId;
      if (conversationId === null) {
        const { conversation } = await chatApi.create(workspaceId!);
        conversationId = conversation.id;
        queryClient.setQueryData(['chatConversation', workspaceId, conversation.id], {
          conversation: { ...conversation, messages: [] },
        });
        setSelectedId(conversation.id);
        invalidateList();
      }
      return chatApi.sendMessage(workspaceId!, conversationId, content);
    },
    onMutate: (content) => {
      setPendingMessage(content);
      setSendError(null);
      setDraft('');
    },
    onSuccess: (result) => {
      const key = ['chatConversation', workspaceId, result.conversation.id];
      queryClient.setQueryData<{ conversation: ChatConversation }>(key, (old) => ({
        conversation: {
          ...(old?.conversation ?? result.conversation),
          title: result.conversation.title,
          updated_at: result.conversation.updated_at,
          messages: [
            ...(old?.conversation.messages ?? []).filter(
              (m) => m.id !== result.user_message.id && m.id !== result.assistant_message.id
            ),
            result.user_message,
            result.assistant_message,
          ],
        },
      }));
      invalidateList();
      if (result.assistant_message.actions?.length) {
        DATA_QUERY_KEYS.forEach((key) => queryClient.invalidateQueries({ queryKey: [key] }));
      }
    },
    onError: (error, content) => {
      setSendError(errorMessage(error));
      setDraft((current) => current || content);
    },
    onSettled: () => {
      setPendingMessage(null);
      composerRef.current?.focus();
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => chatApi.delete(workspaceId!, id),
    onSuccess: (_, id) => {
      if (id === selectedId) setSelectedId(null);
      queryClient.removeQueries({ queryKey: ['chatConversation', workspaceId, id] });
      invalidateList();
    },
  });

  const renameMutation = useMutation({
    mutationFn: ({ id, title }: { id: number; title: string }) => chatApi.rename(workspaceId!, id, title),
    onSuccess: (_, { id }) => {
      invalidateList();
      queryClient.invalidateQueries({ queryKey: ['chatConversation', workspaceId, id] });
    },
  });

  // Keep the newest message in view.
  useEffect(() => {
    threadEndRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [messages.length, pendingMessage, selectedId]);

  // Auto-grow the composer.
  useEffect(() => {
    const el = composerRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 200)}px`;
  }, [draft]);

  const isSending = sendMutation.isPending;

  const send = (text?: string) => {
    const content = (text ?? draft).trim();
    if (!content || isSending || !workspaceId) return;
    sendMutation.mutate(content);
  };

  const handleComposerKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      send();
    }
  };

  const startNewChat = () => {
    if (isSending) return;
    setSelectedId(null);
    setSendError(null);
    setDraft('');
    composerRef.current?.focus();
  };

  const handleDelete = (conversation: ChatConversation) => {
    if (window.confirm(`Delete "${conversation.title}"? This cannot be undone.`)) {
      deleteMutation.mutate(conversation.id);
    }
  };

  const commitRename = () => {
    if (editingId === null) return;
    const title = editingTitle.trim();
    const original = conversations.find((c) => c.id === editingId)?.title;
    if (title && title !== original) renameMutation.mutate({ id: editingId, title });
    setEditingId(null);
  };

  if (!currentWorkspace) {
    return (
      <div className="flex flex-col items-center justify-center h-64">
        <span className="material-symbols-outlined text-6xl text-on-surface-variant opacity-30 mb-4">forum</span>
        <h2 className="text-xl font-headline font-bold text-on-surface-variant">No Workspace Selected</h2>
        <p className="text-on-surface-variant mt-2">Create or select a workspace to start chatting</p>
      </div>
    );
  }

  const showEmptyState = !pendingMessage && messages.length === 0 && !(selectedId !== null && isThreadLoading);

  return (
    <div className="max-w-7xl mx-auto">
      <header className="mb-6">
        <h1 className="text-4xl font-headline font-extrabold tracking-tight text-on-surface">AI Chat</h1>
        <p className="mt-2 text-on-surface-variant font-medium">
          Ask about your spending in {currentWorkspace.name} and get data-grounded tips.
        </p>
      </header>

      <div className="grid grid-cols-1 lg:grid-cols-[280px_minmax(0,1fr)] gap-6 lg:h-[calc(100vh-12rem)] lg:min-h-[520px]">
        {/* Conversation list */}
        <aside className="bg-surface-container-lowest rounded-2xl p-4 flex flex-col min-h-0 max-h-72 lg:max-h-none">
          <button
            onClick={startNewChat}
            disabled={isSending}
            className="w-full bg-primary-container text-white font-headline font-bold py-3 px-4 rounded-xl flex items-center justify-center gap-2 hover:opacity-90 transition-opacity disabled:opacity-50"
          >
            <span className="material-symbols-outlined">add_comment</span>
            New chat
          </button>

          <p className="mt-5 mb-2 px-2 text-[10px] uppercase tracking-widest text-on-surface-variant opacity-60 font-bold">
            Conversations
          </p>

          <div className="flex-1 overflow-y-auto -mx-1 px-1 space-y-1 min-h-0">
            {isListLoading ? (
              <div className="flex justify-center py-6">
                <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-primary-container" />
              </div>
            ) : conversations.length === 0 ? (
              <p className="px-2 py-4 text-sm text-on-surface-variant opacity-70">
                No conversations yet. Ask your first question!
              </p>
            ) : (
              conversations.map((conversation) => {
                const isActive = conversation.id === selectedId;
                const isEditing = editingId === conversation.id;
                return (
                  <div
                    key={conversation.id}
                    className={`group flex items-center gap-2 rounded-xl px-3 py-2.5 transition-colors cursor-pointer ${
                      isActive ? 'bg-primary/10 text-primary' : 'text-on-surface hover:bg-surface-container-low'
                    }`}
                    onClick={() => {
                      if (!isEditing && !isSending) {
                        setSelectedId(conversation.id);
                        setSendError(null);
                      }
                    }}
                  >
                    <span
                      className="material-symbols-outlined text-lg shrink-0"
                      style={{ fontVariationSettings: isActive ? "'FILL' 1" : "'FILL' 0" }}
                    >
                      chat_bubble
                    </span>
                    <div className="flex-1 min-w-0">
                      {isEditing ? (
                        <input
                          autoFocus
                          value={editingTitle}
                          onChange={(e) => setEditingTitle(e.target.value)}
                          onBlur={commitRename}
                          onClick={(e) => e.stopPropagation()}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') commitRename();
                            if (e.key === 'Escape') setEditingId(null);
                          }}
                          className="w-full px-2 py-1 rounded-lg bg-surface-container-low text-sm border border-primary/40 outline-none"
                        />
                      ) : (
                        <>
                          <p className={`text-sm truncate ${isActive ? 'font-semibold' : 'font-medium'}`}>
                            {conversation.title}
                          </p>
                          <p className="text-[11px] text-on-surface-variant opacity-70">
                            {formatListDate(conversation.updated_at)}
                            {conversation.message_count ? ` · ${conversation.message_count} msgs` : ''}
                          </p>
                        </>
                      )}
                    </div>
                    {!isEditing && (
                      <div className="flex items-center opacity-100 lg:opacity-0 lg:group-hover:opacity-100 transition-opacity">
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            setEditingId(conversation.id);
                            setEditingTitle(conversation.title);
                          }}
                          className="p-1 text-on-surface-variant hover:text-primary"
                          title="Rename"
                        >
                          <span className="material-symbols-outlined text-base">edit</span>
                        </button>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            handleDelete(conversation);
                          }}
                          disabled={deleteMutation.isPending}
                          className="p-1 text-on-surface-variant hover:text-error"
                          title="Delete"
                        >
                          <span className="material-symbols-outlined text-base">delete</span>
                        </button>
                      </div>
                    )}
                  </div>
                );
              })
            )}
          </div>
        </aside>

        {/* Thread */}
        <section className="bg-surface-container-lowest rounded-2xl flex flex-col min-h-[60vh] lg:min-h-0 overflow-hidden">
          <div className="px-6 py-4 border-b border-surface-container flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-primary/10 flex items-center justify-center shrink-0">
              <span className="material-symbols-outlined text-primary" style={{ fontVariationSettings: "'FILL' 1" }}>
                auto_awesome
              </span>
            </div>
            <div className="min-w-0">
              <h2 className="font-headline font-bold text-on-surface truncate">
                {activeConversation?.title ?? 'New conversation'}
              </h2>
              <p className="text-xs text-on-surface-variant">
                Uses the last 6 months of {currentWorkspace.name}'s records
              </p>
            </div>
          </div>

          <div className="flex-1 overflow-y-auto px-4 sm:px-6 py-6 space-y-5 min-h-0">
            {selectedId !== null && isThreadLoading ? (
              <div className="flex justify-center py-12">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-container" />
              </div>
            ) : showEmptyState ? (
              <div className="h-full flex flex-col items-center justify-center text-center py-8">
                <span className="material-symbols-outlined text-5xl text-primary opacity-60 mb-3">forum</span>
                <h3 className="text-lg font-headline font-bold text-on-surface">
                  Hi{user?.name ? ` ${user.name.split(' ')[0]}` : ''}, what do you want to know?
                </h3>
                <p className="text-sm text-on-surface-variant mt-1 max-w-md">
                  Ask in Spanish or English about your spending and how to save — or ask it to find, create, edit or bulk-label transactions for you.
                </p>
                <div className="mt-6 grid grid-cols-1 sm:grid-cols-2 gap-2 w-full max-w-2xl">
                  {SUGGESTIONS.map((suggestion) => (
                    <button
                      key={suggestion}
                      onClick={() => send(suggestion)}
                      disabled={isSending}
                      className="text-left text-sm px-4 py-3 rounded-xl bg-surface-container-low hover:bg-primary/10 hover:text-primary text-on-surface transition-colors disabled:opacity-50"
                    >
                      {suggestion}
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              <>
                {messages.map((message) => (
                  <MessageBubble key={message.id} message={message} />
                ))}
                {pendingMessage && (
                  <>
                    <MessageBubble message={{ role: 'user', content: pendingMessage }} />
                    <div className="flex gap-3">
                      <AssistantAvatar />
                      <div className="rounded-2xl rounded-tl-md bg-surface-container-low px-4 py-3 flex items-center gap-1.5">
                        <span className="w-2 h-2 rounded-full bg-primary animate-bounce [animation-delay:-0.3s]" />
                        <span className="w-2 h-2 rounded-full bg-primary animate-bounce [animation-delay:-0.15s]" />
                        <span className="w-2 h-2 rounded-full bg-primary animate-bounce" />
                        <span className="ml-2 text-xs text-on-surface-variant">Working on it…</span>
                      </div>
                    </div>
                  </>
                )}
              </>
            )}
            <div ref={threadEndRef} />
          </div>

          {sendError && (
            <div className="mx-4 sm:mx-6 mb-2 px-4 py-2 rounded-xl bg-error/10 text-error text-sm flex items-center gap-2">
              <span className="material-symbols-outlined text-base">error</span>
              <span className="flex-1">{sendError}</span>
              <button onClick={() => setSendError(null)} className="opacity-70 hover:opacity-100" title="Dismiss">
                <span className="material-symbols-outlined text-base">close</span>
              </button>
            </div>
          )}

          <div className="p-4 border-t border-surface-container">
            <div className="flex items-end gap-2 rounded-2xl bg-surface-container-low px-3 py-2 focus-within:ring-2 focus-within:ring-primary/30">
              <textarea
                ref={composerRef}
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={handleComposerKeyDown}
                rows={1}
                placeholder="Ask about your spending, or e.g. “label all UBER transactions as Transporte”…"
                className="flex-1 resize-none bg-transparent border-none outline-none text-sm py-2 max-h-[200px]"
              />
              <button
                onClick={() => send()}
                disabled={!draft.trim() || isSending}
                className="w-10 h-10 shrink-0 rounded-xl bg-primary-container text-white flex items-center justify-center hover:opacity-90 transition-opacity disabled:opacity-40"
                title="Send"
              >
                <span className="material-symbols-outlined">{isSending ? 'hourglass_top' : 'send'}</span>
              </button>
            </div>
            <p className="mt-2 px-1 text-[11px] text-on-surface-variant opacity-60">
              Enter to send · Shift+Enter for a new line · Answers can be wrong, double-check important numbers.
            </p>
          </div>
        </section>
      </div>
    </div>
  );
}

function AssistantAvatar() {
  return (
    <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
      <span className="material-symbols-outlined text-primary text-lg" style={{ fontVariationSettings: "'FILL' 1" }}>
        auto_awesome
      </span>
    </div>
  );
}

function MessageBubble({ message }: { message: Pick<ChatMessage, 'role' | 'content' | 'actions'> }) {
  if (message.role === 'user') {
    return (
      <div className="flex justify-end">
        <div className="max-w-[85%] sm:max-w-[75%] rounded-2xl rounded-tr-md bg-primary-container text-white px-4 py-3 text-sm whitespace-pre-wrap break-words">
          {message.content}
        </div>
      </div>
    );
  }
  return (
    <div className="flex gap-3">
      <AssistantAvatar />
      <div className="max-w-[85%] sm:max-w-[80%] min-w-0 space-y-2">
        <div className="rounded-2xl rounded-tl-md bg-surface-container-low text-on-surface px-4 py-3 text-sm break-words">
          <MarkdownMessage content={message.content} />
        </div>
        {message.actions && message.actions.length > 0 && <ActionsBlock actions={message.actions} />}
      </div>
    </div>
  );
}

function actionIcon(tool: string): string {
  if (tool === 'create_transaction') return 'add_circle';
  if (tool === 'update_transactions') return 'edit_note';
  return 'bolt';
}

function ActionsBlock({ actions }: { actions: ChatAction[] }) {
  const total = actions.reduce((sum, a) => sum + (a.count || 0), 0);
  return (
    <div className="rounded-2xl border border-primary/25 bg-primary/5 px-4 py-3 text-sm">
      <p className="flex items-center gap-1.5 text-[10px] uppercase tracking-widest font-bold text-primary">
        <span className="material-symbols-outlined text-sm" style={{ fontVariationSettings: "'FILL' 1" }}>
          task_alt
        </span>
        Changes applied · {total} {total === 1 ? 'transaction' : 'transactions'}
      </p>
      <ul className="mt-2 space-y-1.5">
        {actions.map((action, i) => (
          <li key={i} className="flex items-start gap-2 text-on-surface">
            <span className="material-symbols-outlined text-base text-primary shrink-0 mt-px">{actionIcon(action.tool)}</span>
            <span className="min-w-0 break-words">{action.summary}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
