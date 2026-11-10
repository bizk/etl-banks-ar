package services

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"time"

	"etl-banks-ar/internal/models"
	openAiService "etl-banks-ar/internal/openai"

	"gorm.io/gorm"
)

var (
	// ErrChatUnavailable means the AI backend is not configured (missing API key).
	ErrChatUnavailable = errors.New("AI chat is not configured: OPENAI_API_KEY is missing")
	// ErrConversationNotFound means the conversation does not exist or is not visible to the user.
	ErrConversationNotFound = errors.New("conversation not found")
)

const (
	chatContextMonths        = 6
	chatContextTransactions  = 50
	chatContextRates         = 6
	chatHistoryLimit         = 20
	chatTitleMaxRunes        = 60
	chatMaxUserMessageRunes  = 4000
	chatModelRequestDeadline = 150 * time.Second
	chatMaxToolRounds        = 6
)

// ChatCompleter abstracts the model call so it can be swapped in tests.
type ChatCompleter interface {
	ChatCompletionWithTools(ctx context.Context, messages []openAiService.ChatMessage, tools []openAiService.ToolDefinition) (openAiService.ChatMessage, error)
}

type ChatService struct {
	db               *gorm.DB
	transactions     *TransactionService
	areas            *AreaService
	recurring        *RecurringExpenseService
	exchangeRates    *ExchangeRateService
	categories       *CategoryService
	newCompleterFunc func() (ChatCompleter, error)
}

func NewChatService(db *gorm.DB, transactions *TransactionService, areas *AreaService, recurring *RecurringExpenseService, exchangeRates *ExchangeRateService) *ChatService {
	return &ChatService{
		db:            db,
		transactions:  transactions,
		areas:         areas,
		recurring:     recurring,
		exchangeRates: exchangeRates,
		categories:    NewCategoryService(db),
		newCompleterFunc: func() (ChatCompleter, error) {
			client, err := openAiService.NewClientFromEnv()
			if err != nil {
				return nil, ErrChatUnavailable
			}
			return client, nil
		},
	}
}

// ConversationSummary is a list item with a cheap message count.
type ConversationSummary struct {
	models.ChatConversation
	MessageCount int64 `json:"message_count"`
}

func (s *ChatService) ListConversations(workspaceID, userID uint) ([]ConversationSummary, error) {
	var convs []models.ChatConversation
	if err := s.db.Where("workspace_id = ? AND user_id = ?", workspaceID, userID).
		Order("updated_at DESC").Find(&convs).Error; err != nil {
		return nil, err
	}
	out := make([]ConversationSummary, 0, len(convs))
	if len(convs) == 0 {
		return out, nil
	}
	ids := make([]uint, len(convs))
	for i, c := range convs {
		ids[i] = c.ID
	}
	var counts []struct {
		ConversationID uint
		Count          int64
	}
	if err := s.db.Model(&models.ChatMessage{}).
		Select("conversation_id, COUNT(*) as count").
		Where("conversation_id IN ?", ids).
		Group("conversation_id").Scan(&counts).Error; err != nil {
		return nil, err
	}
	countByID := make(map[uint]int64, len(counts))
	for _, c := range counts {
		countByID[c.ConversationID] = c.Count
	}
	for _, c := range convs {
		out = append(out, ConversationSummary{ChatConversation: c, MessageCount: countByID[c.ID]})
	}
	return out, nil
}

func (s *ChatService) CreateConversation(workspaceID, userID uint, title string) (*models.ChatConversation, error) {
	title = strings.TrimSpace(title)
	if title == "" {
		title = DefaultChatTitle
	} else {
		title = TruncateTitle(title, chatTitleMaxRunes)
	}
	conv := &models.ChatConversation{WorkspaceID: workspaceID, UserID: userID, Title: title}
	if err := s.db.Create(conv).Error; err != nil {
		return nil, err
	}
	conv.Messages = []models.ChatMessage{}
	return conv, nil
}

func (s *ChatService) findConversation(id, workspaceID, userID uint) (*models.ChatConversation, error) {
	var conv models.ChatConversation
	err := s.db.Where("id = ? AND workspace_id = ? AND user_id = ?", id, workspaceID, userID).First(&conv).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, ErrConversationNotFound
	}
	if err != nil {
		return nil, err
	}
	return &conv, nil
}

// GetConversation returns the conversation with all of its messages in chronological order.
func (s *ChatService) GetConversation(id, workspaceID, userID uint) (*models.ChatConversation, error) {
	conv, err := s.findConversation(id, workspaceID, userID)
	if err != nil {
		return nil, err
	}
	if err := s.db.Where("conversation_id = ?", conv.ID).Order("created_at ASC, id ASC").Find(&conv.Messages).Error; err != nil {
		return nil, err
	}
	if conv.Messages == nil {
		conv.Messages = []models.ChatMessage{}
	}
	return conv, nil
}

func (s *ChatService) RenameConversation(id, workspaceID, userID uint, title string) (*models.ChatConversation, error) {
	conv, err := s.findConversation(id, workspaceID, userID)
	if err != nil {
		return nil, err
	}
	conv.Title = TruncateTitle(title, chatTitleMaxRunes)
	if err := s.db.Model(conv).Update("title", conv.Title).Error; err != nil {
		return nil, err
	}
	return conv, nil
}

func (s *ChatService) DeleteConversation(id, workspaceID, userID uint) error {
	conv, err := s.findConversation(id, workspaceID, userID)
	if err != nil {
		return err
	}
	return s.db.Transaction(func(tx *gorm.DB) error {
		if err := tx.Where("conversation_id = ?", conv.ID).Delete(&models.ChatMessage{}).Error; err != nil {
			return err
		}
		return tx.Delete(conv).Error
	})
}

// SendResult is returned after a successful exchange.
type SendResult struct {
	Conversation     *models.ChatConversation `json:"conversation"`
	UserMessage      models.ChatMessage       `json:"user_message"`
	AssistantMessage models.ChatMessage       `json:"assistant_message"`
}

// SendMessage calls the model with the conversation history plus a fresh
// workspace data context, then persists both the user message and the reply.
// Nothing is stored if the model call fails, so the client can simply retry.
func (s *ChatService) SendMessage(ctx context.Context, conversationID, workspaceID, userID uint, content string) (*SendResult, error) {
	content = strings.TrimSpace(content)
	if content == "" {
		return nil, fmt.Errorf("message content is empty")
	}
	if len([]rune(content)) > chatMaxUserMessageRunes {
		content = string([]rune(content)[:chatMaxUserMessageRunes])
	}

	completer, err := s.newCompleterFunc()
	if err != nil {
		return nil, err
	}

	conv, err := s.GetConversation(conversationID, workspaceID, userID)
	if err != nil {
		return nil, err
	}

	contextText, err := s.BuildContext(workspaceID, time.Now())
	if err != nil {
		return nil, fmt.Errorf("build context: %w", err)
	}

	history := TrimHistory(conv.Messages, chatHistoryLimit-1)
	prompt := make([]openAiService.ChatMessage, 0, len(history)+3)
	prompt = append(prompt,
		openAiService.ChatMessage{Role: "system", Content: chatSystemPrompt},
		openAiService.ChatMessage{Role: "system", Content: contextText},
	)
	for _, m := range history {
		prompt = append(prompt, openAiService.ChatMessage{Role: m.Role, Content: HistoryContent(m)})
	}
	prompt = append(prompt, openAiService.ChatMessage{Role: models.ChatRoleUser, Content: content})

	// Don't abort half-way through tool execution if the client disconnects:
	// any changes already applied must still be recorded in the conversation.
	reqCtx, cancel := context.WithTimeout(context.WithoutCancel(ctx), chatModelRequestDeadline)
	defer cancel()

	exec := &chatToolExecutor{s: s, workspaceID: workspaceID, userID: userID}
	reply, modelErr := runToolLoop(reqCtx, completer, prompt, chatToolDefinitions(), exec.Execute, chatMaxToolRounds)
	if modelErr != nil || reply == "" {
		if len(exec.actions) == 0 {
			if modelErr == nil {
				modelErr = errors.New("model returned an empty reply")
			}
			return nil, modelErr
		}
		// Changes were applied: persist a reply that states them.
		reply = FallbackActionsReply(exec.actions)
	}

	userMsg := models.ChatMessage{ConversationID: conv.ID, Role: models.ChatRoleUser, Content: content}
	assistantMsg := models.ChatMessage{ConversationID: conv.ID, Role: models.ChatRoleAssistant, Content: reply, Actions: exec.actions}
	err = s.db.Transaction(func(tx *gorm.DB) error {
		if err := tx.Create(&userMsg).Error; err != nil {
			return err
		}
		// Ensure the assistant message sorts strictly after the user message.
		assistantMsg.CreatedAt = userMsg.CreatedAt.Add(time.Millisecond)
		if err := tx.Create(&assistantMsg).Error; err != nil {
			return err
		}
		updates := map[string]interface{}{"updated_at": time.Now()}
		if len(conv.Messages) == 0 && (conv.Title == "" || conv.Title == DefaultChatTitle) {
			conv.Title = TruncateTitle(content, chatTitleMaxRunes)
			updates["title"] = conv.Title
		}
		return tx.Model(&models.ChatConversation{}).Where("id = ?", conv.ID).Updates(updates).Error
	})
	if err != nil {
		return nil, err
	}

	conv.Messages = nil
	conv.UpdatedAt = time.Now()
	return &SendResult{Conversation: conv, UserMessage: userMsg, AssistantMessage: assistantMsg}, nil
}

// BuildContext gathers the workspace data the model is grounded on, reusing
// the existing summary services, and renders it with FormatChatContext.
func (s *ChatService) BuildContext(workspaceID uint, now time.Time) (string, error) {
	data := ChatContextData{Today: now}

	var ws models.Workspace
	if err := s.db.Select("name").First(&ws, workspaceID).Error; err == nil {
		data.WorkspaceName = ws.Name
	}

	firstOfMonth := time.Date(now.Year(), now.Month(), 1, 0, 0, 0, 0, now.Location())
	for i := chatContextMonths - 1; i >= 0; i-- {
		month := firstOfMonth.AddDate(0, -i, 0).Format("2006-01")
		mc := ChatMonthContext{Month: month}

		if summary, err := s.transactions.GetMonthlySummary(workspaceID, month); err == nil {
			mc.Spending = summary.TotalSpending
			mc.Income = summary.TotalIncome
		}

		// Area summary is debit-only and resolves each category's effective area.
		if areaSummary, err := s.areas.GetMonthlySummary(workspaceID, month); err == nil {
			categoryTotals := map[string]float64{}
			for _, a := range areaSummary.Areas {
				mc.Areas = append(mc.Areas, NamedAmount{Name: a.AreaName, Amount: a.Amount})
				for _, c := range a.Categories {
					categoryTotals[c.CategoryName] += c.Amount
				}
			}
			for name, amount := range categoryTotals {
				mc.Categories = append(mc.Categories, NamedAmount{Name: name, Amount: amount})
			}
		}
		data.Months = append(data.Months, mc)
	}

	if expenses, err := s.recurring.List(workspaceID, firstOfMonth.Format("2006-01")); err == nil {
		for i := range expenses {
			e := expenses[i]
			rc := ChatRecurringContext{Name: e.Name, Amount: e.Amount, DueDay: e.DueDay, Owner: e.Owner, Paid: e.IsPaidThisMonth()}
			if e.Category != nil {
				rc.Category = e.Category.Name
			}
			data.Recurring = append(data.Recurring, rc)
		}
	}

	if rates, err := s.exchangeRates.List(workspaceID); err == nil {
		rates = TrimHistory(reverseRates(rates), chatContextRates) // List is DESC; keep latest N in ASC order
		for _, r := range rates {
			data.ExchangeRates = append(data.ExchangeRates, NamedAmount{Name: r.Month, Amount: r.Rate})
		}
	}

	var txns []models.Transaction
	if err := s.db.Where("workspace_id = ?", workspaceID).
		Order("date DESC, id DESC").Limit(chatContextTransactions).Find(&txns).Error; err != nil {
		return "", err
	}
	for _, t := range txns {
		data.Transactions = append(data.Transactions, ChatTransactionContext{
			ID:          t.ID,
			Date:        t.Date,
			Description: t.Description.String,
			Amount:      t.Amount.Float64,
			Type:        t.Type.String,
			Category:    t.Category.String,
			Owner:       t.Owner.String,
		})
	}

	return FormatChatContext(data), nil
}

func reverseRates(in []models.ExchangeRate) []models.ExchangeRate {
	out := make([]models.ExchangeRate, len(in))
	for i, r := range in {
		out[len(in)-1-i] = r
	}
	return out
}

// runToolLoop calls the model, executes any requested tool calls, feeds the
// results back and repeats until the model answers with text or maxRounds
// tool rounds have been used (then one final call without tools forces a
// text answer).
func runToolLoop(ctx context.Context, completer ChatCompleter, prompt []openAiService.ChatMessage, tools []openAiService.ToolDefinition, execute func(openAiService.ToolCall) string, maxRounds int) (string, error) {
	for round := 0; round <= maxRounds; round++ {
		offered := tools
		if round == maxRounds {
			offered = nil
		}
		reply, err := completer.ChatCompletionWithTools(ctx, prompt, offered)
		if err != nil {
			return "", err
		}
		if len(reply.ToolCalls) == 0 || offered == nil {
			return strings.TrimSpace(reply.Content), nil
		}
		reply.Role = models.ChatRoleAssistant
		prompt = append(prompt, reply)
		for _, call := range reply.ToolCalls {
			prompt = append(prompt, openAiService.ChatMessage{Role: "tool", ToolCallID: call.ID, Content: execute(call)})
		}
	}
	return "", nil
}
