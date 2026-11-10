package openai

import (
	"context"
	"errors"
	"fmt"
	"log"
	"os"

	"github.com/openai/openai-go"
	"github.com/openai/openai-go/option"
	"github.com/openai/openai-go/responses"
	"github.com/openai/openai-go/shared"
)

type OpenAIClient struct {
	Client  *openai.Client
	Context context.Context
}

func NewClient() *OpenAIClient {
	apiKey := os.Getenv("OPENAI_API_KEY")
	if apiKey == "" {
		log.Fatal("OPENAI_API_KEY not set")
	}

	client := openai.NewClient(
		option.WithAPIKey(apiKey),
	)

	return &OpenAIClient{Client: &client, Context: context.Background()}
}

func (c *OpenAIClient) UploadFile(file *os.File) (string, error) {
	uploaded, err := c.Client.Files.New(c.Context, openai.FileNewParams{
		File:    file,
		Purpose: openai.FilePurposeAssistants,
	})
	if err != nil {
		return "", err
	}

	return uploaded.ID, nil
}

func (c *OpenAIClient) PromptResponse(prompt string, fileId string) (string, error) {
	params := responses.ResponseNewParams{
		Model:           openai.ChatModel("gpt-4o-mini"),
		MaxOutputTokens: openai.Int(16384),
		Input: responses.ResponseNewParamsInputUnion{
			OfInputItemList: responses.ResponseInputParam{
				// One "message" that includes: file + text prompt
				responses.ResponseInputItemParamOfMessage(
					responses.ResponseInputMessageContentListParam{
						// 1) The PDF file
						responses.ResponseInputContentUnionParam{
							OfInputFile: &responses.ResponseInputFileParam{
								FileID: openai.String(fileId),
								Type:   "input_file",
							},
						},
						// 2) The textual instructions
						responses.ResponseInputContentUnionParam{
							OfInputText: &responses.ResponseInputTextParam{
								Text: prompt,
								Type: "input_text",
							},
						},
					},
					"user",
				),
			},
		},
	}

	resp, err := c.Client.Responses.New(c.Context, params)
	if err != nil {
		return "", fmt.Errorf("error calling Responses API: %w", err)
	}

	return resp.OutputText(), nil
}

func (c *OpenAIClient) GetEmbedding(text string) ([]float64, error) {
	resp, err := c.Client.Embeddings.New(c.Context, openai.EmbeddingNewParams{
		Model: openai.EmbeddingModelTextEmbedding3Small,
		Input: openai.EmbeddingNewParamsInputUnion{
			OfString: openai.String(text),
		},
	})
	if err != nil {
		return nil, err
	}

	emb := resp.Data[0].Embedding
	return []float64(emb), nil
}

func (c *OpenAIClient) PromptText(prompt string) (string, error) {
	params := responses.ResponseNewParams{
		Model: openai.ChatModelGPT4o,
		Input: responses.ResponseNewParamsInputUnion{
			OfInputItemList: responses.ResponseInputParam{
				responses.ResponseInputItemParamOfMessage(
					responses.ResponseInputMessageContentListParam{
						responses.ResponseInputContentUnionParam{
							OfInputText: &responses.ResponseInputTextParam{
								Text: prompt,
								Type: "input_text",
							},
						},
					},
					"user",
				),
			},
		},
	}

	resp, err := c.Client.Responses.New(c.Context, params)
	if err != nil {
		return "", fmt.Errorf("error calling Responses API: %w", err)
	}

	return resp.OutputText(), nil
}

// ErrMissingAPIKey is returned by NewClientFromEnv when OPENAI_API_KEY is not configured.
var ErrMissingAPIKey = errors.New("OPENAI_API_KEY not set")

// DefaultChatModel is used by ChatCompletion when OPENAI_CHAT_MODEL is not set.
const DefaultChatModel = "gpt-4o"

// NewClientFromEnv is like NewClient but returns an error instead of exiting
// the process when the API key is missing. Use it from request handlers.
func NewClientFromEnv() (*OpenAIClient, error) {
	apiKey := os.Getenv("OPENAI_API_KEY")
	if apiKey == "" {
		return nil, ErrMissingAPIKey
	}
	client := openai.NewClient(option.WithAPIKey(apiKey))
	return &OpenAIClient{Client: &client, Context: context.Background()}, nil
}

// ChatModel returns the model used for chat completions (OPENAI_CHAT_MODEL, default gpt-4o).
func ChatModel() string {
	if m := os.Getenv("OPENAI_CHAT_MODEL"); m != "" {
		return m
	}
	return DefaultChatModel
}

// ChatMessage is a provider-neutral chat message. Role is "system", "user",
// "assistant" or "tool". Assistant messages may carry ToolCalls; tool messages
// must set ToolCallID to the call they answer.
type ChatMessage struct {
	Role       string
	Content    string
	ToolCalls  []ToolCall
	ToolCallID string
}

// ToolDefinition describes a function the model may call. Parameters is a JSON schema object.
type ToolDefinition struct {
	Name        string
	Description string
	Parameters  map[string]any
}

// ToolCall is a function call requested by the model. Arguments is raw JSON.
type ToolCall struct {
	ID        string
	Name      string
	Arguments string
}

func toChatParams(messages []ChatMessage) []openai.ChatCompletionMessageParamUnion {
	out := make([]openai.ChatCompletionMessageParamUnion, 0, len(messages))
	for _, m := range messages {
		switch m.Role {
		case "system":
			out = append(out, openai.SystemMessage(m.Content))
		case "tool":
			out = append(out, openai.ToolMessage(m.Content, m.ToolCallID))
		case "assistant":
			if len(m.ToolCalls) == 0 {
				out = append(out, openai.AssistantMessage(m.Content))
				continue
			}
			assistant := openai.ChatCompletionAssistantMessageParam{}
			if m.Content != "" {
				assistant.Content.OfString = openai.String(m.Content)
			}
			for _, tc := range m.ToolCalls {
				assistant.ToolCalls = append(assistant.ToolCalls, openai.ChatCompletionMessageToolCallParam{
					ID: tc.ID,
					Function: openai.ChatCompletionMessageToolCallFunctionParam{
						Name:      tc.Name,
						Arguments: tc.Arguments,
					},
				})
			}
			out = append(out, openai.ChatCompletionMessageParamUnion{OfAssistant: &assistant})
		default:
			out = append(out, openai.UserMessage(m.Content))
		}
	}
	return out
}

// ChatCompletion sends a full message history to the Chat Completions API and
// returns the assistant's reply text.
func (c *OpenAIClient) ChatCompletion(ctx context.Context, messages []ChatMessage) (string, error) {
	reply, err := c.ChatCompletionWithTools(ctx, messages, nil)
	if err != nil {
		return "", err
	}
	return reply.Content, nil
}

// ChatCompletionWithTools is like ChatCompletion but offers the given tools.
// The returned assistant message either has Content (final answer) or
// ToolCalls the caller must execute and answer with "tool" messages.
func (c *OpenAIClient) ChatCompletionWithTools(ctx context.Context, messages []ChatMessage, tools []ToolDefinition) (ChatMessage, error) {
	if ctx == nil {
		ctx = c.Context
	}
	params := openai.ChatCompletionNewParams{
		Model:    openai.ChatModel(ChatModel()),
		Messages: toChatParams(messages),
	}
	for _, t := range tools {
		params.Tools = append(params.Tools, openai.ChatCompletionToolParam{
			Function: shared.FunctionDefinitionParam{
				Name:        t.Name,
				Description: openai.String(t.Description),
				Parameters:  shared.FunctionParameters(t.Parameters),
			},
		})
	}

	resp, err := c.Client.Chat.Completions.New(ctx, params)
	if err != nil {
		return ChatMessage{}, fmt.Errorf("error calling Chat Completions API: %w", err)
	}
	if len(resp.Choices) == 0 {
		return ChatMessage{}, errors.New("chat completion returned no choices")
	}
	msg := resp.Choices[0].Message
	out := ChatMessage{Role: "assistant", Content: msg.Content}
	for _, tc := range msg.ToolCalls {
		out.ToolCalls = append(out.ToolCalls, ToolCall{ID: tc.ID, Name: tc.Function.Name, Arguments: tc.Function.Arguments})
	}
	return out, nil
}
