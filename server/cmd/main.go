package main

import (
	"database/sql"
	"encoding/json"
	"etl-banks-ar/internal/clasifier"
	"etl-banks-ar/internal/controllers"
	"etl-banks-ar/internal/db"
	"etl-banks-ar/internal/models"
	"fmt"
	"log"
	"time"

	"github.com/joho/godotenv"
)

func main() {
	fmt.Println("Starting server...")

	if err := godotenv.Load(); err != nil {
		log.Fatal("Error load	ing .env file")
	}

	// result, err := ocr.Execute("resources/Extracto-Uala_Octubre.pdf")
	// if err != nil {
	// 	log.Fatal("Error executing OCR: ", err)
	// }

	db.Migrate()
	db.Connect()

	controller := controllers.NewTransactionController(db.Connect())

	// transactions := []models.Transaction{
	// 	{
	// 		Description: sql.NullString{String: "Zara", Valid: true},
	// 		Amount:      sql.NullFloat64{Float64: 100, Valid: true},
	// 		Date:        time.Now(),
	// 		Category:    sql.NullString{String: "compras", Valid: true},
	// 		Type:        sql.NullString{String: "debit", Valid: true},
	// 	},
	// 	{
	// 		Description: sql.NullString{String: "Cinemark", Valid: true},
	// 		Amount:      sql.NullFloat64{Float64: 200, Valid: true},
	// 		Date:        time.Now(),
	// 		Category:    sql.NullString{String: "salidas", Valid: true},
	// 		Type:        sql.NullString{String: "debit", Valid: true},
	// 	},
	// 	{
	// 		Description: sql.NullString{String: "Hoyts", Valid: true},
	// 		Amount:      sql.NullFloat64{Float64: 1000, Valid: true},
	// 		Date:        time.Now(),
	// 		Category:    sql.NullString{String: "salidas", Valid: true},
	// 		Type:        sql.NullString{String: "credit", Valid: true},
	// 	},
	// 	{
	// 		Description: sql.NullString{String: "Dia", Valid: true},
	// 		Amount:      sql.NullFloat64{Float64: 100, Valid: true},
	// 		Date:        time.Now(),
	// 		Category:    sql.NullString{String: "supermercado", Valid: true},
	// 		Type:        sql.NullString{String: "debit", Valid: true},
	// 	},
	// }
	// for _, transaction := range transactions {
	// 	controller.CreateTransaction(&transaction)
	// }

	classifiedTransactions, err := controller.GetClassifiedTransactions()
	if err != nil {
		log.Fatal("Error getting classified transactions: ", err)
	}

	testTransaction := models.Transaction{
		Description: sql.NullString{String: "super Dia", Valid: true},
		Amount:      sql.NullFloat64{Float64: 100, Valid: true},
		Date:        time.Now(),
		Type:        sql.NullString{String: "debit", Valid: true},
	}

	transactions := []models.Transaction{}
	embedding, err := controller.CreateEmbedding(&testTransaction)
	if err != nil {
		log.Fatal("Error creating embedding: ", err)
	}
	embeddingJSON, err := json.Marshal(embedding)
	if err != nil {
		log.Fatal("Error marshalling embedding: ", err)
	}
	testTransaction.EmbeddingJSON = string(embeddingJSON)

	transactions = append(transactions, testTransaction)
	x, err := clasifier.ClassifyTransactions(transactions, classifiedTransactions)
	if err != nil {
		log.Fatal("Error classifying transactions: ", err)
	}

	fmt.Println("Classified transactions: ", x[0].Category)

	fmt.Println("Transaction created successfully!")

}
