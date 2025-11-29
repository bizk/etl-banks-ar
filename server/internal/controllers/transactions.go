package controllers

import (
	"encoding/json"
	"etl-banks-ar/internal/models"
	openAiService "etl-banks-ar/internal/openai"
	"fmt"

	"gorm.io/gorm"
)

type TransactionController struct {
	db            *gorm.DB
	openAiService *openAiService.OpenAIClient
}

func NewTransactionController(db *gorm.DB) *TransactionController {
	openAiService := openAiService.NewClient()
	return &TransactionController{db: db, openAiService: openAiService}
}

func (c *TransactionController) CreateTransaction(transaction *models.Transaction) error {
	embedding, err := c.CreateEmbedding(transaction)
	if err != nil {
		return err
	}
	embeddingJSON, err := json.Marshal(embedding)
	if err != nil {
		return err
	}
	transaction.EmbeddingJSON = string(embeddingJSON)
	return c.db.Create(transaction).Error
}

func (c *TransactionController) GetTransaction(id uint) (*models.Transaction, error) {
	var transaction models.Transaction
	if err := c.db.First(&transaction, id).Error; err != nil {
		return nil, err
	}

	return &transaction, nil
}

func (c *TransactionController) UpdateTransaction(transaction *models.Transaction) error {
	return c.db.Save(transaction).Error
}

func (c *TransactionController) DeleteTransaction(id uint) error {
	return c.db.Delete(&models.Transaction{}, id).Error
}

func (c *TransactionController) CreateEmbedding(transaction *models.Transaction) ([]float64, error) {
	parsedAmount := transaction.Amount.Float64
	parsedType := transaction.Type.String

	embeddingText := fmt.Sprintf("%s %s %s %f", transaction.Description.String, transaction.Category.String, parsedType, parsedAmount)
	embedding, err := c.openAiService.GetEmbedding(embeddingText)
	if err != nil {
		return nil, err
	}
	return embedding, nil
}

func (c *TransactionController) GetClassifiedTransactions() ([]models.Transaction, error) {
	var transactions []models.Transaction
	if err := c.db.Where("embedding_json IS NOT NULL AND embedding_json != ''").Find(&transactions).Error; err != nil {
		return nil, err
	}
	for _, transaction := range transactions {
		fmt.Println("Transaction: ", transaction.ID)
	}
	return transactions, nil
}
