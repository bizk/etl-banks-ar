package openai

import (
	"context"
	"fmt"
	"log"
	"os"

	"github.com/openai/openai-go"
	"github.com/openai/openai-go/option"
	"github.com/openai/openai-go/responses"
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
		Model:           openai.ChatModelGPT4o, // or a ResponsesModel like ResponsesModelO4Mini if available
		MaxOutputTokens: openai.Int(16384),     // Increased to handle large statements
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
